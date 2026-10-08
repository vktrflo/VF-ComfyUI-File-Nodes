import sys
from pathlib import Path
from vf_file_nodes.drive_utils import get_available_drives

def test_get_available_drives_returns_list():
    drives = get_available_drives()
    assert isinstance(drives, list)
    assert len(drives) > 0
    first = drives[0]
    assert "name" in first
    assert "path" in first
    assert "type" in first
