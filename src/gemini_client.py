"""Gemini image generation helper."""
from __future__ import annotations

import base64
import mimetypes
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional

from google import genai
from google.genai import types
from PIL import Image

DEFAULT_MODEL = "gemini-3-pro-image-preview"


@dataclass
class GenerationResult:
    image_path: str
    text_parts: List[str]
    extra_images: List[str] = field(default_factory=list)


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
        extracted_images: List[str] = []
        for part in response.parts:
            if part.text is not None:
                text_parts.append(part.text)
                extracted_images.extend(
                    self._extract_embedded_images(part.text, output_path)
                )
            else:
                image = part.as_image()
                if image and saved_image_path is None:
                    self._save_image(image, output_path)
                    saved_image_path = output_path
        if saved_image_path is None and extracted_images:
            saved_image_path = extracted_images[0]
        primary_image = saved_image_path or ""

        return GenerationResult(
            image_path=primary_image,
            text_parts=text_parts,
            extra_images=extracted_images,
        )

    @staticmethod
    def _save_image(image: Image.Image, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        image.save(path)

    @staticmethod
    def _extract_embedded_images(content: str, output_path: str) -> List[str]:
        """Save embedded base64 images from the text response next to the main file."""

        matches = list(
            re.finditer(
                r"data:image/(?P<ext>png|jpeg|jpg|webp);base64,(?P<data>[A-Za-z0-9+/=\n\r]+)",
                content,
            )
        )

        if not matches:
            return []

        base = Path(output_path)
        saved: List[str] = []
        for idx, match in enumerate(matches, start=1):
            ext = match.group("ext") or "png"
            raw = match.group("data")
            try:
                payload = base64.b64decode(raw)
            except (ValueError, base64.binascii.Error):
                continue

            target = base.with_name(f"{base.stem}-embedded-{idx}.{ext}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            saved.append(str(target))

        return saved

