import torch
import pytest
from types import SimpleNamespace
from pathlib import Path
from PIL import Image
from vf_file_nodes.media_utils import (
    classify_media_type,
    load_image,
    empty_image_tensor,
    empty_mask_tensor,
    empty_audio_dict,
)
from vf_file_nodes import media_utils


@pytest.mark.parametrize("crop,longest_side", [
    ((0, 0, 33, 35), 0), ((0, 0, 34, 35), 0),
    ((0, 0, 33, 36), 0), ((0, 0, 34, 36), 0),
    ((0, 0, 34, 36), 33),
    ((0, 0, 550, 1337), 0), ((0, 0, 1, 1), 0),
])
def test_video_output_encodes_odd_crop_and_resize_dimensions(tmp_path, monkeypatch, crop, longest_side):
    av = pytest.importorskip("av")
    import numpy as np

    source = tmp_path / "source.mp4"
    with av.open(str(source), "w") as container:
        stream = container.add_stream("libx264", rate=24)
        source_width = max(64, crop[2] + crop[2] % 2)
        source_height = max(64, crop[3] + crop[3] % 2)
        stream.width, stream.height = source_width, source_height
        stream.pix_fmt = "yuv420p"
        pixels = np.arange(source_height * source_width * 3, dtype=np.uint8).reshape(source_height, source_width, 3)
        frame = av.VideoFrame.from_ndarray(pixels, format="rgb24")
        for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)

    # Capture the components passed to ComfyUI, then exercise the actual H.264 encoder.
    monkeypatch.setattr(media_utils, "has_comfy_video_api", True)
    monkeypatch.setattr(media_utils, "InputImpl", SimpleNamespace(VideoFromComponents=lambda components, **kwargs: components))
    monkeypatch.setattr(media_utils, "Types", SimpleNamespace(VideoComponents=SimpleNamespace))
    result = media_utils.decode_video_segment(str(source), crop=crop, longest_side=longest_side)
    images = result["image"]
    video_images = result["video"].images
    height, width = images.shape[1:3]
    assert video_images.shape[1:3] == (height + height % 2, width + width % 2)
    assert torch.equal(video_images[:, :height, :width], images)
    assert torch.equal(video_images[:, -1, :width], images[:, -1])
    assert torch.equal(video_images[:, :height, -1], images[:, :, -1])
    assert result["width"] == width and result["height"] == height
    assert torch.equal(result["single_frame"], images[:1])

    saved = tmp_path / "saved.mp4"
    with av.open(str(saved), "w") as container:
        stream = container.add_stream("libx264", rate=result["video"].frame_rate)
        stream.width, stream.height = video_images.shape[2], video_images.shape[1]
        stream.pix_fmt = "yuv420p"
        for image in video_images:
            frame = av.VideoFrame.from_ndarray((image * 255).byte().numpy(), format="rgb24")
            for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)
    with av.open(str(saved)) as container:
        assert len(list(container.decode(video=0))) == len(images)

def test_classify_media_type():
    assert classify_media_type(Path("photo.png")) == "image"
    assert classify_media_type(Path("clip.mp4")) == "video"
    assert classify_media_type(Path("track.wav")) == "audio"
    assert classify_media_type(Path("notes.txt")) == "text"
    assert classify_media_type(Path("data.bin")) == "unknown"

def test_empty_fallbacks():
    img = empty_image_tensor(64, 64)
    assert img.shape == (1, 64, 64, 3)
    assert img.dtype == torch.float32

    mask = empty_mask_tensor(64, 64)
    assert mask.shape == (1, 64, 64)
    assert mask.dtype == torch.float32

    audio = empty_audio_dict(44100)
    assert "waveform" in audio
    assert "sample_rate" in audio
    assert audio["sample_rate"] == 44100

def test_load_image(tmp_path):
    img_path = tmp_path / "test.png"
    im = Image.new("RGBA", (100, 200), color=(255, 0, 0, 128))
    im.save(img_path)

    tensor_img, tensor_mask, w, h = load_image(str(img_path), longest_size=0)
    assert tensor_img.shape == (1, 200, 100, 3)
    assert tensor_mask.shape == (1, 200, 100)
    assert w == 100
    assert h == 200

    # Test longest_size downscaling
    resized_img, resized_mask, rw, rh = load_image(str(img_path), longest_size=100)
    assert rh == 100
    assert rw == 50
    assert resized_img.shape == (1, 100, 50, 3)

def test_resolve_file_path(tmp_path):
    from vf_file_nodes.media_utils import resolve_file_path

    # 1. Empty path
    assert resolve_file_path("") == ""

    # 2. Existing regular file
    img_file = tmp_path / "test.png"
    img_file.write_bytes(b"png data")
    assert resolve_file_path(str(img_file)) == str(img_file)

    # 3. Non-existent unannotated path returns as-is
    assert resolve_file_path("nonexistent.png") == "nonexistent.png"
