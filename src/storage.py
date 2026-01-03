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

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = BASE_DIR / "output"
DEFAULT_DESKTOP_PDF = Path.home() / "Desktop" / "gemini_output.pdf"
SETTINGS_FILE = DEFAULT_OUTPUT_DIR / "settings.json"
DATA_DIR = DEFAULT_OUTPUT_DIR / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"
PROJECT_DETAILS_FILE = DATA_DIR / "project_details.json"
TEMPLATES_FILE = DATA_DIR / "templates.json"
ASSETS_FILE = DATA_DIR / "assets.json"
GENERATIONS_FILE = DATA_DIR / "generations.json"


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


@dataclass
class ProjectRecord:
    """Entity describing a project with linked templates and assets."""

    id: int
    name: str
    owner: str = ""
    description: str = ""
    author: str = ""
    status: str = "active"
    created_at: str = ""
    updated_at: str = ""
    template_ids: List[int] = field(default_factory=list)
    asset_ids: List[int] = field(default_factory=list)

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "ProjectRecord":
        return cls(
            id=int(payload.get("id", 0)),
            name=str(payload.get("name", "")),
            owner=str(payload.get("owner", "")),
            description=str(payload.get("description", "")),
            author=str(payload.get("author", "")),
            status=str(payload.get("status", "active")),
            created_at=str(payload.get("created_at", "")),
            updated_at=str(payload.get("updated_at", "")),
            template_ids=[int(value) for value in payload.get("template_ids", [])],
            asset_ids=[int(value) for value in payload.get("asset_ids", [])],
        )


@dataclass
class TemplateRecord:
    """Template preset stored in the local catalog."""

    id: int
    name: str
    kind: str = "text"
    category: str = ""
    description: str = ""
    content: str = ""
    author: str = ""
    status: str = "draft"
    created_at: str = ""
    updated_at: str = ""
    used_by: int = 0

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "TemplateRecord":
        return cls(
            id=int(payload.get("id", 0)),
            name=str(payload.get("name", "")),
            kind=str(payload.get("kind", payload.get("category", "text"))),
            category=str(payload.get("category", "")),
            description=str(payload.get("description", "")),
            content=str(payload.get("content", "")),
            author=str(payload.get("author", "")),
            status=str(payload.get("status", "draft")),
            created_at=str(payload.get("created_at", "")),
            updated_at=str(payload.get("updated_at", "")),
            used_by=int(payload.get("used_by", 0)),
        )


@dataclass
class AssetRecord:
    """Uploaded or generated asset with linkage to projects/templates."""

    id: int
    filename: str
    kind: str = ""
    size: str = ""
    description: str = ""
    author: str = ""
    path: str = ""
    created_at: str = ""
    template_ids: List[int] = field(default_factory=list)
    project_ids: List[int] = field(default_factory=list)

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "AssetRecord":
        return cls(
            id=int(payload.get("id", 0)),
            filename=str(payload.get("filename", "")),
            kind=str(payload.get("kind", "")),
            size=str(payload.get("size", "")),
            description=str(payload.get("description", "")),
            author=str(payload.get("author", "")),
            path=str(payload.get("path", "")),
            created_at=str(payload.get("created_at", "")),
            template_ids=[int(value) for value in payload.get("template_ids", [])],
            project_ids=[int(value) for value in payload.get("project_ids", [])],
        )


@dataclass
class GenerationRecord:
    """Persisted generation state used to restore progress after рестартов."""

    id: int
    sheet_prompts: List[str]
    aspect_ratio: str
    resolution: str
    owner: str = ""
    created_at: str = ""
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
    error_message: str = ""

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "GenerationRecord":
        return cls(
            id=int(payload.get("id", 0)),
            owner=str(payload.get("owner", "")),
            created_at=str(payload.get("created_at", "")),
            sheet_prompts=list(payload.get("sheet_prompts", [])),
            aspect_ratio=str(payload.get("aspect_ratio", "1:1")),
            resolution=str(payload.get("resolution", "1K")),
            latest_image=payload.get("latest_image"),
            image_paths=list(payload.get("image_paths", [])),
            image_statuses=list(payload.get("image_statuses", [])),
            image_approvals=list(payload.get("image_approvals", [])),
            pdf_image_candidates=list(payload.get("pdf_image_candidates", [])),
            background_references=list(payload.get("background_references", [])),
            detail_references=list(payload.get("detail_references", [])),
            text_parts=list(payload.get("text_parts", [])),
            status=str(payload.get("status", "pending")),
            approved=bool(payload.get("approved", False)),
            error_message=str(payload.get("error_message", "")),
        )


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


