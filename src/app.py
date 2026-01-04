"""Flask web interface for Gemini image generation."""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from flask import (
    Flask,
    jsonify,
    make_response,
    render_template,
    request,
    send_from_directory,
    url_for,
)
import yaml
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.datastructures import FileStorage
from werkzeug.security import check_password_hash, generate_password_hash

from .gemini_client import GeminiClient
from .storage import (
    ASSETS_FILE,
    DATA_DIR,
    DEFAULT_OUTPUT_DIR,
    GENERATIONS_FILE,
    PROJECT_DETAILS_FILE,
    PROJECTS_FILE,
    SETTINGS_FILE,
    TEMPLATES_FILE,
    AssetRecord,
    GenerationRecord,
    ProjectRecord,
    Settings,
    SheetRecord,
    TemplateRecord,
    ensure_data_dir,
    ensure_output_dir,
    export_pdf,
    load_assets,
    load_project_details,
    load_generations,
    load_projects,
    load_settings,
    load_templates,
    new_asset_path,
    save_assets,
    save_project_details,
    save_generations,
    save_metadata,
    save_projects,
    save_settings,
    save_templates,
    save_uploaded_file,
)
from .localization import (
    dump_translations_json,
    get_frontend_translations,
    get_translations,
    translate,
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
TEMPLATE_KINDS = {"text", "background", "layout"}
USERS_FILE = DATA_DIR / "users.json"


@dataclass
class GenerationEntry:
    """Represents a single generation request and its results."""

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


def _fill_generation_lists(entry: GenerationEntry) -> None:
    expected = len(entry.sheet_prompts)
    if len(entry.image_paths) < expected:
        entry.image_paths.extend([None] * (expected - len(entry.image_paths)))
    if len(entry.image_statuses) < expected:
        entry.image_statuses.extend(["pending"] * (expected - len(entry.image_statuses)))
    if len(entry.image_approvals) < expected:
        entry.image_approvals.extend([False] * (expected - len(entry.image_approvals)))
    if len(entry.pdf_image_candidates) < expected:
        entry.pdf_image_candidates.extend(
            [[] for _ in range(expected - len(entry.pdf_image_candidates))]
        )


def _generation_from_record(record: GenerationRecord) -> GenerationEntry:
    entry = GenerationEntry(
        id=record.id,
        owner=getattr(record, "owner", ""),
        created_at=getattr(record, "created_at", ""),
        sheet_prompts=record.sheet_prompts,
        aspect_ratio=record.aspect_ratio,
        resolution=record.resolution,
        latest_image=record.latest_image,
        image_paths=record.image_paths,
        image_statuses=record.image_statuses,
        image_approvals=record.image_approvals,
        pdf_image_candidates=record.pdf_image_candidates,
        background_references=record.background_references,
        detail_references=record.detail_references,
        text_parts=record.text_parts,
        status=record.status,
        approved=record.approved,
        error_message=getattr(record, "error_message", ""),
    )
    _fill_generation_lists(entry)
    entry.recalc_flags()
    return entry


def _record_from_generation(entry: GenerationEntry) -> GenerationRecord:
    _fill_generation_lists(entry)
    entry.recalc_flags()
    return GenerationRecord(
        id=entry.id,
        owner=entry.owner,
        created_at=entry.created_at,
        sheet_prompts=list(entry.sheet_prompts),
        aspect_ratio=entry.aspect_ratio,
        resolution=entry.resolution,
        latest_image=entry.latest_image,
        image_paths=list(entry.image_paths),
        image_statuses=list(entry.image_statuses),
        image_approvals=list(entry.image_approvals),
        pdf_image_candidates=list(entry.pdf_image_candidates),
        background_references=list(entry.background_references),
        detail_references=list(entry.detail_references),
        text_parts=list(entry.text_parts),
        status=entry.status,
        approved=entry.approved,
        error_message=entry.error_message,
    )


def _default_project_data() -> dict[str, object]:
    return {
        "templates": [],
        "assets": [],
        "pages": [
            {
                "id": f"page-{int(time.time() * 1000)}",
                "title": "Страница 1",
                "body": "",
                "image": "",
            }
        ],
        "generated": None,
        "archive": [],
        "status": "idle",
        "statusNote": "",
        "pdfVersion": None,
        "updatedAt": _timestamp(),
    }


ensure_output_dir(DEFAULT_OUTPUT_DIR)
ensure_data_dir(DATA_DIR)
_settings: Settings = load_settings()
_channel_lookup: dict[str, object] | None = None
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_projects: list[ProjectRecord] = load_projects(PROJECTS_FILE)
_templates: list[TemplateRecord] = load_templates(TEMPLATES_FILE)
_assets: list[AssetRecord] = load_assets(ASSETS_FILE)
_project_details: dict[int, dict] = load_project_details(PROJECT_DETAILS_FILE)
_generations: list[GenerationEntry] = [
    _generation_from_record(record) for record in load_generations(GENERATIONS_FILE)
]
_next_generation_id = 1 + max((entry.id for entry in _generations), default=0)
_next_project_id = 1 + max((project.id for project in _projects), default=0)
_next_template_id = 1 + max((template.id for template in _templates), default=0)
_next_asset_id = 1 + max((asset.id for asset in _assets), default=0)
_users: list[dict[str, object]] = []


def _load_users() -> list[dict[str, object]]:
    try:
        if USERS_FILE.exists():
            with USERS_FILE.open(encoding="utf-8") as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    return [
                        entry
                        for entry in data
                        if isinstance(entry, dict) and "username" in entry
                    ]
    except (OSError, json.JSONDecodeError):
        return []
    return []


def _save_users() -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with USERS_FILE.open("w", encoding="utf-8") as fh:
        json.dump(_users, fh, ensure_ascii=False, indent=2)


def _find_user_record(username: str) -> dict[str, object] | None:
    username_lower = username.lower()
    return next(
        (entry for entry in _users if str(entry.get("username", "")).lower() == username_lower),
        None,
    )


_users = _load_users()


def _timestamp() -> str:
    return datetime.utcnow().isoformat()


def _public_user(user: dict[str, object]) -> dict[str, object]:
    return {
        "username": str(user.get("username", "")),
        "created_at": str(user.get("created_at", "")),
    }


def _sync_relations() -> None:
    asset_lookup = {asset.id: asset for asset in _assets}
    for asset in _assets:
        asset.project_ids = [pid for pid in asset.project_ids if pid]
        asset.template_ids = [tid for tid in asset.template_ids if tid]

    for project in _projects:
        for asset_id in project.asset_ids:
            asset = asset_lookup.get(asset_id)
            if asset and project.id not in asset.project_ids:
                asset.project_ids.append(project.id)

    template_usage: dict[int, int] = {template.id: 0 for template in _templates}
    for project in _projects:
        for template_id in project.template_ids:
            template_usage[template_id] = template_usage.get(template_id, 0) + 1
    for template in _templates:
        template.used_by = template_usage.get(template.id, 0)


def _persist_catalogs() -> None:
    save_projects(_projects, PROJECTS_FILE)
    save_templates(_templates, TEMPLATES_FILE)
    save_assets(_assets, ASSETS_FILE)


def _persist_generations() -> None:
    save_generations([_record_from_generation(entry) for entry in _generations], GENERATIONS_FILE)


def _persist_project_details() -> None:
    save_project_details(_project_details, PROJECT_DETAILS_FILE)


def _normalize_project_data(payload: dict[str, object]) -> dict[str, object]:
    base = _default_project_data()

    def _sanitize_items(key: str) -> list[dict[str, object]]:
        raw_value = payload.get(key, base.get(key, []))
        if not isinstance(raw_value, list):
            return list(base.get(key, []))
        return [item for item in raw_value if isinstance(item, dict)]

    pages: list[dict[str, object]] = []
    for index, page in enumerate(_sanitize_items("pages")):
        pages.append(
            {
                "id": str(page.get("id") or f"page-{int(time.time() * 1000) + index}"),
                "title": str(page.get("title", "")),
                "body": str(page.get("body", "")),
                "image": str(page.get("image", "")),
            }
        )

    templates: list[dict[str, object]] = []
    for template in _sanitize_items("templates"):
        templates.append(
            {
                "id": template.get("id"),
                "name": template.get("name"),
                "text": template.get("text", ""),
                "kind": template.get("kind", ""),
                "description": template.get("description", ""),
                "assetUrl": template.get("assetUrl") or template.get("asset_url"),
            }
        )

    assets: list[dict[str, object]] = []
    for asset in _sanitize_items("assets"):
        assets.append(
            {
                "id": asset.get("id"),
                "name": asset.get("name"),
                "role": asset.get("role", ""),
                "kind": asset.get("kind", ""),
            }
        )

    generated = payload.get("generated") if isinstance(payload.get("generated"), dict) else None
    archive = _sanitize_items("archive")

    status = str(payload.get("status", base["status"]))
    status_note = str(payload.get("statusNote", base["statusNote"]))
    pdf_version = payload.get("pdfVersion") if payload.get("pdfVersion") else None
    updated_at = str(payload.get("updatedAt") or _timestamp())

    return {
        "templates": templates,
        "assets": assets,
        "pages": pages or base["pages"],
        "generated": generated,
        "archive": archive,
        "status": status,
        "statusNote": status_note,
        "pdfVersion": pdf_version,
        "updatedAt": updated_at,
    }


def _project_data_for(project_id: int, *, create: bool = True) -> dict[str, object]:
    data = _project_details.get(project_id)
    if isinstance(data, dict):
        return data
    if not create:
        return {}
    fresh = _default_project_data()
    _project_details[project_id] = fresh
    _persist_project_details()
    return fresh


def _serialize_project(project: ProjectRecord) -> dict[str, object]:
    return {
        "id": project.id,
        "name": project.name,
        "owner": project.owner,
        "description": project.description,
        "author": project.author,
        "status": project.status,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "templates": len(project.template_ids),
        "assets": len(project.asset_ids),
        "template_ids": project.template_ids,
        "asset_ids": project.asset_ids,
    }


def _apply_detail_relations(project: ProjectRecord, details: dict[str, object]) -> None:
    template_ids: list[int] = []
    for template in details.get("templates", []):
        try:
            template_ids.append(int(template.get("id", 0)))
        except (TypeError, ValueError):
            continue

    asset_ids: list[int] = []
    for asset in details.get("assets", []):
        try:
            asset_ids.append(int(asset.get("id", 0)))
        except (TypeError, ValueError):
            continue

    project.template_ids = [item for item in sorted(set(template_ids)) if item]
    project.asset_ids = [item for item in sorted(set(asset_ids)) if item]
    project.updated_at = _timestamp()


def _serialize_template(template: TemplateRecord) -> dict[str, object]:
    payload = {
        "id": template.id,
        "name": template.name,
        "kind": template.kind,
        "category": template.category,
        "description": template.description,
        "content": template.content,
        "author": template.author,
        "status": template.status,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "used_by": template.used_by,
    }

    asset_url = _asset_url_for_path(template.content)
    if template.kind in {"background", "layout"} and asset_url:
        payload["asset_url"] = asset_url

    return payload


def _serialize_asset(asset: AssetRecord) -> dict[str, object]:
    payload = {
        "id": asset.id,
        "filename": asset.filename,
        "kind": asset.kind,
        "size": asset.size,
        "description": asset.description,
        "author": asset.author,
        "created_at": asset.created_at,
        "project_ids": asset.project_ids,
        "template_ids": asset.template_ids,
        "project_count": len(asset.project_ids),
        "path": asset.path,
    }

    asset_url = _asset_url_for_path(asset.path)
    if asset_url:
        payload["asset_url"] = asset_url

    return payload


def _parse_ids(raw_value: object) -> list[int]:
    if isinstance(raw_value, list):
        return [int(item) for item in raw_value if str(item).strip().isdigit()]
    if isinstance(raw_value, str):
        return [int(item) for item in raw_value.split(",") if item.strip().isdigit()]
    return []


def _asset_url_for_path(path_value: str | None) -> str | None:
    if not path_value:
        return None

    path = Path(path_value)
    if not path.is_absolute():
        path = DEFAULT_OUTPUT_DIR / path.name

    if path.name:
        return url_for("serve_asset", filename=path.name)
    return None


_sync_relations()


def _find_project(project_id: int, owner: str | None = None) -> ProjectRecord | None:
    owner_lower = owner.lower() if owner else None
    return next(
        (
            item
            for item in _projects
            if item.id == project_id
            and (owner_lower is None or item.owner.lower() == owner_lower)
        ),
        None,
    )


def _find_template(template_id: int) -> TemplateRecord | None:
    return next((item for item in _templates if item.id == template_id), None)


def _find_asset(asset_id: int) -> AssetRecord | None:
    return next((item for item in _assets if item.id == asset_id), None)


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "dev-secret")
    app.logger.setLevel(logging.INFO)

    root_logger = logging.getLogger()
    if root_logger.level > logging.INFO:
        root_logger.setLevel(logging.INFO)

    gunicorn_logger = logging.getLogger("gunicorn.error")
    if gunicorn_logger.handlers:
        app.logger.handlers = gunicorn_logger.handlers
        app.logger.setLevel(gunicorn_logger.level or logging.INFO)
    admin_email = os.getenv("ADMIN_EMAIL", "").strip()
    admin_password_hash = os.getenv("ADMIN_PASSWORD_HASH", "").strip()
    admin_access_token = os.getenv("ADMIN_ACCESS_TOKEN", "").strip()
    translations = get_translations()
    available_languages = sorted(translations.keys())
    token_serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="auth-token")
    token_ttl_seconds = 60 * 60 * 24 * 7

    def _generate_token(username: str) -> str:
        return token_serializer.dumps({"username": username, "ts": _timestamp()})

    def _find_user_by_token(token: str) -> dict[str, object] | None:
        try:
            data = token_serializer.loads(token, max_age=token_ttl_seconds)
        except (BadSignature, SignatureExpired):
            return None

        username = data.get("username")
        if not username:
            return None
        return _find_user_record(str(username))

    def _authenticated_user() -> dict[str, object] | None:
        header = request.headers.get("Authorization", "")
        token = None
        if isinstance(header, str) and header.lower().startswith("bearer "):
            token = header.split(" ", 1)[1].strip()
        if not token:
            token = request.cookies.get("auth_token") or None

        return _find_user_by_token(token) if token else None

    def _admin_settings_present() -> bool:
        return bool(admin_email and admin_password_hash)

    def _ensure_admin_record() -> dict[str, object] | None:
        if not _admin_settings_present():
            return None

        record = _find_user_record(admin_email)
        if not record:
            record = {
                "username": admin_email,
                "password_hash": admin_password_hash,
                "created_at": _timestamp(),
            }
            _users.append(record)
            _save_users()
        elif record.get("password_hash") != admin_password_hash:
            record["password_hash"] = admin_password_hash
            _save_users()
        return record

    def _auth_response(user: dict[str, object]) -> dict[str, object]:
        return {"token": _generate_token(str(user.get("username", ""))), "user": _public_user(user)}

    def _resolve_language() -> str:
        lang = request.args.get("lang") or request.cookies.get("lang")
        if lang in translations:
            return lang
        return "ru"

    @app.context_processor
    def inject_globals() -> dict[str, object]:
        lang = _resolve_language()
        return {
            "ASPECT_RATIOS": ASPECT_RATIOS,
            "RESOLUTIONS": RESOLUTIONS,
            "STATUS_LABELS": STATUS_LABELS,
        }

    @app.context_processor
    def inject_localization() -> dict[str, object]:
        lang = _resolve_language()
        return {
            "t": lambda key: translate(key, lang),
            "current_language": lang,
            "available_languages": available_languages,
            "frontend_translations": get_frontend_translations(lang),
            "frontend_translations_json": dump_translations_json(lang),
        }

    def _render_projects_page() -> object:
        """Serve the SPA bundle or fall back to the legacy template."""

        index_file = STATIC_DIR / "index.html"
        if SPA_ENABLED and index_file.exists():
            return send_from_directory(STATIC_DIR, "index.html")

        lang = _resolve_language()
        return render_template(
            "projects.html",
            page="projects",
            title=translate("projects.title", lang),
        )

    @app.route("/")
    def index() -> object:
        return _render_projects_page()

    @app.route("/projects")
    @app.route("/project")
    @app.route("/project/<path:subpath>")
    def projects_page(subpath: Optional[str] = None) -> object:
        return _render_projects_page()

    @app.route("/templates")
    def templates_page() -> object:
        lang = _resolve_language()
        return render_template(
            "templates.html",
            page="templates",
            title=translate("templates.title", lang),
        )

    @app.route("/assets")
    def assets_page() -> object:
        lang = _resolve_language()
        return render_template(
            "assets.html",
            page="assets",
            title=translate("assets.title", lang),
        )

    @app.route("/settings")
    def settings_page() -> object:
        lang = _resolve_language()
        return render_template(
            "settings.html",
            page="settings",
            title=translate("settings.title", lang),
        )

    @app.get("/api/status")
    def status() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify(_status_payload(None))

        return jsonify(_status_payload(user))

    @app.get("/api/history")
    def history() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        username = str(user.get("username", ""))
        items: list[dict[str, object]] = []

        for entry in _generations:
            if entry.owner.lower() != username.lower():
                continue

            for image in entry.images:
                if not image.get("exists"):
                    continue

                items.append(
                    {
                        "generationId": entry.id,
                        "sheetIndex": int(image.get("index", 0)),
                        "status": str(image.get("status", "")),
                        "approved": bool(image.get("approved", False)),
                        "assetUrl": _asset_url_for_path(str(image.get("asset_name"))),
                        "filename": str(image.get("filename", "")),
                        "createdAt": entry.created_at,
                    }
                )

        items.sort(
            key=lambda item: (
                str(item.get("createdAt", "")),
                int(item.get("generationId", 0)),
                int(item.get("sheetIndex", 0)),
            ),
            reverse=True,
        )

        return jsonify({"images": items})

    @app.post("/api/auth/register")
    def api_auth_register() -> object:
        payload = _get_request_data()
        username = (payload.get("username") or "").strip()
        password = (payload.get("password") or "").strip()

        if not username or not password:
            return jsonify({"error": "Укажите логин и пароль"}), 400

        if _find_user_record(username):
            return jsonify({"error": "Пользователь уже существует"}), 400

        record = {
            "username": username,
            "password_hash": generate_password_hash(password),
            "created_at": _timestamp(),
        }
        _users.append(record)
        _save_users()
        return jsonify(_auth_response(record)), 201

    @app.post("/api/auth/login")
    def api_auth_login() -> object:
        payload = _get_request_data()
        username = (payload.get("username") or "").strip()
        password = (payload.get("password") or "").strip()

        record = _find_user_record(username)
        if (
            not record
            and _admin_settings_present()
            and username.lower() == admin_email.lower()
        ):
            if check_password_hash(admin_password_hash, password):
                record = _ensure_admin_record()

        if not record or not check_password_hash(str(record.get("password_hash", "")), password):
            return jsonify({"error": "Неверный логин или пароль"}), 401

        return jsonify(_auth_response(record))

    @app.post("/api/auth/admin/login")
    def api_auth_admin_login() -> object:
        if not _admin_settings_present():
            return jsonify({"error": "Не заданы ADMIN_EMAIL и ADMIN_PASSWORD_HASH"}), 400

        payload = _get_request_data()
        token = (payload.get("token") or "").strip()
        password = (payload.get("password") or "").strip()

        if admin_access_token and token:
            if token != admin_access_token:
                return jsonify({"error": "Неверный токен администратора"}), 403
        elif not password:
            return jsonify({"error": "Укажите пароль или токен администратора"}), 400

        if password and not check_password_hash(admin_password_hash, password):
            return jsonify({"error": "Неверный пароль администратора"}), 403

        record = _ensure_admin_record()
        if not record:
            return jsonify({"error": "Не удалось создать администратора"}), 500

        return jsonify(_auth_response(record))

    @app.post("/api/auth/admin/ensure")
    def api_auth_admin_ensure() -> object:
        if not _admin_settings_present():
            return jsonify({"error": "Не заданы ADMIN_EMAIL и ADMIN_PASSWORD_HASH"}), 400

        payload = _get_request_data()
        token = (payload.get("token") or "").strip()
        password = (payload.get("password") or "").strip()

        if admin_access_token:
            if token != admin_access_token:
                return jsonify({"error": "Неверный токен администратора"}), 403
        elif password:
            if not check_password_hash(admin_password_hash, password):
                return jsonify({"error": "Неверный пароль администратора"}), 403
        else:
            return jsonify({"error": "Укажите пароль или токен администратора"}), 400

        record = _ensure_admin_record()
        if not record:
            return jsonify({"error": "Не удалось сохранить администратора"}), 500

        return jsonify({"message": "Администратор сохранён", "user": _public_user(record)})

    @app.get("/api/auth/me")
    def api_auth_me() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401
        return jsonify({"user": _public_user(user)})

    @app.post("/api/tests/run")
    def api_run_tests() -> object:
        result = _run_backend_tests()
        status_code = 200 if result.get("exit_code", 1) == 0 else 500
        return jsonify(result), status_code

    @app.get("/api/projects")
    def api_projects() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        username = str(user.get("username", ""))
        _sync_relations()
        user_projects = [
            project for project in _projects if project.owner.lower() == username.lower()
        ]
        return jsonify({"projects": [_serialize_project(project) for project in user_projects]})

    @app.post("/api/projects")
    def api_create_project() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        payload = _get_request_data()
        name = (payload.get("name") or "").strip()
        description = (payload.get("description") or "").strip()
        author = (payload.get("author") or "").strip() or str(user.get("username", ""))
        template_ids = _parse_ids(payload.get("template_ids"))
        asset_ids = _parse_ids(payload.get("asset_ids"))
        if not name:
            return jsonify({"error": "Укажите название проекта"}), 400

        global _next_project_id
        project = ProjectRecord(
            id=_next_project_id,
            name=name,
            owner=str(user.get("username", "")),
            description=description,
            author=author,
            status="active",
            created_at=_timestamp(),
            updated_at=_timestamp(),
            template_ids=template_ids,
            asset_ids=asset_ids,
        )
        _projects.insert(0, project)
        _next_project_id += 1
        _project_data_for(project.id)
        _sync_relations()
        _persist_catalogs()
        _persist_project_details()
        return jsonify({"message": "Проект сохранён", "project": _serialize_project(project)})

    @app.put("/api/projects/<int:project_id>")
    def api_update_project(project_id: int) -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        username = str(user.get("username", ""))
        project = _find_project(project_id, owner=username)
        if not project:
            return jsonify({"error": "Проект не найден"}), 404

        payload = _get_request_data()
        if "name" in payload:
            project.name = str(payload.get("name") or project.name)
        if "description" in payload:
            project.description = str(payload.get("description") or project.description)
        if "status" in payload:
            project.status = str(payload.get("status") or project.status)
        if "author" in payload:
            project.author = str(payload.get("author") or project.author)
        if "template_ids" in payload:
            project.template_ids = _parse_ids(payload.get("template_ids"))
        if "asset_ids" in payload:
            project.asset_ids = _parse_ids(payload.get("asset_ids"))

        project.updated_at = _timestamp()
        _sync_relations()
        _persist_catalogs()
        return jsonify({"message": "Проект обновлён", "project": _serialize_project(project)})

    @app.delete("/api/projects/<int:project_id>")
    def api_delete_project(project_id: int) -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        username = str(user.get("username", ""))
        project = _find_project(project_id, owner=username)
        if not project:
            return jsonify({"error": "Проект не найден"}), 404

        _projects.remove(project)
        _sync_relations()
        _persist_catalogs()
        if project_id in _project_details:
            _project_details.pop(project_id, None)
            _persist_project_details()
        return jsonify({"message": "Проект удалён", "id": project_id})

    @app.get("/api/projects/<int:project_id>/data")
    def api_project_details(project_id: int) -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        username = str(user.get("username", ""))
        project = _find_project(project_id, owner=username)
        if not project:
            return jsonify({"error": "Проект не найден"}), 404

        data = _project_data_for(project_id)
        return jsonify({"project": _serialize_project(project), "data": data})

    @app.put("/api/projects/<int:project_id>/data")
    def api_save_project_details(project_id: int) -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        username = str(user.get("username", ""))
        project = _find_project(project_id, owner=username)
        if not project:
            return jsonify({"error": "Проект не найден"}), 404

        payload = _get_request_data()
        if not isinstance(payload, dict):
            return jsonify({"error": "Некорректный формат данных"}), 400

        data = _normalize_project_data(payload)
        _project_details[project_id] = data
        _apply_detail_relations(project, data)
        _sync_relations()
        _persist_catalogs()
        _persist_project_details()
        return jsonify(
            {
                "message": "Данные проекта сохранены",
                "data": data,
                "project": _serialize_project(project),
            }
        )

    @app.get("/api/templates")
    def api_templates() -> object:
        _sync_relations()
        return jsonify({"templates": [_serialize_template(template) for template in _templates]})

    @app.post("/api/templates")
    def api_create_template() -> object:
        payload = _get_request_data()
        upload = request.files.get("file")
        name = (payload.get("name") or "").strip()
        kind = (payload.get("kind") or "text").strip().lower()
        if kind not in TEMPLATE_KINDS:
            return jsonify({"error": "Неизвестный тип шаблона"}), 400

        category = (payload.get("category") or kind).strip()
        description = (payload.get("description") or "").strip()
        content = (payload.get("content") or "").strip()
        author = (payload.get("author") or "").strip()
        if not name:
            return jsonify({"error": "Укажите название темплейта"}), 400

        saved_path: Path | None = None
        if kind in {"background", "layout"}:
            if upload and upload.filename:
                saved_path = save_uploaded_file(upload, prefix=name, root=DEFAULT_OUTPUT_DIR)
                content = saved_path.as_posix()
            elif not content:
                return jsonify({"error": "Добавьте изображение для шаблона"}), 400

        global _next_template_id
        template = TemplateRecord(
            id=_next_template_id,
            name=name,
            kind=kind,
            category=category,
            description=description,
            content=content,
            author=author,
            status="draft",
            created_at=_timestamp(),
            updated_at=_timestamp(),
        )
        _templates.insert(0, template)
        _next_template_id += 1
        _sync_relations()
        _persist_catalogs()
        return jsonify({"message": "Темплейт добавлен", "template": _serialize_template(template)})

    @app.put("/api/templates/<int:template_id>")
    def api_update_template(template_id: int) -> object:
        template = _find_template(template_id)
        if not template:
            return jsonify({"error": "Темплейт не найден"}), 404

        payload = _get_request_data()
        upload = request.files.get("file")
        if "kind" in payload:
            kind = str(payload.get("kind") or template.kind).lower()
            if kind not in TEMPLATE_KINDS:
                return jsonify({"error": "Неизвестный тип шаблона"}), 400
            template.kind = kind
        if "name" in payload:
            template.name = str(payload.get("name") or template.name)
        if "category" in payload:
            template.category = str(payload.get("category") or template.category)
        if "description" in payload:
            template.description = str(payload.get("description") or template.description)
        if "content" in payload:
            template.content = str(payload.get("content") or template.content)
        if "status" in payload:
            template.status = str(payload.get("status") or template.status)
        if "author" in payload:
            template.author = str(payload.get("author") or template.author)

        if upload and upload.filename:
            saved_path = save_uploaded_file(upload, prefix=template.name, root=DEFAULT_OUTPUT_DIR)
            template.content = saved_path.as_posix()

        template.updated_at = _timestamp()
        _persist_catalogs()
        return jsonify({"message": "Темплейт обновлён", "template": _serialize_template(template)})

    @app.delete("/api/templates/<int:template_id>")
    def api_delete_template(template_id: int) -> object:
        template = _find_template(template_id)
        if not template:
            return jsonify({"error": "Темплейт не найден"}), 404

        for project in _projects:
            if template_id in project.template_ids:
                project.template_ids.remove(template_id)

        _templates.remove(template)
        _sync_relations()
        _persist_catalogs()
        return jsonify({"message": "Темплейт удалён", "id": template_id})

    @app.get("/api/assets")
    def api_assets() -> object:
        _sync_relations()
        assets_payload = []
        for asset in _assets:
            assets_payload.append(_serialize_asset(asset))
        return jsonify({"assets": assets_payload})

    @app.post("/api/assets")
    def api_create_asset() -> object:
        payload = _get_request_data()
        upload = request.files.get("file")
        description = (payload.get("description") or "").strip()
        author = (payload.get("author") or "").strip()
        template_ids = _parse_ids(payload.get("template_ids"))
        project_ids = _parse_ids(payload.get("project_ids"))

        if not upload and not payload.get("filename"):
            return jsonify({"error": "Добавьте файл или укажите название ассета"}), 400

        global _next_asset_id
        filename = (payload.get("filename") or "").strip() or (upload.filename if upload else "asset")
        kind = upload.mimetype if upload else str(payload.get("kind") or "application/octet-stream")
        saved_path: Path | None = None
        size_label = str(payload.get("size") or "")
        if upload:
            saved_path = save_uploaded_file(upload, prefix=filename, root=DEFAULT_OUTPUT_DIR)
            saved_size = saved_path.stat().st_size
            size_label = f"{round(saved_size / 1024, 1)} KB"

        asset = AssetRecord(
            id=_next_asset_id,
            filename=filename,
            kind=kind,
            size=size_label,
            description=description,
            author=author,
            path=saved_path.as_posix() if saved_path else str(payload.get("path") or ""),
            created_at=_timestamp(),
            template_ids=template_ids,
            project_ids=project_ids,
        )

        _assets.insert(0, asset)
        _next_asset_id += 1
        _sync_relations()
        _persist_catalogs()
        serialized = _serialize_asset(asset)
        return jsonify({"message": "Ассет добавлен", "asset": serialized})

    @app.delete("/api/assets/<int:asset_id>")
    def api_delete_asset(asset_id: int) -> object:
        asset = _find_asset(asset_id)
        if not asset:
            return jsonify({"error": "Ассет не найден"}), 404

        for project in _projects:
            if asset_id in project.asset_ids:
                project.asset_ids.remove(asset_id)

        _assets.remove(asset)
        _sync_relations()
        _persist_catalogs()
        return jsonify({"message": "Ассет удалён", "id": asset_id})

    @app.get("/api/settings")
    def api_settings() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        return jsonify({"settings": _settings_payload(), "status": _status_payload(user)})

    @app.post("/api/generate")
    def generate() -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        payload = _get_request_data()
        app.logger.info(
            "Получен POST /api/generate от %s (ключи: %s)",
            str(user.get("username", "")),
            ", ".join(sorted(payload.keys())),
        )
        api_key = _resolve_api_key(payload.get("api_key"))
        aspect_ratio = payload.get("aspect_ratio", ASPECT_RATIOS[0])
        resolution = payload.get("resolution", RESOLUTIONS[0])
        sheet_prompts = [block.strip() for block in payload.get("sheet_prompts", []) if block.strip()]

        yaml_prompts: List[str] = []
        yaml_file = request.files.get("prompt_yaml")
        if yaml_file and yaml_file.filename:
            try:
                yaml_prompts = _load_yaml_prompts(yaml_file)
            except Exception as exc:  # noqa: BLE001
                return jsonify({"error": f"Не удалось загрузить YAML: {exc}"}), 400

        sheet_prompts.extend(yaml_prompts)

        if not sheet_prompts:
            app.logger.warning(
                "Запрос генерации отклонён: промты не переданы (пользователь %s)",
                str(user.get("username", "")),
            )
            return jsonify({"error": "Добавьте хотя бы один промт листа для генерации."}), 400

        if aspect_ratio not in ASPECT_RATIOS:
            app.logger.warning(
                "Запрос генерации отклонён: неизвестное соотношение %s (пользователь %s)",
                aspect_ratio,
                str(user.get("username", "")),
            )
            return jsonify({"error": "Укажите корректное соотношение сторон."}), 400

        if resolution not in RESOLUTIONS:
            app.logger.warning(
                "Запрос генерации отклонён: неизвестное разрешение %s (пользователь %s)",
                resolution,
                str(user.get("username", "")),
            )
            return jsonify({"error": "Укажите корректное разрешение."}), 400

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

        if background_refs or detail_refs:
            app.logger.info(
                "Загружены новые референсы: фон %s, детали %s (генерация %s)",
                len(background_refs),
                len(detail_refs),
                _next_generation_id,
            )

        _settings.background_references = merged_background_refs
        _settings.detail_references = merged_detail_refs
        if background_refs or detail_refs:
            save_settings(_settings, SETTINGS_FILE)

        if not api_key:
            app.logger.warning(
                "Запрос генерации отклонён: отсутствует API ключ для пользователя %s",
                str(user.get("username", "")),
            )
            return jsonify({"error": "Укажите Gemini API ключ в настройках или в запросе перед запуском генерации."}), 400

        app.logger.info(
            "Запрос генерации от %s: %s промтов, аспект %s, разрешение %s, референсы bg=%s detail=%s",
            str(user.get("username", "")),
            len(sheet_prompts),
            aspect_ratio,
            resolution,
            len(merged_background_refs),
            len(merged_detail_refs),
        )

        entry = _register_generation(
            sheet_prompts=sheet_prompts,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            background_references=merged_background_refs,
            detail_references=merged_detail_refs,
            owner=str(user.get("username", "")),
        )
        _run_generation(entry, api_key)
        return jsonify(
            {
                "message": "Генерация запущена",
                "generation_id": entry.id,
                "generation": _serialize_generation(entry),
            }
        )

    @app.post("/api/generations/<int:generation_id>/images/<int:image_index>/regenerate")
    def regenerate_image(generation_id: int, image_index: int) -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        payload = _get_request_data()
        api_key = _resolve_api_key(payload.get("api_key"))
        entry = _find_generation(generation_id, owner=str(user.get("username", "")))
        if not entry:
            return jsonify({"error": "Не удалось найти указанную генерацию."}), 404
        _ensure_image_lists(entry)
        if image_index < 0 or image_index >= len(entry.sheet_prompts):
            return jsonify({"error": "Некорректный номер изображения для регенерации."}), 400

        if not api_key:
            app.logger.warning(
                "Регенерация #%s листа %s отклонена: отсутствует API ключ (пользователь %s)",
                entry.id,
                image_index,
                str(user.get("username", "")),
            )
            return jsonify({"error": "Добавьте Gemini API ключ, чтобы перегенерировать изображение."}), 400
        entry.image_approvals[image_index] = False
        entry.image_statuses[image_index] = "regenerating"
        app.logger.info(
            "Запущена регенерация изображения %s для генерации #%s пользователем %s",
            image_index,
            entry.id,
            str(user.get("username", "")),
        )
        _run_generation(entry, api_key, target_index=image_index)
        return jsonify(
            {
                "message": "Регенерация запущена",
                "generation": _serialize_generation(entry),
            }
        )

    @app.post("/api/settings")
    def update_settings() -> object:
        payload = _get_request_data()
        api_key = (payload.get("saved_api_key") or "").strip()
        background_references = payload.get("background_references") or []
        detail_references = payload.get("detail_references") or []

        if isinstance(background_references, str):
            background_references = [ref.strip() for ref in background_references.split(",") if ref.strip()]
        if isinstance(detail_references, str):
            detail_references = [ref.strip() for ref in detail_references.split(",") if ref.strip()]

        global _settings
        _settings = Settings(
            api_key=api_key,
            background_references=background_references or _settings.background_references,
            detail_references=detail_references or _settings.detail_references,
        )
        save_settings(_settings, SETTINGS_FILE)
        lang = _resolve_language()
        return jsonify(
            {
                "message": translate("js.forms.saved_api", lang),
                "settings": _settings_payload(),
            }
        )

    @app.post("/api/language")
    def set_language() -> object:
        payload = _get_request_data()
        lang = (payload.get("lang") or "").strip()
        if lang not in translations:
            return jsonify({"error": "Unsupported language"}), 400
        response = make_response(jsonify({"lang": lang}))
        response.set_cookie("lang", lang, max_age=60 * 60 * 24 * 30)
        return response

    @app.get("/api/i18n")
    def frontend_i18n() -> object:
        lang = _resolve_language()
        return jsonify(get_frontend_translations(lang))

    @app.post("/api/channel/videos")
    def fetch_channel_videos() -> object:
        payload = _get_request_data()
        channel_url = (payload.get("channel_url") or "").strip()
        if not channel_url:
            return jsonify({"error": "Добавьте ссылку на канал YouTube для загрузки видео."}), 400

        try:
            videos = _load_channel_videos(channel_url)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": f"Не удалось загрузить видео канала: {exc}"}), 400

        global _channel_lookup
        _channel_lookup = {"videos": videos, "channel_url": channel_url}
        return jsonify({"videos": videos, "channel_url": channel_url})

    @app.post("/api/settings/reference/remove")
    def remove_reference() -> object:
        payload = _get_request_data()
        reference_type = payload.get("reference_type")
        reference_path = (payload.get("reference_path") or "").strip()

        if reference_type not in {"background", "detail"} or not reference_path:
            return jsonify({"error": "Не удалось удалить референс: некорректные данные."}), 400

        target_list = (
            _settings.background_references
            if reference_type == "background"
            else _settings.detail_references
        )

        if not _remove_reference(reference_path, target_list):
            return jsonify({"error": "Референс не найден среди сохранённых."}), 404

        save_settings(_settings, SETTINGS_FILE)
        _delete_reference_file(reference_path)
        return jsonify({"message": "Референс удалён."})

    @app.post("/api/generations/<int:generation_id>/images/<int:image_index>/approve")
    def approve_image(generation_id: int, image_index: int) -> object:
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        entry = _find_generation(generation_id, owner=str(user.get("username", "")))
        if not entry:
            return jsonify({"error": "Не удалось найти указанную генерацию."}), 404

        _ensure_image_lists(entry)
        if image_index < 0 or image_index >= len(entry.sheet_prompts):
            return jsonify({"error": "Некорректный номер изображения для апрува."}), 400

        entry.image_approvals[image_index] = True
        entry.recalc_flags()
        _persist_generations()
        return jsonify({"message": "Изображение отмечено как понравившееся."})

    @app.post("/api/generations/<int:generation_id>/export_pdf")
    def export_pdf_route(generation_id: int):
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        entry = _find_generation(generation_id, owner=str(user.get("username", "")))
        if not entry:
            return jsonify({"error": "Не удалось найти указанную генерацию."}), 404

        _ensure_image_lists(entry)
        if not entry.approved:
            return jsonify({"error": "Нужно апрувнуть все изображения, чтобы создать PDF."}), 400

        valid_paths = [path for path in entry.preferred_pdf_images if path]
        if not valid_paths:
            return jsonify({"error": "Нет изображений для формирования PDF."}), 400

        destination = DEFAULT_OUTPUT_DIR / f"generation-{entry.id}.pdf"
        pdf_path = export_pdf(valid_paths, destination)
        return send_from_directory(
            pdf_path.parent, pdf_path.name, as_attachment=True, download_name=pdf_path.name
        )

    @app.get("/api/generations/<int:generation_id>/images/archive")
    def download_generation_images(generation_id: int):
        user = _authenticated_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401

        entry = _find_generation(generation_id, owner=str(user.get("username", "")))
        if not entry:
            return jsonify({"error": "Не удалось найти указанную генерацию."}), 404

        _ensure_image_lists(entry)

        resolved_images: list[Path] = []
        for raw_path in entry.image_paths:
            if not raw_path:
                continue

            candidate = Path(raw_path)
            if candidate.is_absolute() and candidate.exists():
                resolved_images.append(candidate)
                continue

            if candidate.is_absolute() and candidate.name:
                fallback = DEFAULT_OUTPUT_DIR / candidate.name
                if fallback.exists():
                    resolved_images.append(fallback)
                continue

            if not candidate.is_absolute() and candidate.name:
                fallback = DEFAULT_OUTPUT_DIR / candidate.name
                if fallback.exists():
                    resolved_images.append(fallback)

        if not resolved_images:
            return jsonify({"error": "Готовых изображений пока нет."}), 400

        ensure_output_dir(DEFAULT_OUTPUT_DIR)
        archive_path = DEFAULT_OUTPUT_DIR / f"generation-{entry.id}-images.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            for image_path in resolved_images:
                archive.write(image_path, arcname=image_path.name)

        return send_from_directory(
            archive_path.parent,
            archive_path.name,
            as_attachment=True,
            download_name=archive_path.name,
        )

    @app.get("/api/assets/<path:filename>")
    def serve_asset(filename: str):  # type: ignore[override]
        ensure_output_dir(DEFAULT_OUTPUT_DIR)
        return send_from_directory(DEFAULT_OUTPUT_DIR, filename)

    return app


