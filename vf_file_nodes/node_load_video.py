"""🌀 VF Load Video node."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import torch

from .media_utils import decode_video_segment, empty_audio_dict, empty_image_tensor


class VFLoadVideo:
    """Dedicated video segment loader with timeline scrubber and visual crop."""

    CATEGORY = "VF/File Loaders"
    FUNCTION = "load_video"
    RETURN_TYPES = ("IMAGE", "IMAGE", "AUDIO", "VIDEO", "DICT", "INT", "INT", "STRING")
    RETURN_NAMES = ("image", "single_frame", "audio", "video", "frame_info", "width", "height", "path")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, tuple[str, dict[str, Any]]]]:
        return {
            "required": {
                "video_path": ("STRING", {"default": ""}),
                "start_time": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
                "segment_duration": ("FLOAT", {"default": 2.0, "min": 0.1, "max": 600.0, "step": 0.01}),
                "current_frame_offset": ("INT", {"default": 0, "min": 0, "max": 1000000, "step": 1}),
                "playback_speed": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.05}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                "longest_side": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_width": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "crop_height": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, video_path: str, **kwargs: Any) -> str:
        if video_path and os.path.isfile(video_path):
            try:
                mtime = os.path.getmtime(video_path)
                return f"{mtime}:{kwargs.get('start_time')}:{kwargs.get('segment_duration')}:{kwargs.get('current_frame_offset')}:{kwargs.get('longest_side')}:{kwargs.get('crop_x')}:{kwargs.get('crop_y')}:{kwargs.get('crop_width')}:{kwargs.get('crop_height')}"
            except OSError:
                pass
        return ""

    def load_video(
        self,
        video_path: str,
        start_time: float = 0.0,
        segment_duration: float = 2.0,
        current_frame_offset: int = 0,
        playback_speed: float = 1.0,
        fps: float = 24.0,
        longest_side: int = 0,
        crop_x: int = 0,
        crop_y: int = 0,
        crop_width: int = 0,
        crop_height: int = 0,
    ) -> tuple[torch.Tensor, torch.Tensor, dict[str, Any], Any, dict[str, Any], int, int, str]:
        path_str = str(video_path or "").strip()
        if not path_str or not os.path.isfile(path_str):
            empty_img = empty_image_tensor()
            empty_info = {
                "fps": fps,
                "total_frames": 0,
                "current_frame_idx": 0,
                "segment_start_frame": 0,
                "segment_end_frame": 0,
                "video_path": path_str,
                "width": 512,
                "height": 512,
            }
            return (
                empty_img,
                empty_img,
                empty_audio_dict(),
                None,
                empty_info,
                512,
                512,
                path_str,
            )

        resolved = str(Path(path_str).resolve())
        crop = (crop_x, crop_y, crop_width, crop_height)
        result = decode_video_segment(
            video_path=resolved,
            start_time=start_time,
            segment_duration=segment_duration,
            current_frame_offset=current_frame_offset,
            playback_speed=playback_speed,
            fps=fps,
            longest_side=longest_side,
            crop=crop,
        )

        return (
            result["image"],
            result["single_frame"],
            result["audio"],
            result["video"],
            result["frame_info"],
            result["width"],
            result["height"],
            resolved,
        )