def ensure_data_dir(root: Path = DATA_DIR) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    return root


def _load_records(path: Path) -> List[dict]:
    ensure_data_dir(path.parent)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    except json.JSONDecodeError:
        return []
    return []


def _save_records(path: Path, records: List[dict]) -> Path:
    ensure_data_dir(path.parent)
    path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _load_mapping(path: Path) -> Dict[str, object]:
    ensure_data_dir(path.parent)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        return {}
    return {}


def _save_mapping(path: Path, mapping: Dict[str, object]) -> Path:
    ensure_data_dir(path.parent)
    path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_projects(path: Path = PROJECTS_FILE) -> List[ProjectRecord]:
    return [ProjectRecord.from_dict(item) for item in _load_records(path)]


def save_projects(projects: List[ProjectRecord], path: Path = PROJECTS_FILE) -> Path:
    return _save_records(path, [asdict(project) for project in projects])


def load_project_details(path: Path = PROJECT_DETAILS_FILE) -> Dict[int, dict]:
    raw = _load_mapping(path)
    normalized: Dict[int, dict] = {}
    for key, value in raw.items():
        try:
            project_id = int(key)
        except (TypeError, ValueError):
            continue
        if isinstance(value, dict):
            normalized[project_id] = value
    return normalized


def save_project_details(details: Dict[int, dict], path: Path = PROJECT_DETAILS_FILE) -> Path:
    prepared = {str(key): value for key, value in details.items()}
    return _save_mapping(path, prepared)


def load_templates(path: Path = TEMPLATES_FILE) -> List[TemplateRecord]:
    return [TemplateRecord.from_dict(item) for item in _load_records(path)]


def save_templates(templates: List[TemplateRecord], path: Path = TEMPLATES_FILE) -> Path:
    return _save_records(path, [asdict(template) for template in templates])


def load_assets(path: Path = ASSETS_FILE) -> List[AssetRecord]:
    return [AssetRecord.from_dict(item) for item in _load_records(path)]


def save_assets(assets: List[AssetRecord], path: Path = ASSETS_FILE) -> Path:
    return _save_records(path, [asdict(asset) for asset in assets])


def load_generations(path: Path = GENERATIONS_FILE) -> List[GenerationRecord]:
    return [GenerationRecord.from_dict(item) for item in _load_records(path)]


def save_generations(generations: List[GenerationRecord], path: Path = GENERATIONS_FILE) -> Path:
    return _save_records(path, [asdict(generation) for generation in generations])


def _maybe_downscale_image(path: Path, max_side: int) -> None:
    """Downscale an image in place if its bigger side exceeds the limit.

    The function is intentionally tolerant to errors: if the file is not an
    image or Pillow cannot process it, the original file is left untouched.
    """

    try:
        with Image.open(path) as image:
            width, height = image.size
            bigger_side = max(width, height)
            if bigger_side <= max_side:
                return

            scale_factor = max_side / float(bigger_side)
            new_size = (int(width * scale_factor), int(height * scale_factor))
            resized = image.resize(new_size, Image.LANCZOS)
            resized.save(path, optimize=True)
    except Exception:  # noqa: BLE001
        # Non-image uploads (or unsupported formats) should remain as-is.
        return


def save_uploaded_file(
    upload: FileStorage,
    *,
    prefix: str,
    root: Path = DEFAULT_OUTPUT_DIR,
    max_image_side: int | None = 2000,
) -> Path:
    """Save a user uploaded file inside the output directory.

    If ``max_image_side`` is set, image uploads are downscaled so that their
    bigger side does not exceed the limit. This keeps heavy templates and
    персонажи within ~2K resolution while still accepting large source files.
    """

    ensure_output_dir(root)
    sanitized_prefix = prefix.replace(" ", "_")
    filename = secure_filename(upload.filename or "uploaded")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    path = root / f"{sanitized_prefix}-{timestamp}-{filename}"
    upload.save(path)

    if max_image_side:
        _maybe_downscale_image(path, max_image_side)

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

