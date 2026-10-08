"""🌀 VF Load Audio node."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .media_utils import empty_audio_dict, load_audio


class VFLoadAudio:
    """Dedicated audio loader with start-time and duration trimming."""

    CATEGORY = "VF/File Loaders"
    FUNCTION = "load_audio"
    RETURN_TYPES = ("AUDIO", "STRING", "FLOAT", "INT")
    RETURN_NAMES = ("audio", "path", "duration", "sample_rate")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, tuple[str, dict[str, Any]]]]:
        return {
            "required": {
                "audio_path": ("STRING", {"default": ""}),
                "start_time": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
                "duration": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, audio_path: str, start_time: float = 0.0, duration: float = 0.0) -> str:
        if audio_path and os.path.isfile(audio_path):
            try:
                mtime = os.path.getmtime(audio_path)
                return f"{mtime}:{start_time}:{duration}"
            except OSError:
                pass
        return ""

    def load_audio(
        self, audio_path: str, start_time: float = 0.0, duration: float = 0.0
    ) -> tuple[dict[str, Any], str, float, int]:
        path_str = str(audio_path or "").strip()
        if not path_str or not os.path.isfile(path_str):
            empty = empty_audio_dict()
            return empty, path_str, 0.0, empty["sample_rate"]

        resolved = str(Path(path_str).resolve())
        res = load_audio(resolved, start_time=start_time, duration=duration)
        audio_dict = {"waveform": res["waveform"], "sample_rate": res["sample_rate"]}
        return audio_dict, resolved, float(res["duration"]), int(res["sample_rate"])
