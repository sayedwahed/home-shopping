"""Vercel serverless entrypoint for the Home Shopping Flask store.

Vercel's Python runtime executes this file as the /api/index function.
It imports the Flask ``app`` object from app.py at the repo root and
exposes it.

Path handling: this file lives in api/, so the repo root (the parent
directory) is inserted at the front of sys.path before importing
``app`` — that makes ``import app`` (and app.py's own ``import db`` /
``import geo``) resolve. Flask's template_folder and static_folder
still point at the repo-root templates/ and static/ directories,
because Flask derives root_path from app.py's own location, not from
this file. The normal local run (``python app.py``) is untouched.
"""

import os
import sys

# Repo root = parent of the api/ directory containing this file.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from app import app  # noqa: E402  (Flask app object, served by Vercel)
