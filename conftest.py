import sys
from pathlib import Path

# Add project root and vf_file_nodes to sys.path
root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
