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
    """Dedicated image loader with longest_side downscaling, visual crop, and preview."""

    CATEGORY = "VF/File Loaders"
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "path", "width", "height")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, tuple[str, dict[str, Any]]]]:
        return {
            "required": {
                "image_path": ("STRING", {"default": ""}),
                "longest_side": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_width": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_height": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
            },
        }

    @classmethod
    def IS_CHANGED(
        cls,
        image_path: str,
        longest_side: int = 0,
        crop_x: int = 0,
        crop_y: int = 0,
        crop_width: int = 0,
        crop_height: int = 0,
        **kwargs: Any,
    ) -> str:
        resolved = resolve_file_path(image_path)
        if resolved and os.path.isfile(resolved):
            try:
                mtime = os.path.getmtime(resolved)
                side = kwargs.get("longest_size", longest_side)
                return f"{mtime}:{side}:{crop_x}:{crop_y}:{crop_width}:{crop_height}"
            except OSError:
                pass
        return ""

    def load(
        self,
        image_path: str,
        longest_side: int = 0,
        crop_x: int = 0,
        crop_y: int = 0,
        crop_width: int = 0,
        crop_height: int = 0,
        **kwargs: Any,
    ) -> tuple[torch.Tensor, torch.Tensor, str, int, int]:
        resolved = resolve_file_path(image_path)
        if not resolved or not os.path.isfile(resolved):
            return empty_image_tensor(), empty_mask_tensor(), str(image_path or ""), 512, 512

        resolved_abs = str(Path(resolved).resolve())
        target_longest = kwargs.get("longest_size", longest_side)
        crop = (crop_x, crop_y, crop_width, crop_height)
        image, mask, width, height = load_image(
            resolved_abs,
            longest_side=target_longest,
            crop=crop,
        )
        return (image, mask, resolved_abs, width, height)
