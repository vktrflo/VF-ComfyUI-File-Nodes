"""HTTP API routes for VF ComfyUI File Nodes."""

from __future__ import annotations

import asyncio
import hashlib
import io
import ipaddress
import os
import socket
import subprocess
import sys
import tempfile
import time
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
    extract_comfy_parameters,
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

# Metadata cache: path -> (mtime, size, meta_dict)
_METADATA_CACHE: dict[str, tuple[float, int, dict[str, Any]]] = {}
MAX_META_CACHE_SIZE = 10000

# ComfyUI parameters cache: path -> (mtime, size, params_dict)
_COMFY_PARAMS_CACHE: dict[str, tuple[float, int, dict[str, Any]]] = {}
MAX_PARAMS_CACHE_SIZE = 1000

_DISK_CACHE_DIR: Path | None = None
_LOCAL_IPS_CACHE: set[str] = set()
_LOCAL_IPS_CACHE_TIME: float = 0.0


def get_local_ip_set() -> set[str]:
    """Return all IP addresses corresponding to local network interfaces on this machine."""
    global _LOCAL_IPS_CACHE, _LOCAL_IPS_CACHE_TIME
    now = time.time()
    if _LOCAL_IPS_CACHE and (now - _LOCAL_IPS_CACHE_TIME) < 60.0:
        return _LOCAL_IPS_CACHE

    local_ips = {"127.0.0.1", "::1", "localhost"}
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            local_ips.add(ip)
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            local_ips.add(info[4][0])
    except Exception:
        pass

    _LOCAL_IPS_CACHE = local_ips
    _LOCAL_IPS_CACHE_TIME = now
    return local_ips


