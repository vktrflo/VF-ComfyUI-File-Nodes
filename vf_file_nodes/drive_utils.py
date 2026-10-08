"""Utilities for discovering local drives and mapped network shares."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any


def _get_windows_drives() -> list[dict[str, str]]:
    drives: list[dict[str, str]] = []
    seen: set[str] = set()

    # 1. Enumerate mapped network drives from Windows Registry
    try:
        import winreg

        net_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Network")
        idx = 0
        while True:
            try:
                subkey_name = winreg.EnumKey(net_key, idx)
                idx += 1
                try:
                    conn_key = winreg.OpenKey(net_key, subkey_name)
                    remote_path, _ = winreg.QueryValueEx(conn_key, "RemotePath")
                    winreg.CloseKey(conn_key)
                    letter = f"{subkey_name}:"
                    drive_path = f"{letter}\\"
                    drives.append({
                        "name": f"{letter} ({remote_path})",
                        "path": drive_path,
                        "type": "network",
                    })
                    seen.add(letter.upper())
                except Exception:
                    continue
            except OSError:
                break
        winreg.CloseKey(net_key)
    except Exception:
        pass

    # 2. Enumerate logical drives via ctypes kernel32
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        bitmask = kernel32.GetLogicalDrives()
        for i in range(26):
            if bitmask & (1 << i):
                letter = f"{chr(65 + i)}:"
                if letter.upper() in seen:
                    continue
                drive_path = f"{letter}\\"
                # DRIVE_FIXED=3, DRIVE_REMOVABLE=2, DRIVE_REMOTE=4, DRIVE_CDROM=5, DRIVE_RAMDISK=6
                dtype = kernel32.GetDriveTypeW(drive_path)
                drive_type_str = "network" if dtype == 4 else "local"
                drives.append({
                    "name": letter,
                    "path": drive_path,
                    "type": drive_type_str,
                })
                seen.add(letter.upper())
    except Exception:
        # Fallback drive sweep
        for i in range(26):
            letter = f"{chr(65 + i)}:"
            if letter.upper() not in seen and os.path.exists(f"{letter}\\"):
                drives.append({
                    "name": letter,
                    "path": f"{letter}\\",
                    "type": "local",
                })
                seen.add(letter.upper())

    drives.sort(key=lambda d: d["path"])
    return drives


def _get_posix_mounts() -> list[dict[str, str]]:
    drives: list[dict[str, str]] = [{"name": "/", "path": "/", "type": "local"}]
    # Check /Volumes (macOS) or /mnt, /media (Linux)
    for mount_dir in ("/Volumes", "/mnt", "/media"):
        p = Path(mount_dir)
        if p.is_dir():
            try:
                for entry in p.iterdir():
                    if entry.is_dir():
                        drives.append({
                            "name": entry.name,
                            "path": str(entry),
                            "type": "mount",
                        })
            except PermissionError:
                pass
    return drives


def get_available_drives() -> list[dict[str, str]]:
    """Return a list of accessible drive roots with name, path, and type."""
    if sys.platform == "win32":
        return _get_windows_drives()
    return _get_posix_mounts()
