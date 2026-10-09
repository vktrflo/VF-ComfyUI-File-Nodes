"""🌀 VF Load Image node."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import torch

from .media_utils import (
    empty_image_tensor,
    empty_mask_tensor,
    load_image,
    resolve_file_path,
)


class VFLoadImage:
    """Dedicated image loader with longest_size downscaling and preview."""

    CATEGORY = "VF/File Loaders"
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "path", "width", "height")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, tuple[str, dict[str, Any]]]]:
        return {
            "required": {
                "image_path": ("STRING", {"default": ""}),
                "longest_size": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, image_path: str, longest_size: int = 0) -> str:
        resolved = resolve_file_path(image_path)
        if resolved and os.path.isfile(resolved):
            try:
                mtime = os.path.getmtime(resolved)
                return f"{mtime}:{longest_size}"
            except OSError:
                pass
        return ""

    def load(
        self, image_path: str, longest_size: int = 0
    ) -> tuple[torch.Tensor, torch.Tensor, str, int, int]:
        resolved = resolve_file_path(image_path)
        if not resolved or not os.path.isfile(resolved):
            return empty_image_tensor(), empty_mask_tensor(), str(image_path or ""), 512, 512

        resolved_abs = str(Path(resolved).resolve())
        image, mask, width, height = load_image(resolved_abs, longest_size=longest_size)
        return (image, mask, resolved_abs, width, height)
