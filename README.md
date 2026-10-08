# 🌀 VF ComfyUI File Nodes

A dedicated, high-performance file management and media loading suite for ComfyUI.

## Features

- **🌀 VF File Explorer (`VFFileExplorer`):** An embedded canvas file manager for browsing drives (including Windows mapped SMB/NAS shares), searching, filtering, double-click previewing, and selecting media files. Outputs a safe `media` bundle and file path.
- **🌀 VF Unpack Media (`VFUnpackMedia`):** An intelligent, crash-resilient media unpacker that converts explorer selections into tensors and metadata. Provides safe fallback tensors to avoid downstream noodle breaks.
- **🌀 VF Load Image (`VFLoadImage`):** Dedicated image loader with "Browse Files" picker modal, `longest_size` downscaling, and on-node thumbnail preview with resolution badge.
- **🌀 VF Load Video (`VFLoadVideo`):** Dedicated video segment loader powered by PyAV with "Browse Files" picker modal and an interactive video scrubber with timeline scrubbing and visual crop bounding box.
- **🌀 VF Load Audio (`VFLoadAudio`):** Dedicated audio loader with "Browse Files" picker modal, start-time & duration trimming, and an on-node audio player preview.
- **Optional Canvas Drag & Drop:** Seamlessly drag files from the file explorer onto the canvas to spawn pre-configured loader nodes. Configurable in ComfyUI Settings (disabled by default).

## Installation

Clone or copy this repository into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/vktrflo/VF-ComfyUI-File-Nodes.git
```

## Requirements

- Python >= 3.10
- PyTorch
- NumPy
- Pillow
- PyAV (`av >= 10.0.0`)
