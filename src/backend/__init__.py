"""Backend package exposing the Flask application factory."""
from .app import create_app, SECRET_STYLE_PROMPT, _build_generation_prompt

__all__ = ["create_app", "SECRET_STYLE_PROMPT", "_build_generation_prompt"]
