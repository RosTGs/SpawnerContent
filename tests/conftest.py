"""Shared fixtures for backend tests."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

from src import storage


@pytest.fixture()
def isolated_app(tmp_path, monkeypatch):
    """Provide a Flask app with storage redirected to a temp directory."""

    data_dir = tmp_path / "data"
    monkeypatch.setattr(storage, "DEFAULT_OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(storage, "DATA_DIR", data_dir)
    monkeypatch.setattr(storage, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(storage, "PROJECTS_FILE", data_dir / "projects.json")
    monkeypatch.setattr(storage, "TEMPLATES_FILE", data_dir / "templates.json")
    monkeypatch.setattr(storage, "ASSETS_FILE", data_dir / "assets.json")
    monkeypatch.setattr(storage, "GENERATIONS_FILE", data_dir / "generations.json")

    storage.ensure_data_dir(data_dir)

    from src import app as app_module

    importlib.reload(app_module)
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)

    yield flask_app

    importlib.reload(app_module)

