"""Tests for the backend diagnostics runner."""

from __future__ import annotations

from src import app as app_module


def test_run_backend_tests_uses_custom_path(tmp_path):
    sample_test = tmp_path / "sample_test.py"
    sample_test.write_text("""\
def test_sample():
    assert 2 + 2 == 4
""")

    result = app_module._run_backend_tests(tmp_path)

    assert result["exit_code"] == 0
    assert "1 passed" in result["stdout"]
    assert result["stderr"] == ""
