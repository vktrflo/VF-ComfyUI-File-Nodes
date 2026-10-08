"""🌀 VF Unpack Media node."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import torch

from .media_utils import (
    MAX_TEXT_CHARS,
    classify_media_type,
    decode_video_segment,
    empty_audio_dict,
    empty_image_tensor,
    empty_mask_tensor,
    load_audio,
    load_image,
)


class VFUnpackMedia:
    """Intelligently unpacks a VF_MEDIA bundle into safe tensors and metadata."""

    CATEGORY = "VF/File Loaders"
    FUNCTION = "unpack"
    RETURN_TYPES = ("IMAGE", "MASK", "AUDIO", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "audio", "text", "path", "media_type")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, tuple[str, dict[str, Any]]]]:
        return {
            "required": {
                "media": ("VF_MEDIA",),
            },
        }

    def unpack(
        self, media: dict[str, Any] | None
    ) -> tuple[torch.Tensor, torch.Tensor, dict[str, Any], str, str, str]:
        fallback_img = empty_image_tensor(64, 64)
        fallback_mask = empty_mask_tensor(64, 64)
        fallback_audio = empty_audio_dict(44100)
        fallback_text = ""

        if not isinstance(media, dict):
            return (fallback_img, fallback_mask, fallback_audio, fallback_text, "", "unknown")

        file_path = str(media.get("path", "")).strip()
        media_type = str(media.get("media_type", "")).strip().lower()

        if not file_path or not os.path.isfile(file_path):
            return (fallback_img, fallback_mask, fallback_audio, fallback_text, file_path, "unknown")

        if not media_type or media_type == "unknown":
            media_type = classify_media_type(file_path)

        if media_type == "image":
            img, mask, _w, _h = load_image(file_path, longest_size=0)
            return (img, mask, fallback_audio, fallback_text, file_path, "image")

        if media_type == "video":
            res = decode_video_segment(file_path, start_time=0.0, segment_duration=2.0)
            img = res["image"]
            mask = empty_mask_tensor(img.shape[2], img.shape[1])
            audio = res["audio"]
            return (img, mask, audio, fallback_text, file_path, "video")

        if media_type == "audio":
            audio_res = load_audio(file_path)
            audio = {"waveform": audio_res["waveform"], "sample_rate": audio_res["sample_rate"]}
            return (fallback_img, fallback_mask, audio, fallback_text, file_path, "audio")

        if media_type == "text":
            try:
                content = Path(file_path).read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_CHARS]
            except Exception:
                content = ""
            return (fallback_img, fallback_mask, fallback_audio, content, file_path, "text")

        return (fallback_img, fallback_mask, fallback_audio, fallback_text, file_path, "unknown")
