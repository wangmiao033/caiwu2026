from pathlib import Path
import sys

# Ensure backend root is importable on Vercel runtime.
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app import app  # noqa: E402,F401
