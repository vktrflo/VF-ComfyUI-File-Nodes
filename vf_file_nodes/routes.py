"""HTTP API routes for VF ComfyUI File Nodes."""

from __future__ import annotations

import io
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from aiohttp import web
from PIL import Image

from .drive_utils import get_available_drives
from .media_utils import (
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    TEXT_EXTENSIONS,
    VIDEO_EXTENSIONS,
    classify_media_type,
)

try:
    import folder_paths
except ImportError:
    folder_paths = None

try:
    from server import PromptServer
except ImportError:
    PromptServer = None


# In-memory thumbnail cache: path -> (mtime, jpeg_bytes)
_THUMBNAIL_CACHE: dict[str, tuple[float, bytes]] = {}
MAX_THUMB_CACHE_SIZE = 1000


async def handle_drives(request: web.Request) -> web.Response:
    """Return available drive roots and mapped network shares."""
    drives = get_available_drives()
    return web.json_response({"drives": drives})


async def handle_start(request: web.Request) -> web.Response:
    """Return default start directory."""
    start_path = ""
    if folder_paths is not None:
        try:
            start_path = folder_paths.get_input_directory()
        except Exception:
            start_path = ""
    if not start_path or not os.path.exists(start_path):
        drives = get_available_drives()
        start_path = drives[0]["path"] if drives else os.path.expanduser("~")
    return web.json_response({"path": start_path})


async def handle_resolve(request: web.Request) -> web.Response:
    """Resolve relative or absolute file paths."""
    raw_path = str(request.query.get("path", "")).strip()
    if not raw_path:
        return web.json_response({"dir": "", "file": "", "filename": "", "exists": False})

    candidates: list[Path] = [Path(raw_path)]
    normalized = raw_path.replace("\\", "/").strip("/")
    lower = normalized.lower()

    if folder_paths is not None:
        try:
            in_dir = folder_paths.get_input_directory()
            out_dir = folder_paths.get_output_directory()
            if in_dir and lower.startswith("input/"):
                candidates.append(Path(in_dir) / normalized[6:].lstrip("/"))
            elif out_dir and lower.startswith("output/"):
                candidates.append(Path(out_dir) / normalized[7:].lstrip("/"))
            else:
                if in_dir:
                    candidates.append(Path(in_dir) / normalized)
                if out_dir:
                    candidates.append(Path(out_dir) / normalized)
        except Exception:
            pass

    for cand in candidates:
        try:
            if cand.is_file():
                return web.json_response({
                    "dir": str(cand.parent),
                    "file": str(cand),
                    "filename": cand.name,
                    "exists": True,
                })
            elif cand.is_dir():
                return web.json_response({
                    "dir": str(cand),
                    "file": "",
                    "filename": "",
                    "exists": True,
                })
        except (OSError, ValueError):
            continue

    return web.json_response({"dir": "", "file": "", "filename": "", "exists": False})


async def handle_list(request: web.Request) -> web.Response:
    """List subdirectories and files matching filter."""
    path_param = request.query.get("path", "")
    filter_mode = request.query.get("filter", "all").lower()

    dirs: list[str] = []
    dir_meta: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []

    if not path_param or not os.path.exists(path_param) or not os.path.isdir(path_param):
        return web.json_response(
            {"dirs": dirs, "dir_meta": dir_meta, "files": files, "exists": False if path_param else True}
        )

    try:
        with os.scandir(path_param) as entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        dirs.append(entry.name)
                        try:
                            mtime = entry.stat().st_mtime
                        except (PermissionError, OSError):
                            mtime = 0.0
                        dir_meta.append({"name": entry.name, "mtime": mtime})
                    elif entry.is_file(follow_symlinks=False):
                        ext = os.path.splitext(entry.name)[1].lower()
                        media_type = classify_media_type(entry.name)

                        include = False
                        if filter_mode == "all":
                            include = True
                        elif filter_mode == "image" and media_type == "image":
                            include = True
                        elif filter_mode == "video" and media_type == "video":
                            include = True
                        elif filter_mode == "audio" and media_type == "audio":
                            include = True
                        elif filter_mode == "text" and media_type == "text":
                            include = True

                        if include:
                            st = entry.stat()
                            files.append({
                                "name": entry.name,
                                "path": entry.path,
                                "size": st.st_size,
                                "mtime": st.st_mtime,
                                "extension": ext,
                                "media_type": media_type,
                            })
                except (PermissionError, OSError):
                    continue
    except PermissionError:
        pass

    dirs.sort(key=str.lower)
    dir_meta.sort(key=lambda d: str(d.get("name", "")).lower())
    files.sort(key=lambda f: str(f.get("name", "")).lower())

    return web.json_response({
        "dirs": dirs,
        "dir_meta": dir_meta,
        "files": files,
        "exists": True,
    })


