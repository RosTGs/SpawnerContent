"""Gemini image generation helper."""
from __future__ import annotations

import mimetypes
import os
from dataclasses import dataclass
from typing import Iterable, List, Optional

from google import genai
from google.genai import types
from PIL import Image

DEFAULT_MODEL = "gemini-3-pro-image-preview"


@dataclass
class GenerationResult:
    image_path: str
    text_parts: List[str]


class GeminiClient:
    """Wrapper around the Gemini SDK for image generation."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self._client = None

    def _client_instance(self) -> genai.Client:
        if not self.api_key:
            raise ValueError("API key is required. Set GEMINI_API_KEY or provide it explicitly.")
        if self._client is None:
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _image_parts(self, files: Iterable[str]) -> List[types.Part]:
        parts: List[types.Part] = []
        for path in files:
            if not path:
                continue
            mime_type, _ = mimetypes.guess_type(path)
            mime_type = mime_type or "application/octet-stream"
            with open(path, "rb") as fh:
                data = fh.read()
            parts.append(types.Part.from_bytes(data=data, mime_type=mime_type))
        return parts

    def generate_image(
        self,
        prompt: str,
        *,
        aspect_ratio: str,
        resolution: str,
        template_files: Iterable[str],
        output_path: str,
    ) -> GenerationResult:
        contents: List[types.Part | str] = []
        contents.extend(self._image_parts(template_files))
        contents.append(prompt)

        config = types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio=aspect_ratio,
                image_size=resolution,
            ),
        )

        response = self._client_instance().models.generate_content(
            model=DEFAULT_MODEL,
            contents=contents,
            config=config,
        )

        text_parts: List[str] = []
        saved_image_path: Optional[str] = None
        for part in response.parts:
            if part.text is not None:
                text_parts.append(part.text)
            else:
                image = part.as_image()
                if image and saved_image_path is None:
                    self._save_image(image, output_path)
                    saved_image_path = output_path
        if saved_image_path is None:
            raise RuntimeError("No image was returned from the model.")
        return GenerationResult(image_path=saved_image_path, text_parts=text_parts)

    @staticmethod
    def _save_image(image: Image.Image, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        image.save(path)

