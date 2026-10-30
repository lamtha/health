"""Require private initialized state and immutable comparison settings."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
if any((p / ".git").exists() for p in (ROOT, *ROOT.parents)):
    raise RuntimeError("Follow-up analysis must run outside Git checkouts")
sys.path.insert(0, str(ROOT / "results/scripts"))
from workspace_config import SAMPLE

OUT = ROOT / "results/followup"
CONFIG = json.loads((ROOT / "followup.json").read_text())
expected = (OUT / "versions/followup_config.sha256").read_text().strip()
if hashlib.sha256((ROOT / "followup.json").read_bytes()).hexdigest() != expected:
    raise RuntimeError("Follow-up settings changed; initialize a fresh workspace")
if (
    hashlib.sha256((OUT / "control_manifest.tsv").read_bytes()).hexdigest()
    != CONFIG["controls_sha256"]
):
    raise RuntimeError(
        "Preselected control manifest changed; initialize a fresh workspace"
    )

if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--value":
        print(CONFIG[sys.argv[2]])
    elif len(sys.argv) == 3 and sys.argv[1] == "--run":
        if sys.argv[2] != "sample_local" and not re.fullmatch(
            r"(?:SRR|ERR|DRR)\d+", sys.argv[2]
        ):
            raise ValueError("Invalid sample/run label")
        import csv

        allowed = {"sample_local"} | {
            r["run_accession"]
            for r in csv.DictReader(
                (OUT / "control_manifest.tsv").open(), delimiter="\t"
            )
        }
        if sys.argv[2] not in allowed:
            raise ValueError("Run was not preselected")
