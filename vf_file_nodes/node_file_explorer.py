"""🌀 VF File Explorer node."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .media_utils import classify_media_type


class VFFileExplorer:
    """Canvas-embedded file explorer for navigating drives, previewing, and selecting media."""

    CATEGORY = "VF/File Loaders"
    FUNCTION = "load"
    RETURN_TYPES = ("VF_MEDIA", "STRING")
    RETURN_NAMES = ("media", "path")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, tuple[str, dict[str, Any]]]]:
        return {
            "required": {
                "file_path": ("STRING", {"default": ""}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, file_path: str) -> float:
        if file_path and os.path.isfile(file_path):
            try:
                return os.path.getmtime(file_path)
            except OSError:
                pass
        return 0.0

    def load(self, file_path: str) -> tuple[dict[str, Any], str]:
        path_str = str(file_path or "").strip()
        if not path_str:
            empty_media: dict[str, Any] = {
                "path": "",
                "filename": "",
                "dir": "",
                "extension": "",
                "media_type": "unknown",
                "size": 0,
                "mtime": 0.0,
            }
            return (empty_media, "")

        resolved = Path(path_str).resolve()
        exists = resolved.is_file()
        media_type = classify_media_type(resolved) if exists else "unknown"

        size = 0
        mtime = 0.0
        if exists:
            try:
                st = resolved.stat()
                size = st.st_size
                mtime = st.st_mtime
            except OSError:
                pass

        media: dict[str, Any] = {
            "path": str(resolved),
            "filename": resolved.name,
            "dir": str(resolved.parent),
            "extension": resolved.suffix.lower(),
            "media_type": media_type,
            "size": size,
            "mtime": mtime,
        }

        return (media, str(resolved))