def _run_backend_tests(tests_path: Path | None = None) -> dict[str, object]:
    target = Path(tests_path) if tests_path else Path(__file__).resolve().parent.parent / "tests"
    start = time.perf_counter()

    if not target.exists():
        return {
            "exit_code": 0,
            "stdout": f"Каталог тестов не найден: {target}",
            "stderr": "",
            "duration": 0.0,
        }

    command = [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        str(target),
        "--disable-warnings",
        "--maxfail=1",
        "--color=no",
    ]

    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, cwd=target.parent, timeout=120
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "exit_code": 1,
            "stdout": "",
            "stderr": str(exc),
            "duration": round(time.perf_counter() - start, 3),
        }

    return {
        "exit_code": int(completed.returncode),
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
        "duration": round(time.perf_counter() - start, 3),
    }


def _get_request_data() -> dict[str, object]:
    payload = request.get_json(silent=True)
    data: dict[str, object] = payload if isinstance(payload, dict) else {}

    for key, value in request.form.items():
        data.setdefault(key, value)

    sheet_prompts = request.form.getlist("sheet_prompts")
    if sheet_prompts and "sheet_prompts" not in data:
        data["sheet_prompts"] = sheet_prompts

    return data


def _serialize_generation(entry: GenerationEntry) -> dict[str, object]:
    images: list[dict[str, object]] = []
    for image in entry.images:
        images.append(
            {
                "index": image["index"],
                "status": image["status"],
                "approved": image["approved"],
                "exists": image["exists"],
                "asset_url": url_for("serve_asset", filename=image["asset_name"])
                if image["exists"]
                else None,
                "filename": image["filename"],
            }
        )

    ready_count = len([img for img in images if img["status"] in {"ready", "approved"}])
    return {
        "id": entry.id,
        "status": entry.status,
        "status_label": STATUS_LABELS.get(entry.status, entry.status),
        "approved": entry.approved,
        "ready": ready_count,
        "total": len(entry.sheet_prompts),
        "images": images,
        "error_message": entry.error_message,
    }


