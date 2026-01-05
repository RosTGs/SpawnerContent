"""Flask web interface for Gemini image generation."""
from __future__ import annotations

import json
import os
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional

from flask import (
    Flask,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
import yaml
from werkzeug.datastructures import FileStorage

from .gemini_client import GeminiClient
from .storage import (
    DEFAULT_OUTPUT_DIR,
    Settings,
    SheetRecord,
    ensure_output_dir,
    export_pdf,
    get_generation_dir,
    new_asset_path,
    save_metadata,
    load_settings,
    save_settings,
    save_uploaded_file,
)

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "src" / "frontend"

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
RESOLUTIONS = ["1K", "2K", "4K"]
SECRET_STYLE_PROMPT = "\n".join(
    [
        "Фон в каждой карточке одинаковый",
        "Все подписи и цифры делай одним шрифтом",
        (
            "Главный персонаж всегда узнаётся: сохраняй фирменные цвета, причёску и ключевые "
            "аксессуары, но меняй позы, эмоции и ракурс, допускай разные техники рисования в "
            "пределах общего стиля референсов"
        ),
        (
            "Располагай героя так, чтобы он естественно вписывался в сетку листа и не повторялся "
            "один-в-один между кадрами."
        ),
    ]
)
STATUS_LABELS = {
    "pending": "В очереди",
    "generating": "Генерируется",
    "regenerating": "Регенерируется",
    "ready": "Готово",
    "approved": "Апрув",
    "error": "Ошибка",
}


@dataclass
class GenerationEntry:
    """Represents a single generation request and its results."""

    id: int
    sheet_prompts: List[str]
    aspect_ratio: str
    resolution: str
    latest_image: Optional[str] = None
    image_paths: List[Optional[str]] = field(default_factory=list)
    image_statuses: List[str] = field(default_factory=list)
    image_approvals: List[bool] = field(default_factory=list)
    pdf_image_candidates: List[List[str]] = field(default_factory=list)
    background_references: List[str] = field(default_factory=list)
    detail_references: List[str] = field(default_factory=list)
    text_parts: List[str] = field(default_factory=list)
    status: str = "pending"
    approved: bool = False

    @property
    def title(self) -> str:
        first_line = self.sheet_prompts[0].splitlines()[0] if self.sheet_prompts else ""
        cleaned = first_line.strip()
        return cleaned if cleaned else f"Генерация #{self.id}"

    @property
    def prompt(self) -> str:
        numbered = [f"Промт листа {idx + 1}: {text}" for idx, text in enumerate(self.sheet_prompts)]
        return "\n\n".join(numbered)

    @property
    def all_references(self) -> List[str]:
        return [*self.background_references, *self.detail_references]

    @property
    def background_reference_links(self) -> List[dict[str, str]]:
        return self._reference_links(self.background_references)

    @property
    def detail_reference_links(self) -> List[dict[str, str]]:
        return self._reference_links(self.detail_references)

    @property
    def image_path(self) -> Optional[Path]:
        if not self.image_paths and not self.latest_image:
            return None
        first = self.image_paths[0] if self.image_paths else self.latest_image
        if not first:
            return None
        return self._normalize_image_path(first)

    @property
    def image_filename(self) -> Optional[str]:
        images = self.images
        if not images:
            return None
        for image in images:
            if image["exists"]:
                return image["filename"]
        return images[0]["filename"]

    @property
    def image_exists(self) -> bool:
        return any(image["exists"] for image in self.images)

    @property
    def images(self) -> List[dict[str, object]]:
        images: List[dict[str, object]] = []
        total = max(len(self.sheet_prompts), len(self.image_paths))
        for index in range(total):
            raw_path = self.image_paths[index] if index < len(self.image_paths) else None
            normalized = self._normalize_image_path(raw_path) if raw_path else None
            filename = normalized.name if normalized else f"generation-{self.id}-sheet-{index + 1}.png"
            asset_name = (
                normalized.relative_to(DEFAULT_OUTPUT_DIR).as_posix()
                if normalized and DEFAULT_OUTPUT_DIR in normalized.parents
                else filename
            )
            status = self.image_statuses[index] if index < len(self.image_statuses) else self.status
            approved = self.image_approvals[index] if index < len(self.image_approvals) else False
            images.append(
                {
                    "filename": filename,
                    "asset_name": asset_name,
                    "exists": normalized.exists() if normalized else False,
                    "status": status,
                    "approved": approved,
                    "index": index,
                }
            )
        return images

    @property
    def preferred_pdf_images(self) -> List[str]:
        selected: List[str] = []
        total = len(self.sheet_prompts)
        for index in range(total):
            base = self.image_paths[index] if index < len(self.image_paths) else None
            candidates = (
                self.pdf_image_candidates[index]
                if index < len(self.pdf_image_candidates)
                else []
            )
            preferred = next((path for path in candidates if path), base)
            if preferred:
                selected.append(preferred)
        return selected

    def _reference_links(self, references: List[str]) -> List[dict[str, str]]:
        links: List[dict[str, str]] = []
        for ref in references:
            links.append({"asset_name": _to_asset_name(ref), "label": Path(ref).name})
        return links

    def recalc_flags(self) -> None:
        self.approved = bool(self.image_approvals) and all(self.image_approvals)
        if any(state == "regenerating" for state in self.image_statuses):
            self.status = "regenerating"
        elif any(state in {"pending", "generating"} for state in self.image_statuses):
            self.status = "generating"
        elif any(state == "error" for state in self.image_statuses):
            self.status = "error"
        elif self.approved:
            self.status = "approved"
        elif self.image_statuses and all(state == "ready" for state in self.image_statuses):
            self.status = "ready"

    @staticmethod
    def _normalize_image_path(path_str: Optional[str]) -> Path:
        if not path_str:
            return DEFAULT_OUTPUT_DIR / "placeholder.png"
        path = Path(path_str)
        if path.is_absolute() and path.exists():
            return path
        if path.is_absolute() and not path.exists() and path.name:
            return DEFAULT_OUTPUT_DIR / path.name
        if not path.is_absolute():
            return DEFAULT_OUTPUT_DIR / path.name
        return DEFAULT_OUTPUT_DIR / "placeholder.png"


_generations: List[GenerationEntry] = []
_next_generation_id = 1
_settings: Settings = load_settings()


def _to_asset_name(path_str: str) -> str:
    path = Path(path_str)
    if path.is_absolute():
        try:
            return path.relative_to(DEFAULT_OUTPUT_DIR).as_posix()
        except ValueError:
            return path.name
    return path.as_posix()


def _generation_state_path(generation_id: int) -> Path:
    return get_generation_dir(generation_id) / "state.json"


def _persist_generation(entry: GenerationEntry) -> None:
    state_path = _generation_state_path(entry.id)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    serializable = asdict(entry)
    serializable["image_paths"] = [str(path) if path else None for path in entry.image_paths]
    serializable["background_references"] = [str(ref) for ref in entry.background_references]
    serializable["detail_references"] = [str(ref) for ref in entry.detail_references]
    state_path.write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_saved_generations() -> None:
    global _generations, _next_generation_id

    ensure_output_dir(DEFAULT_OUTPUT_DIR)
    saved: List[GenerationEntry] = []
    for state_file in DEFAULT_OUTPUT_DIR.glob("generation-*/state.json"):
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        entry = GenerationEntry(
            id=int(data.get("id", 0)),
            sheet_prompts=data.get("sheet_prompts", []),
            aspect_ratio=data.get("aspect_ratio", ASPECT_RATIOS[0]),
            resolution=data.get("resolution", RESOLUTIONS[0]),
            latest_image=data.get("latest_image"),
            image_paths=data.get("image_paths", []),
            image_statuses=data.get("image_statuses", []),
            image_approvals=data.get("image_approvals", []),
            pdf_image_candidates=data.get("pdf_image_candidates", []),
            background_references=data.get("background_references", []),
            detail_references=data.get("detail_references", []),
            text_parts=data.get("text_parts", []),
            status=data.get("status", "pending"),
            approved=data.get("approved", False),
        )
        _ensure_image_lists(entry)
        entry.recalc_flags()
        saved.append(entry)

    saved.sort(key=lambda item: item.id, reverse=True)
    _generations = saved
    _next_generation_id = max([gen.id for gen in saved], default=0) + 1


_load_saved_generations()



def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(FRONTEND_DIR / "templates"),
        static_folder=str(FRONTEND_DIR / "static"),
    )
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "dev-secret")

    @app.context_processor
    def inject_globals() -> dict[str, object]:
        return {
            "ASPECT_RATIOS": ASPECT_RATIOS,
            "RESOLUTIONS": RESOLUTIONS,
            "STATUS_LABELS": STATUS_LABELS,
        }

    @app.route("/")
    def index() -> str:
        progress = {
            "total": len(_generations),
            "completed": len(
                [
                    gen
                    for gen in _generations
                    if gen.status in {"ready", "approved"}
                ]
            ),
            "active": len(
                [
                    gen
                    for gen in _generations
                    if gen.status in {"generating", "regenerating"}
                ]
            ),
        }

        return render_template(
            "index.html", generations=_generations, progress=progress, settings=_settings
        )

    @app.get("/status")
    def status() -> object:
        progress = {
            "total": len(_generations),
            "completed": len(
                [
                    gen
                    for gen in _generations
                    if gen.status in {"ready", "approved"}
                ]
            ),
            "active": len(
                [
                    gen
                    for gen in _generations
                    if gen.status in {"generating", "regenerating"}
                ]
            ),
        }

        def serialize_generation(entry: GenerationEntry) -> dict[str, object]:
            images: list[dict[str, object]] = []
            for image in entry.images:
                images.append(
                    {
                        "index": image["index"],
                        "status": image["status"],
                        "approved": image["approved"],
                        "exists": image["exists"],
                        "asset_url": url_for(
                            "serve_asset", filename=image["asset_name"]
                        )
                        if image["exists"]
                        else None,
                        "filename": image["filename"],
                    }
                )

            ready_count = len(
                [img for img in images if img["status"] in {"ready", "approved"}]
            )
            return {
                "id": entry.id,
                "status": entry.status,
                "status_label": STATUS_LABELS.get(entry.status, entry.status),
                "approved": entry.approved,
                "ready": ready_count,
                "total": len(entry.sheet_prompts),
                "images": images,
            }

        return jsonify(
            {
                "progress": progress,
                "generations": [serialize_generation(gen) for gen in _generations],
            }
        )

    @app.post("/generate")
    def generate() -> str:
        api_key = request.form.get("api_key") or _settings.api_key or None
        aspect_ratio = request.form.get("aspect_ratio", ASPECT_RATIOS[0])
        resolution = request.form.get("resolution", RESOLUTIONS[0])
        sheet_prompts = [block.strip() for block in request.form.getlist("sheet_prompts") if block.strip()]

        yaml_prompts: List[str] = []
        yaml_file = request.files.get("prompt_yaml")
        if yaml_file and yaml_file.filename:
            try:
                yaml_prompts = _load_yaml_prompts(yaml_file)
            except ValueError as exc:
                flash(str(exc), "error")
                return redirect(url_for("index"))
            except Exception as exc:  # noqa: BLE001
                flash(f"Не удалось загрузить YAML: {exc}", "error")
                return redirect(url_for("index"))

        sheet_prompts.extend(yaml_prompts)

        if not sheet_prompts:
            flash("Добавьте хотя бы один промт листа для генерации.", "error")
            return redirect(url_for("index"))

        background_refs = _save_reference_uploads(
            request.files.getlist("background_references"),
            generation_id=_next_generation_id,
            prefix="bg",
        )
        detail_refs = _save_reference_uploads(
            request.files.getlist("detail_references"),
            generation_id=_next_generation_id,
            prefix="detail",
        )

        merged_background_refs = _merge_references(
            _settings.background_references, background_refs
        )
        merged_detail_refs = _merge_references(
            _settings.detail_references, detail_refs
        )

        _settings.background_references = merged_background_refs
        _settings.detail_references = merged_detail_refs
        if background_refs or detail_refs:
            save_settings(_settings)

        entry = _register_generation(
            sheet_prompts=sheet_prompts,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            background_references=merged_background_refs,
            detail_references=merged_detail_refs,
        )
        _run_generation(entry, api_key)
        return redirect(url_for("index"))

    @app.post("/regenerate/<int:generation_id>/image/<int:image_index>")
    def regenerate_image(generation_id: int, image_index: int) -> str:
        api_key = request.form.get("api_key") or _settings.api_key or None
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
            return redirect(url_for("index"))
        _ensure_image_lists(entry)
        if image_index < 0 or image_index >= len(entry.sheet_prompts):
            flash("Некорректный номер изображения для регенерации.", "error")
            return redirect(url_for("index"))
        entry.image_approvals[image_index] = False
        entry.image_statuses[image_index] = "regenerating"
        _persist_generation(entry)
        _run_generation(entry, api_key, target_index=image_index)
        return redirect(url_for("index"))

    @app.post("/settings")
    def update_settings() -> str:
        api_key = (request.form.get("saved_api_key") or "").strip()
        global _settings
        _settings = Settings(
            api_key=api_key,
            background_references=_settings.background_references,
            detail_references=_settings.detail_references,
        )
        save_settings(_settings)
        flash("Настройки сохранены и будут использоваться по умолчанию.", "success")
        return redirect(url_for("index"))

    @app.post("/settings/reference/remove")
    def remove_reference() -> str:
        reference_type = request.form.get("reference_type")
        reference_path = (request.form.get("reference_path") or "").strip()

        if reference_type not in {"background", "detail"} or not reference_path:
            flash("Не удалось удалить референс: некорректные данные.", "error")
            return redirect(url_for("index"))

        target_list = (
            _settings.background_references
            if reference_type == "background"
            else _settings.detail_references
        )

        if not _remove_reference(reference_path, target_list):
            flash("Референс не найден среди сохранённых.", "error")
            return redirect(url_for("index"))

        save_settings(_settings)
        _delete_reference_file(reference_path)
        flash("Референс удалён и больше не будет подставляться.", "success")
        return redirect(url_for("index"))

    @app.post("/approve/<int:generation_id>/image/<int:image_index>")
    def approve_image(generation_id: int, image_index: int) -> str:
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
        else:
            _ensure_image_lists(entry)
            if image_index < 0 or image_index >= len(entry.sheet_prompts):
                flash("Некорректный номер изображения для апрува.", "error")
            else:
                entry.image_approvals[image_index] = True
                entry.recalc_flags()
                _persist_generation(entry)
                flash("Изображение отмечено как понравившееся.", "success")
        return redirect(url_for("index"))

    @app.post("/export_pdf/<int:generation_id>")
    def export_pdf_route(generation_id: int):
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
            return redirect(url_for("index"))

        _ensure_image_lists(entry)
        if not entry.approved:
            flash("Нужно апрувнуть все изображения, чтобы создать PDF.", "error")
            return redirect(url_for("index"))

        valid_paths = [path for path in entry.preferred_pdf_images if path]
        if not valid_paths:
            flash("Нет изображений для формирования PDF.", "error")
            return redirect(url_for("index"))

        destination = DEFAULT_OUTPUT_DIR / f"generation-{entry.id}.pdf"
        pdf_path = export_pdf(valid_paths, destination)
        return send_from_directory(
            pdf_path.parent, pdf_path.name, as_attachment=True, download_name=pdf_path.name
        )

    @app.get("/download/<int:generation_id>/document-images")
    def download_document_images(generation_id: int):
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
            return redirect(url_for("index"))

        images = [Path(path) for path in entry.preferred_pdf_images if path]
        images = [path for path in images if path.exists()]
        if not images:
            flash("Нет готовых изображений для выгрузки.", "error")
            return redirect(url_for("index"))

        archive_path = get_generation_dir(generation_id) / "document-images.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for image in images:
                archive.write(image, arcname=image.name)

        return send_from_directory(
            archive_path.parent,
            archive_path.name,
            as_attachment=True,
            download_name=archive_path.name,
        )

    @app.route("/assets/<path:filename>")
    def serve_asset(filename: str):  # type: ignore[override]
        ensure_output_dir(DEFAULT_OUTPUT_DIR)
        return send_from_directory(DEFAULT_OUTPUT_DIR, filename)

    return app


