"""GET pinned public source/tool archives; never reads sample data."""
import argparse
import hashlib
import json
import shutil
import urllib.request
from common import OUT, REF

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("archive")
parser.add_argument("--verify-only", action="store_true")
args = parser.parse_args()
pins = json.loads((OUT / "references/tool_sources.json").read_text())
pin = pins[args.archive]
path = REF / args.archive
if not path.exists() and not args.verify_only:
    partial = path.with_suffix(path.suffix + ".partial")
    with urllib.request.urlopen(pin["url"], timeout=180) as response, partial.open(
        "wb"
    ) as stream:
        shutil.copyfileobj(response, stream)
    if (
        partial.stat().st_size != pin["bytes"]
        or hashlib.file_digest(partial.open("rb"), "sha256").hexdigest()
        != pin["sha256"]
    ):
        raise ValueError("Public archive does not match pinned size/hash")
    partial.rename(path)
if (
    path.stat().st_size != pin["bytes"]
    or hashlib.file_digest(path.open("rb"), "sha256").hexdigest() != pin["sha256"]
):
    raise ValueError("Public archive does not match pinned size/hash")
print("Verified public archive:", path.name)