def _status_payload(user: dict[str, object] | None = None) -> dict[str, object]:
    username = str(user.get("username", "")).lower() if user else ""

    def _user_generations() -> list[GenerationEntry]:
        if not username:
            return []
        return [gen for gen in _generations if gen.owner.lower() == username]

    generations = _user_generations()

    progress = {
        "total": len(generations),
        "completed": len(
            [gen for gen in generations if gen.status in {"ready", "approved"}]
        ),
        "active": len(
            [gen for gen in generations if gen.status in {"generating", "regenerating"}]
        ),
    }

    return {
        "progress": progress,
        "generations": [_serialize_generation(gen) for gen in generations],
    }


def _settings_payload() -> dict[str, object]:
    return {
        "api_key": _settings.api_key,
        "background_references": _settings.background_references,
        "detail_references": _settings.detail_references,
    }


def _find_generation(generation_id: int, owner: str | None = None) -> Optional[GenerationEntry]:
    owner_lower = owner.lower() if owner else None
    for entry in _generations:
        if entry.id == generation_id and (
            owner_lower is None or entry.owner.lower() == owner_lower
        ):
            return entry
    return None


def _resolve_api_key(raw_api_key: Optional[str]) -> Optional[str]:
    """Return the first available API ключ из формы, настроек или окружения."""

    resolved = (raw_api_key or _settings.api_key or os.getenv("GEMINI_API_KEY") or "").strip()
    return resolved or None


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
    owner: str = "",
) -> GenerationEntry:
    global _next_generation_id
    entry = GenerationEntry(
        id=_next_generation_id,
        owner=owner,
        created_at=_timestamp(),
        sheet_prompts=sheet_prompts,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        background_references=background_references or [],
        detail_references=detail_references or [],
        status="generating",
        error_message="",
        image_paths=[None] * len(sheet_prompts),
        image_statuses=["generating"] * len(sheet_prompts),
        image_approvals=[False] * len(sheet_prompts),
        pdf_image_candidates=[[] for _ in sheet_prompts],
    )
    _next_generation_id += 1
    _generations.insert(0, entry)
    _persist_generations()
    app.logger.info(
        "Сгенерирована запись #%s для %s промтов (аспект %s, разрешение %s)",
        entry.id,
        len(sheet_prompts),
        aspect_ratio,
        resolution,
    )
    return entry


