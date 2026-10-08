"""Deployment script to copy VF-ComfyUI-File-Nodes to local ComfyUI custom_nodes."""

import os
import shutil
import sys
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent.parent
TARGET_DIR = Path(r"E:\comfyui_instances\SMALL_DESKTOP\ComfyUI\custom_nodes\VF-ComfyUI-File-Nodes")

IGNORE_PATTERNS = shutil.ignore_patterns(
    ".git", ".pytest_cache", ".venv", "__pycache__", "*.pyc", "*.egg-info", "uv.lock", "tests", "tools"
)

def deploy() -> None:
    print(f"Deploying VF-ComfyUI-File-Nodes...")
    print(f"  Source: {SOURCE_DIR}")
    print(f"  Target: {TARGET_DIR}")

    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    for item in SOURCE_DIR.iterdir():
        if item.name in (".git", ".pytest_cache", ".venv", "__pycache__", "tests", "tools", "uv.lock") or item.name.endswith(".egg-info"):
            continue
        dest = TARGET_DIR / item.name
        if item.is_dir():
            shutil.copytree(item, dest, ignore=IGNORE_PATTERNS)
        else:
            shutil.copy2(item, dest)

    print("Deployment completed successfully.")

if __name__ == "__main__":
    deploy()
