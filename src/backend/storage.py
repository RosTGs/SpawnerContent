"""Local storage helpers for generated content."""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from PIL import Image

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR_ENV_VAR = "SPAWNER_DATA_DIR"


def _resolve_output_dir() -> Path:
    env_dir = os.getenv(DATA_DIR_ENV_VAR)
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    return BASE_DIR / "output"


DEFAULT_OUTPUT_DIR = _resolve_output_dir()
DEFAULT_DESKTOP_PDF = Path.home() / "Desktop" / "gemini_output.pdf"
SETTINGS_FILE = DEFAULT_OUTPUT_DIR / "settings.json"


@dataclass
class SheetRecord:
    name: str
    prompt: str = ""
    aspect_ratio: str = "1:1"
    resolution: str = "1K"
    template_files: Dict[str, object] = field(default_factory=dict)
    latest_image: Optional[str] = None
    images: List[str] = field(default_factory=list)
    text_parts: List[str] = field(default_factory=list)
    alternate_images: List[List[str]] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


@dataclass
class Settings:
    """Persisted user preferences for the application."""

    api_key: str = ""
    background_references: List[str] = field(default_factory=list)
    detail_references: List[str] = field(default_factory=list)


def ensure_output_dir(root: Path = DEFAULT_OUTPUT_DIR) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_generation_dir(generation_id: int, root: Path = DEFAULT_OUTPUT_DIR) -> Path:
    return ensure_output_dir(root / f"generation-{generation_id}")


def new_asset_path(
    sheet_name: str, *, generation_id: Optional[int] = None, root: Path = DEFAULT_OUTPUT_DIR
) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    sanitized = sheet_name.replace(" ", "_")
    base_dir = get_generation_dir(generation_id, root) if generation_id else ensure_output_dir(root)
    return base_dir / f"{sanitized}-{timestamp}.png"


def save_metadata(
    sheet: SheetRecord,
    *,
    generation_id: Optional[int] = None,
    root: Path = DEFAULT_OUTPUT_DIR,
) -> Path:
    base_dir = get_generation_dir(generation_id, root) if generation_id else ensure_output_dir(root)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    sanitized = sheet.name.replace(" ", "_")
    path = base_dir / f"{sanitized}-{timestamp}.json"
    path.write_text(sheet.to_json(), encoding="utf-8")
    return path


def load_settings(path: Path = SETTINGS_FILE) -> Settings:
    """Load persisted settings from disk."""

    ensure_output_dir(path.parent)
    if not path.exists():
        return Settings()
    raw = json.loads(path.read_text(encoding="utf-8"))
    return Settings(
        api_key=raw.get("api_key", ""),
        background_references=raw.get("background_references", []),
        detail_references=raw.get("detail_references", []),
    )


def save_settings(settings: Settings, path: Path = SETTINGS_FILE) -> Path:
    """Persist current settings to disk."""

    ensure_output_dir(path.parent)
    path.write_text(json.dumps(asdict(settings), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def save_uploaded_file(
    upload: FileStorage,
    *,
    prefix: str,
    generation_id: Optional[int] = None,
    root: Path = DEFAULT_OUTPUT_DIR,
) -> Path:
    """Save a user uploaded file inside the output directory."""

    base_dir = get_generation_dir(generation_id, root) if generation_id else ensure_output_dir(root)
    sanitized_prefix = prefix.replace(" ", "_")
    filename = secure_filename(upload.filename or "uploaded")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    path = base_dir / f"{sanitized_prefix}-{timestamp}-{filename}"
    upload.save(path)
    return path


def export_pdf(image_paths: List[str], destination: Path) -> Path:
    if not image_paths:
        raise ValueError("No images to include in the PDF.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pil_images: List[Image.Image] = []
    for path in image_paths:
        pil_images.append(Image.open(path).convert("RGB"))
    first, *rest = pil_images
    first.save(destination, save_all=True, append_images=rest, format="PDF")
    return destination