def _run_generation(
    entry: GenerationEntry, api_key: Optional[str], *, target_index: Optional[int] = None
) -> None:
    try:
        entry.error_message = ""
        app.logger.info(
            "Старт генерации #%s для пользователя %s (цель: %s)",
            entry.id,
            entry.owner or "unknown",
            "все изображения" if target_index is None else f"лист {target_index + 1}",
        )
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
            target_path = str(new_asset_path(f"generation-{entry.id}-sheet-{displayed_index}"))
            full_prompt = _build_generation_prompt(
                f"Промт листа {displayed_index}: {sheet_prompt}"
            )
            entry.image_statuses[prompt_index] = (
                "regenerating" if target_index is not None else "generating"
            )
            _persist_generations()
            app.logger.info(
                "Генерация #%s: старт листа %s/%s -> %s",
                entry.id,
                displayed_index,
                len(entry.sheet_prompts),
                target_path,
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

            _persist_generations()

            app.logger.info(
                "Генерация #%s: лист %s готов, основной файл %s, доп. вариантов %s",
                entry.id,
                displayed_index,
                result.image_path,
                len(result.extra_images),
            )

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
            )
        )
        app.logger.info(
            "Генерация #%s завершена со статусом %s", entry.id, entry.status
        )
    except ValueError as exc:
        app.logger.exception(
            "Generation %s failed due to invalid input", entry.id, exc_info=exc
        )
        if target_index is None:
            entry.image_statuses = ["error"] * len(entry.sheet_prompts)
        else:
            entry.image_statuses[target_index] = "error"
        entry.error_message = str(exc)
        entry.recalc_flags()
        _persist_generations()
    except Exception as exc:  # noqa: BLE001
        app.logger.exception(
            "Unexpected error during generation %s", entry.id, exc_info=exc
        )
        if target_index is None:
            entry.image_statuses = ["error"] * len(entry.sheet_prompts)
        else:
            entry.image_statuses[target_index] = "error"
        entry.error_message = str(exc)
        entry.recalc_flags()
        _persist_generations()
    finally:
        _persist_generations()


