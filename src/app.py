"""Flask web interface for Gemini image generation."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)

from .gemini_client import GeminiClient
from .storage import (
    DEFAULT_OUTPUT_DIR,
    Settings,
    SheetRecord,
    ensure_output_dir,
    export_pdf,
    new_asset_path,
    save_metadata,
    load_settings,
    save_settings,
    save_uploaded_file,
)

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
RESOLUTIONS = ["1K", "2K", "4K"]
SECRET_STYLE_PROMPT = (
    "Фон в каждой карточке одинаковый"
    "Все подписи и цифры делай одним шрифтом"
    "Главный персонаж всегда узнаётся: сохраняй фирменные цвета, причёску и ключевые аксессуары, но меняй позы, эмоции и ракурс, "
    "допускай разные техники рисования в пределах общего стиля референсов "
    "Располагай героя так, чтобы он естественно вписывался в сетку листа и не повторялся один-в-один между кадрами."
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
    background_references: List[str] = field(default_factory=list)
    detail_references: List[str] = field(default_factory=list)
    text_parts: List[str] = field(default_factory=list)
    status: str = "pending"
    approved: bool = False

    @property
    def prompt(self) -> str:
        numbered = [f"Промт листа {idx + 1}: {text}" for idx, text in enumerate(self.sheet_prompts)]
        return "\n\n".join(numbered)

    @property
    def all_references(self) -> List[str]:
        return [*self.background_references, *self.detail_references]

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


def create_app() -> Flask:
    app = Flask(__name__)
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

    @app.post("/generate")
    def generate() -> str:
        api_key = request.form.get("api_key") or _settings.api_key or None
        aspect_ratio = request.form.get("aspect_ratio", ASPECT_RATIOS[0])
        resolution = request.form.get("resolution", RESOLUTIONS[0])
        sheet_prompts = [block.strip() for block in request.form.getlist("sheet_prompts") if block.strip()]

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

        entry = _register_generation(
            sheet_prompts=sheet_prompts,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            background_references=background_refs,
            detail_references=detail_refs,
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
        _run_generation(entry, api_key, target_index=image_index)
        return redirect(url_for("index"))

    @app.post("/settings")
    def update_settings() -> str:
        api_key = (request.form.get("saved_api_key") or "").strip()
        global _settings
        _settings = Settings(api_key=api_key)
        save_settings(_settings)
        flash("Настройки сохранены и будут использоваться по умолчанию.", "success")
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

        valid_paths = [path for path in entry.image_paths if path]
        if not valid_paths:
            flash("Нет изображений для формирования PDF.", "error")
            return redirect(url_for("index"))

        destination = DEFAULT_OUTPUT_DIR / f"generation-{entry.id}.pdf"
        pdf_path = export_pdf(valid_paths, destination)
        return send_from_directory(
            pdf_path.parent, pdf_path.name, as_attachment=True, download_name=pdf_path.name
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
    )
    _next_generation_id += 1
    _generations.insert(0, entry)
    return entry


def _run_generation(
    entry: GenerationEntry, api_key: Optional[str], *, target_index: Optional[int] = None
) -> None:
    try:
        client = GeminiClient(api_key=api_key)
        generated_images: List[str] = []
        collected_text_parts: List[str] = []
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
            target_path = str(new_asset_path(f"generation-{entry.id}-sheet-{displayed_index}"))
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

            generated_images.append(result.image_path)
            collected_text_parts.extend(result.text_parts)
            combined_prompts.append(full_prompt)

        if target_index is None:
            entry.image_paths = generated_images
            entry.text_parts = collected_text_parts
        elif collected_text_parts:
            entry.text_parts = [*entry.text_parts, *collected_text_parts]

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
            )
        )
        flash("Изображение готово и добавлено в список.", "success")
    except Exception as exc:  # noqa: BLE001
        if target_index is None:
            entry.image_statuses = ["error"] * len(entry.sheet_prompts)
        else:
            entry.image_statuses[target_index] = "error"
        entry.recalc_flags()
        flash(f"Ошибка при генерации: {exc}", "error")


app = create_app()


def _build_generation_prompt(user_prompt: str) -> str:
    """Attach hidden style prompt to keep a consistent visual collection."""

    return f"{user_prompt}\n\n{SECRET_STYLE_PROMPT}"


def _save_reference_uploads(files, *, generation_id: int, prefix: str) -> List[str]:
    saved: List[str] = []
    for upload in files:
        if not upload or not upload.filename:
            continue
        saved_path = save_uploaded_file(upload, prefix=f"gen-{generation_id}-{prefix}")
        saved.append(str(saved_path))
    return saved


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
