#!/usr/bin/env python3
"""Require an initialized private workspace before reading or creating run data."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
if any((parent / '.git').exists() for parent in (ROOT, *ROOT.parents)):
    raise RuntimeError('Analysis must run outside Git checkouts; use init_workspace.py')
config_path = ROOT / 'workspace.json'
if not config_path.is_file():
    raise RuntimeError('Missing workspace.json; use init_workspace.py to create a private workspace')
CONFIG = json.loads(config_path.read_text())
SAMPLE = CONFIG.get('sample_id', '')
if CONFIG.get('schema_version') != 1 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', SAMPLE):
    raise ValueError('Invalid private workspace configuration')