app = create_app()


def _build_generation_prompt(user_prompt: str) -> str:
    """Attach hidden style prompt to keep a consistent visual collection."""

    return f"{user_prompt}\n\n{SECRET_STYLE_PROMPT}"


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
        saved_path = save_uploaded_file(upload, prefix=f"gen-{generation_id}-{prefix}")
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
            path = DEFAULT_OUTPUT_DIR / path.name
        if path.is_file():
            path.unlink()
    except OSError:
        pass


def _load_channel_videos(channel_url: str) -> list[dict[str, str]]:
    channel_id = _extract_channel_id(channel_url)
    if not channel_id:
        raise ValueError("Не удалось определить ID канала по ссылке.")

    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        with urllib.request.urlopen(feed_url, timeout=10) as response:
            feed_xml = response.read()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Не удалось открыть RSS-ленту канала: {exc}") from exc

    try:
        root = ET.fromstring(feed_xml)
    except ET.ParseError as exc:
        raise ValueError("Не удалось разобрать RSS-ленту канала.") from exc

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    videos: list[dict[str, str]] = []
    for entry in root.findall("atom:entry", ns):
        title_node = entry.find("atom:title", ns)
        link_node = entry.find("atom:link", ns)
        video_url = link_node.attrib.get("href", "") if link_node is not None else ""
        title = title_node.text if title_node is not None else ""
        if title or video_url:
            videos.append({"title": title, "url": video_url})
    return videos


def _extract_channel_id(channel_url: str) -> str:
    parsed = urllib.parse.urlparse(channel_url)
    path = parsed.path.rstrip("/")
    if "/channel/" in path:
        return path.split("/channel/")[-1].split("/")[0]

    if path.startswith("/@"):
        handle_html = _download_html(channel_url)
        match = re.search(r'"channelId":"(UC[^"]+)"', handle_html)
        return match.group(1) if match else ""

    if "youtube.com" in parsed.netloc and (parsed.path == "" or parsed.path == "/"):
        return ""

    match = re.search(r"(UC[0-9A-Za-z_-]{21}[AQgw])", channel_url)
    return match.group(1) if match else ""


def _download_html(url: str) -> str:
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.read().decode("utf-8", errors="replace")


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
