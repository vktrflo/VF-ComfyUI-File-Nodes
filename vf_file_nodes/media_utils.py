"""Media processing and decoding utilities for image, video, audio, and text."""

from __future__ import annotations

import os
import math
from fractions import Fraction
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps

try:
    import av
except ImportError:
    av = None

try:
    from comfy_api.latest import InputImpl, Types
    has_comfy_video_api = True
except Exception:
    InputImpl = None
    Types = None
    has_comfy_video_api = False


IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tga", ".exr"
}
VIDEO_EXTENSIONS = {
    ".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv", ".wmv"
}
AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".aiff", ".opus"
}
TEXT_EXTENSIONS = {
    ".txt", ".json", ".md", ".yaml", ".yml", ".csv", ".xml", ".html", ".css", ".js", ".py", ".toml"
}

MAX_TEXT_CHARS = 1_000_000


def classify_media_type(path: Path | str) -> str:
    """Classify file extension into image, video, audio, text, or unknown."""
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in AUDIO_EXTENSIONS:
        return "audio"
    if suffix in TEXT_EXTENSIONS:
        return "text"
    return "unknown"


def empty_image_tensor(w: int = 512, h: int = 512) -> torch.Tensor:
    """Return a black image tensor [1, H, W, 3]."""
    return torch.zeros((1, max(1, h), max(1, w), 3), dtype=torch.float32)


def empty_mask_tensor(w: int = 512, h: int = 512) -> torch.Tensor:
    """Return an empty mask tensor [1, H, W]."""
    return torch.zeros((1, max(1, h), max(1, w)), dtype=torch.float32)


def empty_audio_dict(sample_rate: int = 44100) -> dict[str, Any]:
    """Return a silent audio dict formatted for ComfyUI."""
    return {
        "waveform": torch.zeros((1, 2, 1), dtype=torch.float32),
        "sample_rate": sample_rate,
    }


def resize_tensor_by_longest_side(image: torch.Tensor, longest_side: int) -> torch.Tensor:
    """Resize image tensor [B, H, W, C] preserving aspect ratio."""
    if longest_side <= 0:
        return image
    _, h, w, _ = image.shape
    curr = max(h, w)
    if curr == longest_side or curr == 0:
        return image

    scale = longest_side / curr
    new_h = max(1, round(h * scale))
    new_w = max(1, round(w * scale))

    x = image.permute(0, 3, 1, 2)
    x = F.interpolate(x, size=(new_h, new_w), mode="bilinear", align_corners=False)
    return x.permute(0, 2, 3, 1)


def resize_mask_by_longest_side(mask: torch.Tensor, longest_side: int) -> torch.Tensor:
    """Resize mask tensor [B, H, W] preserving aspect ratio."""
    if longest_side <= 0:
        return mask
    _, h, w = mask.shape
    curr = max(h, w)
    if curr == longest_side or curr == 0:
        return mask

    scale = longest_side / curr
    new_h = max(1, round(h * scale))
    new_w = max(1, round(w * scale))

    x = mask.unsqueeze(1)
    x = F.interpolate(x, size=(new_h, new_w), mode="bilinear", align_corners=False)
    return x.squeeze(1)


