"""VF ComfyUI File Nodes core package."""

from .node_file_explorer import VFFileExplorer
from .node_unpack_media import VFUnpackMedia
from .node_load_image import VFLoadImage
from .node_load_video import VFLoadVideo
from .node_load_audio import VFLoadAudio
from .routes import register_prompt_server_routes

NODE_CLASS_MAPPINGS = {
    "VFFileExplorer": VFFileExplorer,
    "VFUnpackMedia": VFUnpackMedia,
    "VFLoadImage": VFLoadImage,
    "VFLoadVideo": VFLoadVideo,
    "VFLoadAudio": VFLoadAudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VFFileExplorer": "🌀 VF File Explorer",
    "VFUnpackMedia": "🌀 VF Unpack Media",
    "VFLoadImage": "🌀 VF Load Image",
    "VFLoadVideo": "🌀 VF Load Video",
    "VFLoadAudio": "🌀 VF Load Audio",
}

# Auto-register API routes when imported in ComfyUI
register_prompt_server_routes()

__all__ = [
    "VFFileExplorer",
    "VFUnpackMedia",
    "VFLoadImage",
    "VFLoadVideo",
    "VFLoadAudio",
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]
