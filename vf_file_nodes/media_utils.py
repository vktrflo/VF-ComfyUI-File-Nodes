"""Media processing and decoding utilities for image, video, audio, and text."""

from __future__ import annotations

import json
import math
import os
from fractions import Fraction
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from contextlib import nullcontext
from PIL import Image, ImageOps

try:
    import av
except ImportError:
    av = None

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

try:
    import comfy.utils
    ProgressBar = comfy.utils.ProgressBar
except (ImportError, AttributeError):
    ProgressBar = None

try:
    import comfy.model_management
    throw_exception_if_processing_interrupted = (
        comfy.model_management.throw_exception_if_processing_interrupted
    )
except (ImportError, AttributeError):
    throw_exception_if_processing_interrupted = None

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


def resolve_file_path(path: str | Path) -> str:
    """Resolve a file path, supporting ComfyUI annotated paths (e.g. clipspace files)."""
    path_str = str(path or "").strip()
    if not path_str:
        return ""
    if os.path.isfile(path_str):
        return path_str

    try:
        import folder_paths
        if folder_paths is not None:
            # 1. Direct annotated filepath resolution
            try:
                annotated = folder_paths.get_annotated_filepath(path_str)
                if os.path.isfile(annotated):
                    return annotated
            except Exception:
                pass

            # 2. Check input/clipspace or input directory for clipspace masks
            clean_name = path_str
            for tag in ("[input]", "[output]", "[temp]"):
                clean_name = clean_name.replace(tag, "").strip()

            input_dir = folder_paths.get_input_directory()
            if input_dir:
                candidates = [
                    os.path.join(input_dir, clean_name),
                    os.path.join(input_dir, "clipspace", os.path.basename(clean_name)),
                ]
                for cand in candidates:
                    if os.path.isfile(cand):
                        return cand
    except Exception:
        pass

    return path_str


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

        filename = Path(video_path).name
        pbar_ui = ProgressBar(num_frames) if ProgressBar is not None else None
        pbar_console = (
            tqdm(total=num_frames, desc=f"VF Load Video ({filename})", unit="frames", leave=True)
            if tqdm is not None
            else None
        )
        console_ctx = pbar_console if pbar_console is not None else nullcontext()

        frames = []
        try:
            with console_ctx:
                for frame in container.decode(stream):
                    if throw_exception_if_processing_interrupted is not None:
                        throw_exception_if_processing_interrupted()

                    curr_time = float(frame.pts * time_base) if frame.pts is not None else (len(frames) / video_fps)
                    if curr_time < (start_time - 0.05):
                        continue

                    rgb = frame.to_ndarray(format="rgb24")
                    frames.append(rgb)

                    if pbar_console is not None:
                        pbar_console.update(1)
                    if pbar_ui is not None:
                        pbar_ui.update(1)

                    if len(frames) >= num_frames:
                        break
        finally:
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
                # SaveVideo uses 4:2:0 encoding, which requires even dimensions.
                # Pad only VIDEO components; keep the image outputs and crop exact.
                video_frames = tensor_frames
                if final_w % 2 or final_h % 2:
                    video_frames = F.pad(
                        tensor_frames.permute(0, 3, 1, 2),
                        (0, final_w % 2, 0, final_h % 2),
                        mode="replicate",
                    ).permute(0, 2, 3, 1).contiguous()
                video_out = InputImpl.VideoFromComponents(
                    Types.VideoComponents(
                        images=video_frames,
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


def extract_comfy_parameters(file_path: str | Path) -> dict[str, Any]:
    """Extract embedded ComfyUI parameters, prompt, and workflow from an image or video."""
    p = Path(file_path)
    if not p.is_file():
        return {"has_parameters": False, "error": "File not found"}

    prompt_data: dict[str, Any] | None = None
    workflow_data: dict[str, Any] | None = None

    suffix = p.suffix.lower()
    try:
        if suffix in {".png", ".webp", ".jpg", ".jpeg", ".tiff"}:
            with Image.open(str(p)) as img:
                info = getattr(img, "info", {}) or {}
                if "prompt" in info:
                    raw = info["prompt"]
                    prompt_data = json.loads(raw) if isinstance(raw, str) else raw
                if "workflow" in info:
                    raw = info["workflow"]
                    workflow_data = json.loads(raw) if isinstance(raw, str) else raw
                if prompt_data is None and workflow_data is None and hasattr(img, "getexif"):
                    exif = img.getexif()
                    if exif:
                        for tag_id in (0x9286, 0x010E):  # UserComment, ImageDescription
                            val = exif.get(tag_id)
                            if isinstance(val, (bytes, str)):
                                try:
                                    s = val.decode("utf-8", errors="ignore") if isinstance(val, bytes) else val
                                    if s.startswith("UNICODE"):
                                        s = s[7:].strip("\x00")
                                    parsed = json.loads(s)
                                    if isinstance(parsed, dict):
                                        if "nodes" in parsed or "extra" in parsed:
                                            workflow_data = parsed
                                        if "prompt" in parsed:
                                            prompt_data = parsed["prompt"]
                                        if "workflow" in parsed:
                                            workflow_data = parsed["workflow"]
                                except Exception:
                                    pass
        elif suffix in {".mp4", ".webm", ".mkv", ".mov"}:
            if av is not None:
                with av.open(str(p)) as container:
                    meta = getattr(container, "metadata", {}) or {}
                    if "prompt" in meta:
                        raw = meta["prompt"]
                        prompt_data = json.loads(raw) if isinstance(raw, str) else raw
                    if "workflow" in meta:
                        raw = meta["workflow"]
                        workflow_data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return {"has_parameters": False}

    if not prompt_data and not workflow_data:
        return {"has_parameters": False}

    def resolve_val(v: Any, visited: set[str] | None = None) -> Any:
        if visited is None:
            visited = set()
        if prompt_data and isinstance(v, list) and len(v) == 2 and str(v[0]) in prompt_data:
            nid = str(v[0])
            if nid in visited:
                return None
            visited.add(nid)
            ref_node = prompt_data[nid]
            ref_inputs = ref_node.get("inputs", {}) if isinstance(ref_node, dict) else {}
            ct = ref_node.get("class_type", "") if isinstance(ref_node, dict) else ""
            if "Primitive" in ct and "value" in ref_inputs:
                return resolve_val(ref_inputs["value"], visited)
            for k in ("noise_seed", "seed", "sampler_name", "scheduler", "steps", "cfg", "text", "value"):
                if k in ref_inputs:
                    return resolve_val(ref_inputs[k], visited)
        return v

    def extract_prompt_text(cond_ref: Any, is_negative: bool = False, visited: set[tuple[str, Any]] | None = None) -> str | None:
        if visited is None:
            visited = set()
        if isinstance(cond_ref, str):
            return cond_ref
        if not prompt_data or not isinstance(cond_ref, list) or len(cond_ref) != 2:
            return None
        nid, slot = str(cond_ref[0]), cond_ref[1]
        if (nid, slot) in visited or nid not in prompt_data:
            return None
        visited.add((nid, slot))
        node = prompt_data[nid]
        if not isinstance(node, dict):
            return None
        inp = node.get("inputs", {})
        ct = node.get("class_type", "")

        if ct in ("PrimitiveString", "PrimitiveStringMultiline") and "value" in inp:
            v = inp["value"]
            return extract_prompt_text(v, is_negative, visited) if isinstance(v, list) else str(v)
        if ct == "CLIPTextEncode" and "text" in inp:
            v = inp["text"]
            return extract_prompt_text(v, is_negative, visited) if isinstance(v, list) else str(v)
        if ct == "PixaromaPrompt" and "PromptState" in inp:
            try:
                ps = json.loads(inp["PromptState"])
                if isinstance(ps, dict) and "text" in ps:
                    return str(ps["text"])
            except Exception:
                pass
        if "text" in inp and isinstance(inp["text"], str):
            return inp["text"]

        keys = ["negative", "conditioning"] if is_negative else ["positive", "prompt", "conditioning"]
        for k in keys:
            if k in inp:
                res = extract_prompt_text(inp[k], is_negative, visited)
                if res:
                    return res
        return None

    seed: Any = None
    steps: Any = None
    cfg: Any = None
    sampler: Any = None
    scheduler: Any = None
    denoise: Any = None
    positive_prompt: str | None = None
    negative_prompt: str | None = None
    models: list[str] = []
    loras: list[dict[str, Any]] = []

    if prompt_data and isinstance(prompt_data, dict):
        for nid, node in prompt_data.items():
            if not isinstance(node, dict):
                continue
            ct = node.get("class_type", "")
            inp = node.get("inputs", {})
            if not isinstance(inp, dict):
                continue

            # Sampler nodes
            if "Sampler" in ct:
                if "seed" in inp and seed is None:
                    seed = resolve_val(inp["seed"])
                if "noise_seed" in inp and seed is None:
                    seed = resolve_val(inp["noise_seed"])
                if "noise" in inp and seed is None:
                    seed = resolve_val(inp["noise"])
                if "steps" in inp and steps is None:
                    steps = resolve_val(inp["steps"])
                if "cfg" in inp and cfg is None:
                    cfg = resolve_val(inp["cfg"])
                if "sampler_name" in inp and sampler is None:
                    sampler = resolve_val(inp["sampler_name"])
                if "sampler" in inp and sampler is None:
                    sampler = resolve_val(inp["sampler"])
                if "scheduler" in inp and scheduler is None:
                    scheduler = resolve_val(inp["scheduler"])
                if "denoise" in inp and denoise is None:
                    denoise = resolve_val(inp["denoise"])

                # sigmas link -> scheduler node
                if "sigmas" in inp and isinstance(inp["sigmas"], list) and str(inp["sigmas"][0]) in prompt_data:
                    sn = prompt_data[str(inp["sigmas"][0])]
                    if isinstance(sn, dict):
                        sinp = sn.get("inputs", {})
                        if "scheduler" in sinp and scheduler is None:
                            scheduler = resolve_val(sinp["scheduler"])
                        if "steps" in sinp and steps is None:
                            steps = resolve_val(sinp["steps"])
                        if "denoise" in sinp and denoise is None:
                            denoise = resolve_val(sinp["denoise"])

                # guider link -> CFGGuider / BasicGuider
                if "guider" in inp and isinstance(inp["guider"], list) and str(inp["guider"][0]) in prompt_data:
                    gn = prompt_data[str(inp["guider"][0])]
                    if isinstance(gn, dict):
                        ginp = gn.get("inputs", {})
                        if "cfg" in ginp and cfg is None:
                            cfg = resolve_val(ginp["cfg"])
                        if "positive" in ginp and positive_prompt is None:
                            positive_prompt = extract_prompt_text(ginp["positive"], is_negative=False)
                        elif "conditioning" in ginp and positive_prompt is None:
                            positive_prompt = extract_prompt_text(ginp["conditioning"], is_negative=False)
                        if "negative" in ginp and negative_prompt is None:
                            negative_prompt = extract_prompt_text(ginp["negative"], is_negative=True)

                # direct positive/negative conditioning links
                if "positive" in inp and positive_prompt is None:
                    positive_prompt = extract_prompt_text(inp["positive"], is_negative=False)
                if "negative" in inp and negative_prompt is None:
                    negative_prompt = extract_prompt_text(inp["negative"], is_negative=True)

            # Model loaders
            for mkey in ("ckpt_name", "unet_name", "model_name"):
                if mkey in inp and isinstance(inp[mkey], str) and inp[mkey] not in models:
                    models.append(inp[mkey])

            # LoRAs
            if "lora_name" in inp and isinstance(inp["lora_name"], str):
                st = inp.get("strength_model", 1.0)
                loras.append({"name": inp["lora_name"], "strength": st})
            if "lora_stack_data" in inp:
                lsd = inp["lora_stack_data"]
                if isinstance(lsd, str):
                    try:
                        lsd = json.loads(lsd)
                    except Exception:
                        pass
                if isinstance(lsd, list):
                    for item in lsd:
                        if isinstance(item, dict) and "lora_name" in item:
                            loras.append({"name": item.get("lora_name"), "strength": item.get("strength_model", 1.0)})

        # Fallback for positive/negative prompt if not linked to a sampler
        if positive_prompt is None:
            for nid, node in prompt_data.items():
                if not isinstance(node, dict):
                    continue
                ct = node.get("class_type", "")
                inp = node.get("inputs", {})
                if ct == "CLIPTextEncode" and "text" in inp and isinstance(inp["text"], str):
                    t = inp["text"].strip()
                    if t and positive_prompt is None:
                        positive_prompt = t
                elif ct == "PixaromaPrompt" and "PromptState" in inp:
                    try:
                        ps = json.loads(inp["PromptState"])
                        if isinstance(ps, dict) and "text" in ps and positive_prompt is None:
                            positive_prompt = str(ps["text"])
                    except Exception:
                        pass

    return {
        "has_parameters": True,
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler": sampler,
        "scheduler": scheduler,
        "denoise": denoise,
        "models": models,
        "loras": loras,
        "has_workflow": workflow_data is not None,
        "workflow": workflow_data,
        "prompt": prompt_data,
    }

