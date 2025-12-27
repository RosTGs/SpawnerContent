"""Простая загрузка и использование словаря локализации."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

import yaml


LOCALES_DIR = Path(__file__).resolve().parent / "locales"
STRINGS_PATH = LOCALES_DIR / "strings.yaml"


class TranslationNotFound(Exception):
    """Raised when a translation file is missing."""


def _load_from_file() -> Dict[str, Dict[str, Any]]:
    if not STRINGS_PATH.exists():
        raise TranslationNotFound(f"Файл локализации не найден: {STRINGS_PATH}")

    with STRINGS_PATH.open("r", encoding="utf-8") as handle:
        content = yaml.safe_load(handle) or {}

    return content


@lru_cache(maxsize=1)
def get_translations() -> Dict[str, Dict[str, Any]]:
    """Read translations from disk with memoization."""

    raw = _load_from_file()
    return {code: values or {} for code, values in raw.items()}


def translate(key: str, lang: str, default_lang: str = "ru") -> str:
    """Get a translated string by dotted key, with fallback to default language."""

    translations = get_translations()
    tree = translations.get(lang) or translations.get(default_lang) or {}

    value: Any = tree
    for part in key.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            value = None
            break

    if value is None:
        fallback_tree = translations.get(default_lang, {})
        value = fallback_tree
        for part in key.split("."):
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                return key

    return str(value)


def get_frontend_translations(lang: str, default_lang: str = "ru") -> Dict[str, Any]:
    """Return translation branch for JS usage with fallback."""

    translations = get_translations()
    return translations.get(lang) or translations.get(default_lang) or {}


def dump_translations_json(lang: str, default_lang: str = "ru") -> str:
    """Serialize translations for embedding into HTML."""

    return json.dumps(get_frontend_translations(lang, default_lang), ensure_ascii=False)

