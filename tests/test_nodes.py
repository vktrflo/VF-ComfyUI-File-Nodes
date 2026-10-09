import torch
from pathlib import Path
from vf_file_nodes.node_file_explorer import VFFileExplorer
from vf_file_nodes.node_unpack_media import VFUnpackMedia
from vf_file_nodes.node_load_image import VFLoadImage
from vf_file_nodes.node_load_video import VFLoadVideo
from vf_file_nodes.node_load_audio import VFLoadAudio
import vf_file_nodes

def test_node_mappings():
    assert "VFFileExplorer" in vf_file_nodes.NODE_CLASS_MAPPINGS
    assert "VFUnpackMedia" in vf_file_nodes.NODE_CLASS_MAPPINGS
    assert "VFLoadImage" in vf_file_nodes.NODE_CLASS_MAPPINGS
    assert "VFLoadVideo" in vf_file_nodes.NODE_CLASS_MAPPINGS
    assert "VFLoadAudio" in vf_file_nodes.NODE_CLASS_MAPPINGS

    assert vf_file_nodes.NODE_DISPLAY_NAME_MAPPINGS["VFFileExplorer"] == "🌀 VF File Explorer"
    assert vf_file_nodes.NODE_DISPLAY_NAME_MAPPINGS["VFUnpackMedia"] == "🌀 VF Unpack Media"
    assert vf_file_nodes.NODE_DISPLAY_NAME_MAPPINGS["VFLoadImage"] == "🌀 VF Load Image"
    assert vf_file_nodes.NODE_DISPLAY_NAME_MAPPINGS["VFLoadVideo"] == "🌀 VF Load Video"
    assert vf_file_nodes.NODE_DISPLAY_NAME_MAPPINGS["VFLoadAudio"] == "🌀 VF Load Audio"

def test_vf_file_explorer_contract():
    inputs = VFFileExplorer.INPUT_TYPES()
    assert "file_path" in inputs["required"]
    assert VFFileExplorer.RETURN_TYPES == ("VF_MEDIA", "STRING")
    assert VFFileExplorer.RETURN_NAMES == ("media", "path")

    explorer = VFFileExplorer()
    cur_file = str(Path(__file__).resolve())
    media, path = explorer.load(cur_file)
    assert path == cur_file
    assert isinstance(media, dict)
    assert media["path"] == cur_file
    assert media["media_type"] == "text"

def test_vf_unpack_media_safety():
    node = VFUnpackMedia()
    # Test unpacking None/empty media
    img, mask, audio, text, path, mtype = node.unpack(media=None)
    assert img.shape == (1, 64, 64, 3)
    assert mask.shape == (1, 64, 64)
    assert audio["sample_rate"] == 44100
    assert text == ""
    assert path == ""
    assert mtype == "unknown"

    # Test unpacking text media
    text_media = {
        "path": str(Path(__file__).resolve()),
        "media_type": "text",
        "filename": "test_nodes.py",
    }
    img2, mask2, audio2, text2, path2, mtype2 = node.unpack(media=text_media)
    assert mtype2 == "text"
    assert "def test_vf_unpack_media_safety" in text2
    assert img2.shape == (1, 64, 64, 3) # safe non-crash fallback
    assert audio2["sample_rate"] == 44100 # safe non-crash fallback

def test_vf_load_image_contract():
    assert VFLoadImage.RETURN_TYPES == ("IMAGE", "MASK", "STRING", "INT", "INT")
    assert VFLoadImage.RETURN_NAMES == ("image", "mask", "path", "width", "height")

def test_vf_load_image_execution(tmp_path, monkeypatch):
    from PIL import Image
    import sys

    node = VFLoadImage()

    # 1. Empty/missing path
    img, mask, path, w, h = node.load("")
    assert img.shape == (1, 64, 64, 3) or img.shape == (1, 512, 512, 3)
    assert mask.shape == (1, 64, 64) or mask.shape == (1, 512, 512)
    assert w == 512 and h == 512

    # 2. Existing image file
    test_img = tmp_path / "sample.png"
    im = Image.new("RGBA", (120, 80), color=(100, 150, 200, 255))
    im.save(test_img)

    img, mask, path, w, h = node.load(str(test_img))
    assert img.shape == (1, 80, 120, 3)
    assert mask.shape == (1, 80, 120)
    assert w == 120 and h == 80
    assert path == str(test_img.resolve())

    # IS_CHANGED
    change_sig = VFLoadImage.IS_CHANGED(str(test_img))
    assert change_sig.endswith(":0")

    # 3. ComfyUI annotated filepath simulation (clipspace mask)
    clip_file = tmp_path / "clipspace-mask-123.png"
    im.save(clip_file)

    class MockFolderPaths:
        @staticmethod
        def get_annotated_filepath(name):
            if "clipspace-mask-123.png" in name:
                return str(clip_file)
            return name
        @staticmethod
        def get_input_directory():
            return str(tmp_path)

    monkeypatch.setitem(sys.modules, "folder_paths", MockFolderPaths)

    img_ann, mask_ann, path_ann, w_ann, h_ann = node.load("clipspace-mask-123.png [input]")
    assert img_ann.shape == (1, 80, 120, 3)
    assert path_ann == str(clip_file.resolve())

def test_vf_load_video_contract():
    assert VFLoadVideo.RETURN_TYPES == ("IMAGE", "IMAGE", "AUDIO", "VIDEO", "DICT", "INT", "INT", "STRING")
    assert VFLoadVideo.RETURN_NAMES == ("image", "single_frame", "audio", "video", "frame_info", "width", "height", "path")

def test_vf_load_audio_contract():
    assert VFLoadAudio.RETURN_TYPES == ("AUDIO", "STRING", "FLOAT", "INT")
    assert VFLoadAudio.RETURN_NAMES == ("audio", "path", "duration", "sample_rate")