def load_image(path: str, longest_size: int = 0) -> tuple[torch.Tensor, torch.Tensor, int, int]:
    """Load an image file and return (image_tensor, mask_tensor, width, height)."""
    if not path or not os.path.isfile(path):
        return empty_image_tensor(), empty_mask_tensor(), 512, 512

    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            orig_w, orig_h = img.size

            if img.mode == "RGBA":
                rgb = img.convert("RGB")
                alpha = img.split()[-1]
                mask_np = 1.0 - (np.array(alpha, dtype=np.float32) / 255.0)
            elif "A" in img.mode:
                rgba = img.convert("RGBA")
                rgb = rgba.convert("RGB")
                alpha = rgba.split()[-1]
                mask_np = 1.0 - (np.array(alpha, dtype=np.float32) / 255.0)
            else:
                rgb = img.convert("RGB")
                mask_np = np.zeros((orig_h, orig_w), dtype=np.float32)

            rgb_np = np.array(rgb, dtype=np.float32) / 255.0
            image_tensor = torch.from_numpy(rgb_np).unsqueeze(0)
            mask_tensor = torch.from_numpy(mask_np).unsqueeze(0)

            if longest_size > 0:
                image_tensor = resize_tensor_by_longest_side(image_tensor, longest_size)
                mask_tensor = resize_mask_by_longest_side(mask_tensor, longest_size)

            final_h = int(image_tensor.shape[1])
            final_w = int(image_tensor.shape[2])
            return image_tensor, mask_tensor, final_w, final_h
    except Exception as exc:
        print(f"[VF File Nodes] Failed to load image {path}: {exc}")
        return empty_image_tensor(), empty_mask_tensor(), 512, 512


def load_audio(path: str, start_time: float = 0.0, duration: float = 0.0) -> dict[str, Any]:
    """Load and optionally trim an audio file into ComfyUI AUDIO dict format."""
    if not path or not os.path.isfile(path) or av is None:
        return {**empty_audio_dict(), "duration": 0.0, "path": path}

    try:
        container = av.open(path)
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            container.close()
            return {**empty_audio_dict(), "duration": 0.0, "path": path}

        sample_rate = stream.codec_context.sample_rate or 44100
        channels = stream.codec_context.channels or 2

        # Fast seek if start_time > 0
        if start_time > 0 and stream.time_base:
            seek_pts = int(start_time / float(stream.time_base))
            container.seek(seek_pts, stream=stream, backward=True)

        frames = []
        collected_time = 0.0
        for frame in container.decode(stream):
            pts_time = float(frame.pts * stream.time_base) if frame.pts is not None and stream.time_base else collected_time
            if pts_time < (start_time - 0.05):
                continue
            arr = frame.to_ndarray()
            # Ensure float32 [-1.0, 1.0]
            if arr.dtype != np.float32:
                if np.issubdtype(arr.dtype, np.integer):
                    max_val = float(np.iinfo(arr.dtype).max)
                    arr = arr.astype(np.float32) / max_val
                else:
                    arr = arr.astype(np.float32)
            frames.append(arr)
            collected_time += float(frame.samples) / float(sample_rate)
            if duration > 0 and collected_time >= duration:
                break

        container.close()

        if not frames:
            return {**empty_audio_dict(sample_rate), "duration": 0.0, "path": path}

        audio_data = np.concatenate(frames, axis=-1)
        if audio_data.ndim == 1:
            audio_data = np.expand_dims(audio_data, 0)
        elif audio_data.ndim == 2 and audio_data.shape[0] > audio_data.shape[1]:
            audio_data = audio_data.T

        tensor = torch.from_numpy(audio_data).float().unsqueeze(0)
        actual_duration = float(tensor.shape[-1]) / float(sample_rate)
        return {
            "waveform": tensor,
            "sample_rate": sample_rate,
            "duration": actual_duration,
            "path": path,
        }
    except Exception as exc:
        print(f"[VF File Nodes] Audio load failed {path}: {exc}")
        return {**empty_audio_dict(), "duration": 0.0, "path": path}


