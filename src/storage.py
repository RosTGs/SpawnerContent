"""Local storage helpers for generated content."""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

DEFAULT_OUTPUT_DIR = Path("output")
DEFAULT_DESKTOP_PDF = Path.home() / "Desktop" / "gemini_output.pdf"


@dataclass
class SheetRecord:
    name: str
    prompt: str = ""
    aspect_ratio: str = "1:1"
    resolution: str = "1K"
    template_files: Dict[str, Optional[str]] = field(default_factory=dict)
    latest_image: Optional[str] = None
    text_parts: List[str] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


def ensure_output_dir(root: Path = DEFAULT_OUTPUT_DIR) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    return root


def new_asset_path(sheet_name: str, root: Path = DEFAULT_OUTPUT_DIR) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    sanitized = sheet_name.replace(" ", "_")
    return ensure_output_dir(root) / f"{sanitized}-{timestamp}.png"


def save_metadata(sheet: SheetRecord, root: Path = DEFAULT_OUTPUT_DIR) -> Path:
    ensure_output_dir(root)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    sanitized = sheet.name.replace(" ", "_")
    path = root / f"{sanitized}-{timestamp}.json"
    path.write_text(sheet.to_json(), encoding="utf-8")
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

