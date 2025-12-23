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
    SheetRecord,
    ensure_output_dir,
    new_asset_path,
    save_metadata,
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
    blocks: List[str]
    aspect_ratio: str
    resolution: str
    latest_image: Optional[str] = None
    text_parts: List[str] = field(default_factory=list)
    status: str = "pending"
    approved: bool = False

    @property
    def prompt(self) -> str:
        return "\n\n".join(self.blocks)

    @property
    def image_filename(self) -> Optional[str]:
        if not self.latest_image:
            return None
        return Path(self.latest_image).name


_generations: List[GenerationEntry] = []
_next_generation_id = 1


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
        return render_template(
            "index.html",
            generations=_generations,
        )

    @app.post("/generate")
    def generate() -> str:
        api_key = request.form.get("api_key") or None
        aspect_ratio = request.form.get("aspect_ratio", ASPECT_RATIOS[0])
        resolution = request.form.get("resolution", RESOLUTIONS[0])
        blocks = [block.strip() for block in request.form.getlist("prompt_blocks") if block.strip()]

        if not blocks:
            flash("Добавьте хотя бы один блок с текстом для генерации.", "error")
            return redirect(url_for("index"))

        entry = _register_generation(blocks=blocks, aspect_ratio=aspect_ratio, resolution=resolution)
        _run_generation(entry, api_key)
        return redirect(url_for("index"))

    @app.post("/regenerate/<int:generation_id>")
    def regenerate(generation_id: int) -> str:
        api_key = request.form.get("api_key") or None
        entry = _find_generation(generation_id)
        if not entry:
            flash("Не удалось найти указанную генерацию.", "error")
            return redirect(url_for("index"))
        entry.approved = False
        entry.status = "regenerating"
        _run_generation(entry, api_key)
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


def _register_generation(*, blocks: List[str], aspect_ratio: str, resolution: str) -> GenerationEntry:
    global _next_generation_id
    entry = GenerationEntry(
        id=_next_generation_id,
        blocks=blocks,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
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
            template_files=[],
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
                template_files={},
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


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