def decode_video_segment(
    video_path: str,
    start_time: float = 0.0,
    segment_duration: float = 2.0,
    current_frame_offset: int = 0,
    playback_speed: float = 1.0,
    fps: float = 24.0,
    longest_side: int = 0,
    crop: tuple[int, int, int, int] = (0, 0, 0, 0),
) -> dict[str, Any]:
    """Decode a video segment using PyAV with crop and resize."""
    empty_res = {
        "image": empty_image_tensor(),
        "single_frame": empty_image_tensor(),
        "audio": empty_audio_dict(),
        "video": None,
        "frame_info": {
            "fps": fps,
            "total_frames": 0,
            "current_frame_idx": 0,
            "segment_start_frame": 0,
            "segment_end_frame": 0,
            "video_path": video_path or "",
            "width": 512,
            "height": 512,
        },
        "width": 512,
        "height": 512,
        "path": video_path or "",
    }

    if not video_path or not os.path.isfile(video_path) or av is None:
        return empty_res

    try:
        container = av.open(video_path)
        stream = next((s for s in container.streams if s.type == "video"), None)
        if stream is None:
            container.close()
            return empty_res

        video_fps = float(stream.average_rate) if stream.average_rate else (fps or 24.0)
        time_base = float(stream.time_base) if stream.time_base else 1 / 1000.0
        total_frames = stream.frames if stream.frames > 0 else 0

        start_frame = max(0, int(round(start_time * video_fps)))
        num_frames = max(1, int(round(segment_duration * video_fps)))
        target_offset = min(max(0, current_frame_offset), num_frames - 1)

        if start_time > 0 and time_base:
            seek_pts = int(start_time / time_base)
            container.seek(seek_pts, stream=stream, backward=True)

        frames = []
        for frame in container.decode(stream):
            curr_time = float(frame.pts * time_base) if frame.pts is not None else (len(frames) / video_fps)
            if curr_time < (start_time - 0.05):
                continue

            rgb = frame.to_ndarray(format="rgb24")
            frames.append(rgb)
            if len(frames) >= num_frames:
                break

        container.close()

        if not frames:
            return empty_res

        tensor_frames = torch.from_numpy(np.stack(frames)).float() / 255.0

        # Apply crop if valid
        crop_x, crop_y, crop_w, crop_h = crop
        _, orig_h, orig_w, _ = tensor_frames.shape
        if crop_w > 0 and crop_h > 0:
            cx = max(0, min(crop_x, orig_w - 1))
            cy = max(0, min(crop_y, orig_h - 1))
            cw = min(crop_w, orig_w - cx)
            ch = min(crop_h, orig_h - cy)
            tensor_frames = tensor_frames[:, cy : cy + ch, cx : cx + cw, :]

        # Apply longest_side downscale
        if longest_side > 0:
            tensor_frames = resize_tensor_by_longest_side(tensor_frames, longest_side)

        final_h = int(tensor_frames.shape[1])
        final_w = int(tensor_frames.shape[2])

        single_idx = min(target_offset, len(tensor_frames) - 1)
        single_frame = tensor_frames[single_idx : single_idx + 1]

        # Extract audio segment
        audio_info = load_audio(video_path, start_time=start_time, duration=segment_duration)
        audio_dict = {"waveform": audio_info["waveform"], "sample_rate": audio_info["sample_rate"]}

        # ComfyUI video type if supported
        video_out = None
        if has_comfy_video_api and InputImpl is not None and Types is not None:
            try:
                video_out = InputImpl.VideoFromComponents(
                    Types.VideoComponents(
                        images=tensor_frames,
                        audio=audio_dict,
                        frame_rate=Fraction(int(round(video_fps * 1000)), 1000),
                    ),
                    bit_depth=8,
                )
            except Exception:
                video_out = None

        return {
            "image": tensor_frames,
            "single_frame": single_frame,
            "audio": audio_dict,
            "video": video_out,
            "frame_info": {
                "fps": video_fps,
                "total_frames": total_frames,
                "current_frame_idx": single_idx,
                "segment_start_frame": start_frame,
                "segment_end_frame": start_frame + len(tensor_frames),
                "video_path": video_path,
                "width": final_w,
                "height": final_h,
            },
            "width": final_w,
            "height": final_h,
            "path": video_path,
        }
    except Exception as exc:
        print(f"[VF File Nodes] Video decode error {video_path}: {exc}")
        return empty_res
