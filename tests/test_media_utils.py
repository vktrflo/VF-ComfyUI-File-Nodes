import torch
from pathlib import Path
from PIL import Image
from vf_file_nodes.media_utils import (
    classify_media_type,
    load_image,
    empty_image_tensor,
    empty_mask_tensor,
    empty_audio_dict,
)

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
