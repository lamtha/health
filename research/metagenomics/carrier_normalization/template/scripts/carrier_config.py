"""Require private state, unchanged scripts/settings and the parent follow-up."""
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
if any((p / ".git").exists() for p in (ROOT, *ROOT.parents)):
    raise RuntimeError("Carrier analysis must run outside Git checkouts")
OUT = ROOT / "results/carrier_normalization"
path = ROOT / "carrier_normalization.json"
CONFIG = json.loads(path.read_text())
if (
    hashlib.sha256(path.read_bytes()).hexdigest()
    != (OUT / "versions/config.sha256").read_text().strip()
):
    raise RuntimeError("Carrier settings changed; initialize a fresh workspace")
if (
    hashlib.sha256((ROOT / "followup.json").read_bytes()).hexdigest()
    != CONFIG["parent_config_sha256"]
):
    raise RuntimeError("Parent settings changed; initialize a fresh workspace")
for asset in json.loads((OUT / "versions/workflow_assets.json").read_text()):
    if (
        hashlib.sha256((OUT / asset["path"]).read_bytes()).hexdigest()
        != asset["sha256"]
    ):
        raise RuntimeError("Installed workflow changed; initialize a fresh workspace")
sys.path.insert(0, str(ROOT / "results/followup/scripts"))
from followup_config import CONFIG as FOLLOWUP_CONFIG

os.chdir(ROOT)
