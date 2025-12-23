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
    new_asset_path,
    save_metadata,
    load_settings,
    save_settings,
    save_uploaded_file,
)

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
RESOLUTIONS = ["1K", "2K", "4K"]
SECRET_STYLE_PROMPT = (
    "Собирай итоговый лист из отдельных карточек, которые выглядят единым оформленным коллажем. "
    "Фон в каждой карточке одинаковый: мягкая тёплая бумага со светлой фактурой без отвлекающих узоров. "
    "Все подписи и цифры делай одним чистым гротескным шрифтом с тонкой аккуратной обводкой и одинаковыми отступами. "
    "Главный персонаж всегда узнаётся: сохраняй фирменные цвета, причёску и ключевые аксессуары, но меняй позы, эмоции и ракурс, "
    "допускай разные техники рисования в пределах общего стиля. "
    "Карточки выравниваются по единому макету с одинаковыми полями и рамками; фон и типографика не меняются между сценами. "
    "Располагай героя так, чтобы он естественно вписывался в сетку листа и не повторялся один-в-один между кадрами."
    "Создавай финальное изображение из карточек, которые визуально собираются в единый лист. "
    "Фон у всех сцен один: мягкая тёплая бумага со светлой фактурой без заметных узоров. "
    "Текст и подписи оформляй одним и тем же чистым гротескным шрифтом с аккуратной тонкой обводкой. "
    "Главный персонаж должен всегда узнаватьcя: сохраняй общую цветовую палитру, причёску и ключевые аксессуары, "
    "но меняй позы, эмоции и угол съёмки, допускай разные техники рисования в пределах одного стиля. "
    "Каждая карточка выглядит как часть коллекции: одинаковые поля, фон, шрифты и аккуратные рамки без лишних украшений. "
    "Размещай персонажа так, чтобы он естественно вписывался в общий макет и не повторялся один-в-один между кадрами."
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
        if not self.latest_image:
            return None
        path = Path(self.latest_image)
        if path.exists() or path.is_absolute():
            return path
        fallback = DEFAULT_OUTPUT_DIR / path.name
        return fallback

    @property
    def image_filename(self) -> Optional[str]:
        path = self.image_path
        if not path:
            return None
        return path.name

    @property
    def image_exists(self) -> bool:
        path = self.image_path
        return bool(path and path.exists())


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

    @app.post("/regenerate/<int:generation_id>")
    def regenerate(generation_id: int) -> str:
        api_key = request.form.get("api_key") or _settings.api_key or None
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
            return redirect(url_for("index"))
        entry.approved = False
        entry.status = "regenerating"
        _run_generation(entry, api_key)
        return redirect(url_for("index"))

    @app.post("/settings")
    def update_settings() -> str:
        api_key = (request.form.get("saved_api_key") or "").strip()
        global _settings
        _settings = Settings(api_key=api_key)
        save_settings(_settings)
        flash("Настройки сохранены и будут использоваться по умолчанию.", "success")
        return redirect(url_for("index"))

    @app.post("/approve/<int:generation_id>")
    def approve(generation_id: int) -> str:
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
        else:
            entry.approved = True
            entry.status = "approved"
            flash("Визуализация отмечена как понравившаяся.", "success")
        return redirect(url_for("index"))

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
    )
    _next_generation_id += 1
    _generations.insert(0, entry)
    return entry


def _run_generation(entry: GenerationEntry, api_key: Optional[str]) -> None:
    try:
        client = GeminiClient(api_key=api_key)
        target_path = str(new_asset_path(f"generation-{entry.id}"))
        full_prompt = _build_generation_prompt(entry.prompt)
        result = client.generate_image(
            prompt=full_prompt,
            aspect_ratio=entry.aspect_ratio,
            resolution=entry.resolution,
            template_files=entry.all_references,
            output_path=target_path,
        )
        entry.latest_image = result.image_path
        entry.text_parts = result.text_parts
        entry.status = "ready"
        save_metadata(
            SheetRecord(
                name=f"Generation {entry.id}",
                prompt=full_prompt,
                aspect_ratio=entry.aspect_ratio,
                resolution=entry.resolution,
                template_files={
                    "background_references": entry.background_references,
                    "detail_references": entry.detail_references,
                },
                latest_image=result.image_path,
                text_parts=result.text_parts,
            )
        )
        flash("Изображение готово и добавлено в список.", "success")
    except Exception as exc:  # noqa: BLE001
        entry.status = "error"
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