def _find_generation(generation_id: int) -> Optional[GenerationEntry]:
    for entry in _generations:
        if entry.id == generation_id:
            return entry
    return None


def _ensure_image_lists(entry: GenerationEntry) -> None:
    expected = len(entry.sheet_prompts)
    if len(entry.image_paths) < expected:
        entry.image_paths.extend([None] * (expected - len(entry.image_paths)))
    if len(entry.image_statuses) < expected:
        entry.image_statuses.extend(["pending"] * (expected - len(entry.image_statuses)))
    if len(entry.image_approvals) < expected:
        entry.image_approvals.extend([False] * (expected - len(entry.image_approvals)))
    if len(entry.pdf_image_candidates) < expected:
        entry.pdf_image_candidates.extend([[] for _ in range(expected - len(entry.pdf_image_candidates))])


def _register_generation(
    *,
    sheet_prompts: List[str],
    aspect_ratio: str,
    resolution: str,
    background_references: Optional[List[str]] = None,
    detail_references: Optional[List[str]] = None,
) -> GenerationEntry:
    global _next_generation_id
    entry = GenerationEntry(
        id=_next_generation_id,
        sheet_prompts=sheet_prompts,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        background_references=background_references or [],
        detail_references=detail_references or [],
        status="generating",
        image_paths=[None] * len(sheet_prompts),
        image_statuses=["generating"] * len(sheet_prompts),
        image_approvals=[False] * len(sheet_prompts),
        pdf_image_candidates=[[] for _ in sheet_prompts],
    )
    _next_generation_id += 1
    _generations.insert(0, entry)
    get_generation_dir(entry.id)
    _persist_generation(entry)
    return entry