async def handle_thumbnail(request: web.Request) -> web.StreamResponse:
    """Generate or retrieve cached thumbnail image."""
    file_path = request.query.get("path", "")
    if not file_path or not os.path.isfile(file_path):
        return web.Response(status=404, text="File not found")

    try:
        st = os.stat(file_path)
        mtime = st.st_mtime
    except OSError:
        return web.Response(status=404, text="Cannot stat file")

    cached = _THUMBNAIL_CACHE.get(file_path)
    if cached and cached[0] == mtime:
        return web.Response(body=cached[1], content_type="image/jpeg")

    media_type = classify_media_type(file_path)
    thumb_img: Image.Image | None = None

    try:
        if media_type == "image":
            with Image.open(file_path) as im:
                im = im.convert("RGB")
                im.thumbnail((256, 256), Image.Resampling.LANCZOS)
                thumb_img = im
        elif media_type == "video":
            import av

            container = av.open(file_path)
            stream = next((s for s in container.streams if s.type == "video"), None)
            if stream:
                for frame in container.decode(stream):
                    im = frame.to_image().convert("RGB")
                    im.thumbnail((256, 256), Image.Resampling.LANCZOS)
                    thumb_img = im
                    break
            container.close()

        if thumb_img is None:
            return web.Response(status=415, text="Thumbnail not supported")

        buf = io.BytesIO()
        thumb_img.save(buf, format="JPEG", quality=80)
        jpeg_bytes = buf.getvalue()

        if len(_THUMBNAIL_CACHE) > MAX_THUMB_CACHE_SIZE:
            _THUMBNAIL_CACHE.clear()
        _THUMBNAIL_CACHE[file_path] = (mtime, jpeg_bytes)

        return web.Response(body=jpeg_bytes, content_type="image/jpeg")
    except Exception as exc:
        return web.Response(status=500, text=f"Thumbnail error: {exc}")


async def handle_view(request: web.Request) -> web.StreamResponse:
    """Stream media file with HTTP Range support for video seeking."""
    file_path = request.query.get("path", "")
    if not file_path or not os.path.isfile(file_path):
        return web.Response(status=404, text="File not found")

    # aiohttp web.FileResponse provides full HTTP 206 Range headers natively
    return web.FileResponse(file_path)


async def handle_delete(request: web.Request) -> web.Response:
    """Delete a file from disk with validation."""
    data = {}
    if request.can_read_body:
        try:
            data = await request.json()
        except Exception:
            pass
    target = data.get("path") or request.query.get("path", "")
    target = str(target).strip()

    if not target or not os.path.exists(target):
        return web.json_response({"success": False, "error": "File does not exist"}, status=404)

    if not os.path.isfile(target):
        return web.json_response({"success": False, "error": "Target is not a file"}, status=400)

    try:
        os.remove(target)
        _THUMBNAIL_CACHE.pop(target, None)
        return web.json_response({"success": True, "path": target})
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def handle_open_in_explorer(request: web.Request) -> web.Response:
    """Reveal a file or folder in the system file manager."""
    data = {}
    if request.can_read_body:
        try:
            data = await request.json()
        except Exception:
            pass
    target = data.get("path") or request.query.get("path", "")
    target = str(target).strip()

    if not target or not os.path.exists(target):
        return web.json_response({"success": False, "error": "Path does not exist"}, status=404)

    try:
        if sys.platform == "win32":
            if os.path.isfile(target):
                subprocess.Popen(["explorer", f"/select,{target}"])
            else:
                os.startfile(target)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R" if os.path.isfile(target) else "", target])
        else:
            parent = os.path.dirname(target) if os.path.isfile(target) else target
            subprocess.Popen(["xdg-open", parent])
        return web.json_response({"success": True})
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


def setup_routes(app: web.Application) -> None:
    """Register all routes on an aiohttp application."""
    app.router.add_get("/api/vf-file-nodes/drives", handle_drives)
    app.router.add_get("/api/vf-file-nodes/start", handle_start)
    app.router.add_get("/api/vf-file-nodes/resolve", handle_resolve)
    app.router.add_get("/api/vf-file-nodes/list", handle_list)
    app.router.add_get("/api/vf-file-nodes/thumbnail", handle_thumbnail)
    app.router.add_get("/api/vf-file-nodes/view", handle_view)
    app.router.add_post("/api/vf-file-nodes/delete", handle_delete)
    app.router.add_post("/api/vf-file-nodes/open-in-explorer", handle_open_in_explorer)


def register_prompt_server_routes() -> None:
    """Register routes on ComfyUI's PromptServer if available."""
    if PromptServer is not None and hasattr(PromptServer, "instance") and PromptServer.instance:
        app = PromptServer.instance.app
        setup_routes(app)
        print("[VF File Nodes] API routes registered successfully under /api/vf-file-nodes/")