def is_local_request(request: web.Request) -> bool:
    """Determine if an incoming HTTP request originated from the same machine."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.headers.get("x-real-ip") or request.remote or ""

    if not client_ip:
        return False

    local_ips = get_local_ip_set()
    if client_ip in local_ips:
        return True

    try:
        ip = ipaddress.ip_address(client_ip)
        if ip.is_loopback or (getattr(ip, "ipv4_mapped", None) and ip.ipv4_mapped.is_loopback):
            return True
    except ValueError:
        pass

    return False


def _get_disk_cache_dir() -> Path:
    global _DISK_CACHE_DIR
    if _DISK_CACHE_DIR is None:
        base = None
        if folder_paths is not None:
            try:
                user_dir = folder_paths.get_user_directory()
                if user_dir and os.path.exists(user_dir):
                    base = os.path.join(user_dir, ".cache", "vf_thumbnails")
            except Exception:
                base = None
        if not base:
            base = os.path.join(tempfile.gettempdir(), "comfyui_vf_thumbnails")
        os.makedirs(base, exist_ok=True)
        _DISK_CACHE_DIR = Path(base)
    return _DISK_CACHE_DIR


def _get_cache_key(file_path: str, mtime: float, size: int) -> str:
    h = hashlib.sha256(f"{file_path}:{mtime}:{size}".encode("utf-8")).hexdigest()
    return h[:32]


def get_media_metadata(file_path: str, media_type: str, st: os.stat_result) -> dict[str, Any]:
    """Extract creation time, dimensions, and duration for supported media types."""
    cached = _METADATA_CACHE.get(file_path)
    if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
        return cached[2]

    meta: dict[str, Any] = {
        "dimensions": None,
        "duration": None,
        "ctime": getattr(st, "st_ctime", st.st_mtime),
    }

    try:
        if media_type == "image":
            with Image.open(file_path) as im:
                meta["dimensions"] = [im.width, im.height]
        elif media_type == "video":
            import av

            with av.open(file_path) as container:
                stream = next((s for s in container.streams if s.type == "video"), None)
                if stream:
                    meta["dimensions"] = [stream.width, stream.height]
                if container.duration is not None and av.time_base:
                    meta["duration"] = round(float(container.duration) / av.time_base, 2)
                elif stream and stream.duration is not None and stream.time_base:
                    meta["duration"] = round(float(stream.duration * stream.time_base), 2)
        elif media_type == "audio":
            import av

            with av.open(file_path) as container:
                if container.duration is not None and av.time_base:
                    meta["duration"] = round(float(container.duration) / av.time_base, 2)
                else:
                    stream = next((s for s in container.streams if s.type == "audio"), None)
                    if stream and stream.duration is not None and stream.time_base:
                        meta["duration"] = round(float(stream.duration * stream.time_base), 2)
    except Exception:
        pass

    if len(_METADATA_CACHE) > MAX_META_CACHE_SIZE:
        _METADATA_CACHE.clear()
    _METADATA_CACHE[file_path] = (st.st_mtime, st.st_size, meta)
    return meta


def _generate_thumbnail_worker(file_path: str, media_type: str, cache_file: Path) -> bytes | None:
    """Generate thumbnail image in background worker thread."""
    thumb_img: Image.Image | None = None

    try:
        if media_type == "image":
            with Image.open(file_path) as im:
                if hasattr(im, "draft") and file_path.lower().endswith((".jpg", ".jpeg")):
                    try:
                        im.draft("RGB", (256, 256))
                    except Exception:
                        pass
                im = im.convert("RGB")
                im.thumbnail((256, 256), Image.Resampling.BILINEAR)
                thumb_img = im
        elif media_type == "video":
            import av

            with av.open(file_path) as container:
                stream = next((s for s in container.streams if s.type == "video"), None)
                if stream:
                    stream.thread_type = "AUTO"
                    for frame in container.decode(stream):
                        im = frame.to_image().convert("RGB")
                        im.thumbnail((256, 256), Image.Resampling.BILINEAR)
                        thumb_img = im
                        break

        if thumb_img is None:
            return None

        buf = io.BytesIO()
        thumb_img.save(buf, format="JPEG", quality=80)
        jpeg_bytes = buf.getvalue()

        try:
            tmp_cache = cache_file.with_suffix(".tmp")
            tmp_cache.write_bytes(jpeg_bytes)
            tmp_cache.replace(cache_file)
        except Exception:
            pass

        return jpeg_bytes
    except Exception:
        return None


async def handle_drives(request: web.Request) -> web.Response:
    """Return available drive roots and mapped network shares."""
    drives = get_available_drives()
    return web.json_response({"drives": drives})


async def handle_is_local(request: web.Request) -> web.Response:
    """Return whether the current client is accessing from the same machine."""
    return web.json_response({"is_local": is_local_request(request)})


async def handle_start(request: web.Request) -> web.Response:
    """Return default start directory and local client status."""
    start_path = ""
    if folder_paths is not None:
        try:
            start_path = folder_paths.get_input_directory()
        except Exception:
            start_path = ""
    if not start_path or not os.path.exists(start_path):
        drives = get_available_drives()
        start_path = drives[0]["path"] if drives else os.path.expanduser("~")
    return web.json_response({
        "path": start_path,
        "is_local": is_local_request(request),
    })


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
                            meta = get_media_metadata(entry.path, media_type, st)
                            files.append({
                                "name": entry.name,
                                "path": entry.path,
                                "size": st.st_size,
                                "mtime": st.st_mtime,
                                "ctime": meta.get("ctime", getattr(st, "st_ctime", st.st_mtime)),
                                "extension": ext,
                                "media_type": media_type,
                                "dimensions": meta.get("dimensions"),
                                "duration": meta.get("duration"),
                            })
                except (PermissionError, OSError):
                    continue
    except PermissionError:
        pass

    sort_mode = request.query.get("sort", "name_asc").lower()

    if sort_mode == "name_desc":
        dirs.sort(key=str.lower, reverse=True)
        dir_meta.sort(key=lambda d: str(d.get("name", "")).lower(), reverse=True)
        files.sort(key=lambda f: str(f.get("name", "")).lower(), reverse=True)
    elif sort_mode == "mtime_desc":
        files.sort(key=lambda f: float(f.get("mtime", 0.0)), reverse=True)
        dir_meta.sort(key=lambda d: float(d.get("mtime", 0.0)), reverse=True)
        dirs = [str(d.get("name", "")) for d in dir_meta]
    elif sort_mode == "mtime_asc":
        files.sort(key=lambda f: float(f.get("mtime", 0.0)))
        dir_meta.sort(key=lambda d: float(d.get("mtime", 0.0)))
        dirs = [str(d.get("name", "")) for d in dir_meta]
    elif sort_mode == "size_desc":
        files.sort(key=lambda f: int(f.get("size", 0)), reverse=True)
    elif sort_mode == "size_asc":
        files.sort(key=lambda f: int(f.get("size", 0)))
    else:  # name_asc default
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
    """Generate or retrieve cached thumbnail image with offloaded worker threads."""
    file_path = request.query.get("path", "")
    if not file_path or not os.path.isfile(file_path):
        return web.Response(status=404, text="File not found")

    try:
        st = os.stat(file_path)
        mtime = st.st_mtime
    except OSError:
        return web.Response(status=404, text="Cannot stat file")

    # 1. Check in-memory cache
    cached = _THUMBNAIL_CACHE.get(file_path)
    if cached and cached[0] == mtime:
        return web.Response(body=cached[1], content_type="image/jpeg")

    media_type = classify_media_type(file_path)
    if media_type not in ("image", "video"):
        return web.Response(status=415, text="Thumbnail not supported")

    # 2. Check disk cache
    cache_key = _get_cache_key(file_path, mtime, st.st_size)
    cache_file = _get_disk_cache_dir() / f"{cache_key}.jpg"

    if cache_file.exists():
        try:
            jpeg_bytes = await asyncio.to_thread(cache_file.read_bytes)
            if len(_THUMBNAIL_CACHE) > MAX_THUMB_CACHE_SIZE:
                _THUMBNAIL_CACHE.clear()
            _THUMBNAIL_CACHE[file_path] = (mtime, jpeg_bytes)
            return web.Response(body=jpeg_bytes, content_type="image/jpeg")
        except OSError:
            pass

    # 3. Offload generation to background worker thread so the event loop stays responsive
    try:
        jpeg_bytes = await asyncio.to_thread(_generate_thumbnail_worker, file_path, media_type, cache_file)
        if jpeg_bytes is None:
            return web.Response(status=415, text="Thumbnail generation failed")

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

    media_type = classify_media_type(target)
    if media_type not in ("image", "video", "audio", "text"):
        return web.json_response(
            {"success": False, "error": "Only supported media files (image, video, audio, text) can be deleted"},
            status=400,
        )

    try:
        os.remove(target)
        _THUMBNAIL_CACHE.pop(target, None)
        return web.json_response({"success": True, "path": target})
    except Exception as exc:
        return web.json_response({"success": False, "error": str(exc)}, status=500)


async def handle_open_in_explorer(request: web.Request) -> web.Response:
    """Reveal a file or folder in the system file manager."""
    if not is_local_request(request):
        return web.json_response(
            {"success": False, "error": "Opening file explorer is only supported from the local machine"},
            status=403,
        )

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


def _get_favorites_file() -> Path:
    user_dir: Path | None = None
    if folder_paths is not None:
        try:
            ud = folder_paths.get_user_directory()
            if ud:
                user_dir = Path(ud)
        except Exception:
            pass
    if user_dir is None:
        user_dir = Path.home() / ".comfyui" / "user"
    fav_dir = user_dir / "vf_file_nodes"
    fav_dir.mkdir(parents=True, exist_ok=True)
    return fav_dir / "favorites.json"


def _read_favorites() -> list[dict[str, str]]:
    fav_file = _get_favorites_file()
    if not fav_file.exists():
        return []
    try:
        import json
        data = json.loads(fav_file.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _write_favorites(favorites: list[dict[str, str]]) -> None:
    fav_file = _get_favorites_file()
    import json
    fav_file.write_text(json.dumps(favorites, indent=2), encoding="utf-8")


async def handle_get_favorites(request: web.Request) -> web.Response:
    """Return the persisted favorite folders list."""
    return web.json_response({"favorites": _read_favorites()})


async def handle_add_favorite(request: web.Request) -> web.Response:
    """Add a folder to the favorites list."""
    data = {}
    if request.can_read_body:
        try:
            data = await request.json()
        except Exception:
            pass
    folder_path = str(data.get("path") or request.query.get("path", "")).strip()
    name = str(data.get("name") or "").strip()
    if not folder_path:
        return web.json_response({"success": False, "error": "Path required"}, status=400)

    resolved = str(Path(folder_path).resolve())
    if not name:
        name = Path(resolved).name or resolved

    favs = _read_favorites()
    if not any(f.get("path", "").lower() == resolved.lower() for f in favs):
        favs.append({"name": name, "path": resolved})
        _write_favorites(favs)

    return web.json_response({"success": True, "favorites": favs})


async def handle_remove_favorite(request: web.Request) -> web.Response:
    """Remove a folder from the favorites list."""
    data = {}
    if request.can_read_body:
        try:
            data = await request.json()
        except Exception:
            pass
    folder_path = str(data.get("path") or request.query.get("path", "")).strip()
    if not folder_path:
        return web.json_response({"success": False, "error": "Path required"}, status=400)

    resolved = str(Path(folder_path).resolve())
    favs = _read_favorites()
    favs = [
        f for f in favs
        if f.get("path", "").lower() != resolved.lower() and f.get("path", "").lower() != folder_path.lower()
    ]
    _write_favorites(favs)

    return web.json_response({"success": True, "favorites": favs})


async def handle_comfy_parameters(request: web.Request) -> web.Response:
    """Return embedded ComfyUI parameters (prompt, negative, sampler settings, workflow)."""
    file_path = str(request.query.get("path", "")).strip()
    if not file_path:
        return web.json_response({"has_parameters": False, "error": "Path required"}, status=400)

    p = Path(file_path)
    if not p.is_file():
        return web.json_response({"has_parameters": False, "error": "File not found"}, status=200)

    try:
        st = p.stat()
        cached = _COMFY_PARAMS_CACHE.get(str(p))
        if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
            return web.json_response(cached[2])
    except Exception:
        return web.json_response({"has_parameters": False, "error": "Cannot read file"}, status=200)

    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(None, extract_comfy_parameters, str(p))

    if len(_COMFY_PARAMS_CACHE) > MAX_PARAMS_CACHE_SIZE:
        _COMFY_PARAMS_CACHE.clear()
    _COMFY_PARAMS_CACHE[str(p)] = (st.st_mtime, st.st_size, res)

    return web.json_response(res)


def setup_routes(app: web.Application) -> None:
    """Register all routes on an aiohttp application."""
    app.router.add_get("/api/vf-file-nodes/is-local", handle_is_local)
    app.router.add_get("/api/vf-file-nodes/drives", handle_drives)
    app.router.add_get("/api/vf-file-nodes/start", handle_start)
    app.router.add_get("/api/vf-file-nodes/resolve", handle_resolve)
    app.router.add_get("/api/vf-file-nodes/list", handle_list)
    app.router.add_get("/api/vf-file-nodes/thumbnail", handle_thumbnail)
    app.router.add_get("/api/vf-file-nodes/view", handle_view)
    app.router.add_get("/api/vf-file-nodes/comfy-parameters", handle_comfy_parameters)
    app.router.add_post("/api/vf-file-nodes/delete", handle_delete)
    app.router.add_post("/api/vf-file-nodes/open-in-explorer", handle_open_in_explorer)
    app.router.add_get("/api/vf-file-nodes/favorites", handle_get_favorites)
    app.router.add_post("/api/vf-file-nodes/favorites/add", handle_add_favorite)
    app.router.add_post("/api/vf-file-nodes/favorites/remove", handle_remove_favorite)


def register_prompt_server_routes() -> None:
    """Register routes on ComfyUI's PromptServer if available."""
    if PromptServer is not None and hasattr(PromptServer, "instance") and PromptServer.instance:
        app = PromptServer.instance.app
        setup_routes(app)
        print("[VF File Nodes] API routes registered successfully under /api/vf-file-nodes/")