def _run_generation(
    entry: GenerationEntry, api_key: Optional[str], *, target_index: Optional[int] = None
) -> None:
    try:
        client = GeminiClient(api_key=api_key)
        generated_images: List[str] = []
        collected_text_parts: List[str] = []
        collected_alternate_images: List[List[str]] = []
        combined_prompts: List[str] = []

        _ensure_image_lists(entry)

        target_indices = (
            range(1, len(entry.sheet_prompts) + 1)
            if target_index is None
            else [target_index + 1]
        )

        for displayed_index in target_indices:
            prompt_index = displayed_index - 1
            sheet_prompt = entry.sheet_prompts[prompt_index]
            target_path = str(
                new_asset_path(
                    f"generation-{entry.id}-sheet-{displayed_index}",
                    generation_id=entry.id,
                )
            )
            full_prompt = _build_generation_prompt(
                f"Промт листа {displayed_index}: {sheet_prompt}"
            )
            entry.image_statuses[prompt_index] = (
                "regenerating" if target_index is not None else "generating"
            )
            result = client.generate_image(
                prompt=full_prompt,
                aspect_ratio=entry.aspect_ratio,
                resolution=entry.resolution,
                template_files=entry.all_references,
                output_path=target_path,
            )
            entry.image_paths[prompt_index] = result.image_path
            entry.image_statuses[prompt_index] = "ready"
            entry.image_approvals[prompt_index] = False
            entry.latest_image = result.image_path
            entry.pdf_image_candidates[prompt_index] = result.extra_images

            generated_images.append(result.image_path)
            collected_text_parts.extend(result.text_parts)
            collected_alternate_images.append(result.extra_images)
            combined_prompts.append(full_prompt)

        if target_index is None:
            entry.image_paths = generated_images
            entry.text_parts = collected_text_parts
            entry.pdf_image_candidates = collected_alternate_images
        elif collected_text_parts:
            entry.text_parts = [*entry.text_parts, *collected_text_parts]
        if target_index is not None and collected_alternate_images:
            entry.pdf_image_candidates[target_index] = collected_alternate_images[0]

        entry.recalc_flags()
        save_metadata(
            SheetRecord(
                name=f"Generation {entry.id}",
                prompt="\n\n".join(combined_prompts) if combined_prompts else entry.prompt,
                aspect_ratio=entry.aspect_ratio,
                resolution=entry.resolution,
                template_files={
                    "background_references": entry.background_references,
                    "detail_references": entry.detail_references,
                },
                latest_image=entry.latest_image,
                images=generated_images,
                text_parts=collected_text_parts,
                alternate_images=entry.pdf_image_candidates,
            ),
            generation_id=entry.id,
        )
        flash("Изображение готово и добавлено в список.", "success")
    except Exception as exc:  # noqa: BLE001
        if target_index is None:
            entry.image_statuses = ["error"] * len(entry.sheet_prompts)
        else:
            entry.image_statuses[target_index] = "error"
        entry.recalc_flags()
        flash(f"Ошибка при генерации: {exc}", "error")
    finally:
        _persist_generation(entry)


