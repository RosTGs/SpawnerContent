"""Application entrypoint kept for backward compatibility."""
from .backend.app import create_app, SECRET_STYLE_PROMPT, _build_generation_prompt

__all__ = ["create_app", "SECRET_STYLE_PROMPT", "_build_generation_prompt"]
