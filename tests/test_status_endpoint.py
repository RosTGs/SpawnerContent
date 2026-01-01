"""Smoke tests for status-related API endpoints."""

from __future__ import annotations

from src import storage


def test_status_endpoint_reports_empty_progress(isolated_app):
    client = isolated_app.test_client()

    response = client.get("/api/status")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["progress"] == {"total": 0, "completed": 0, "active": 0}
    assert payload["generations"] == []


def test_settings_update_persists_payload(isolated_app, tmp_path):
    client = isolated_app.test_client()

    response = client.post(
        "/api/settings",
        json={
            "saved_api_key": "demo-key",
            "background_references": ["https://example.com/bg.png"],
            "detail_references": [],
        },
    )

    assert response.status_code == 200
    saved_settings = storage.load_settings(storage.SETTINGS_FILE)
    assert saved_settings.api_key == "demo-key"
    assert saved_settings.background_references == ["https://example.com/bg.png"]