app = create_app()


def _build_generation_prompt(user_prompt: str) -> str:
    """Attach hidden style prompt to keep a consistent visual collection."""

    base_prompt = user_prompt.rstrip()
    full_prompt = f"{base_prompt}\n\n{SECRET_STYLE_PROMPT}"
    app.logger.debug("Generation prompt (no tuple syntax expected): %s", full_prompt.replace("\n", "\\n"))
    return full_prompt


def _load_yaml_prompts(upload: FileStorage) -> List[str]:
    """Parse a YAML file and extract sheet prompts.

    Supported formats:
    - A mapping with a "slides" list. Each item may be a string or a mapping with
      "body" (required) and optional "title" that is prepended to the body.
    - A top-level list of strings or mappings with the same shape as slides.
    - A single string value.
    """

    content = upload.read()
    if not content:
        raise ValueError("Файл YAML пустой.")

    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError(f"Некорректный YAML: {exc}") from exc

    prompts: List[str] = []

    def _add_prompt(title: Optional[str], body: str) -> None:
        text = body.strip()
        if not text:
            return
        if title and title.strip():
            text = f"{title.strip()}\n\n{text}"
        prompts.append(text)

    def _extract_from_entry(entry: object) -> None:
        if isinstance(entry, str):
            cleaned = entry.strip()
            if cleaned:
                prompts.append(cleaned)
            return
        if isinstance(entry, dict):
            body = entry.get("body")
            title = entry.get("title")
            if isinstance(body, str):
                _add_prompt(title if isinstance(title, str) else None, body)

    if isinstance(data, dict) and isinstance(data.get("slides"), list):
        for item in data["slides"]:
            _extract_from_entry(item)
    elif isinstance(data, list):
        for item in data:
            _extract_from_entry(item)
    elif isinstance(data, str):
        prompts.append(data.strip())

    prompts = [prompt for prompt in prompts if prompt]
    if not prompts:
        raise ValueError("В YAML не найдено ни одного промта.")

    return prompts


def _save_reference_uploads(files, *, generation_id: int, prefix: str) -> List[str]:
    saved: List[str] = []
    for upload in files:
        if not upload or not upload.filename:
            continue
        saved_path = save_uploaded_file(
            upload, prefix=f"gen-{generation_id}-{prefix}", generation_id=generation_id
        )
        saved.append(str(saved_path))
    return saved


def _merge_references(existing: List[str], uploaded: List[str]) -> List[str]:
    """Combine saved and newly uploaded references without duplicates."""

    merged = [*existing, *uploaded]
    # Preserve order while removing duplicates
    return list(dict.fromkeys(merged))


def _remove_reference(target: str, references: List[str]) -> bool:
    """Remove a saved reference path if it exists."""

    before = len(references)
    references[:] = [ref for ref in references if ref != target]
    return len(references) < before


def _delete_reference_file(path_str: str) -> None:
    """Delete a reference file from disk if it resides inside the output folder."""

    try:
        path = Path(path_str)
        if not path.is_absolute():
            path = DEFAULT_OUTPUT_DIR / path
        if path.is_file():
            path.unlink()
    except OSError:
        pass


if __name__ == "__main__":
    def _first_available_port() -> int:
        import socket

        raw_ports = os.getenv("PORT")
        candidates: list[int] = []

        if raw_ports:
            for raw in raw_ports.split(","):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    candidates.append(int(raw))
                except ValueError:
                    continue
        else:
            candidates = [5000, 5001, 5002]

        for candidate in candidates:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    sock.bind(("", candidate))
                    return candidate
            except OSError:
                continue

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("", 0))
            return sock.getsockname()[1]

    port = _first_available_port()
    app.run(host="0.0.0.0", port=port, debug=True)
