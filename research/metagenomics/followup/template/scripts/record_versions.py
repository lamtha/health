"""Record actual local tool versions and public panel hashes, without reading inputs."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from common import ROOT, OUT, REF

os.environ["PATH"] = os.pathsep.join(
    [
        str(ROOT / "analysis/tools/megahit-native/build"),
        str(ROOT / "analysis/envs/metagenomics/bin"),
        str(ROOT / "analysis/envs/assembly/bin"),
        os.environ["PATH"],
    ]
)
commands = {
    "bowtie2": ["--version"],
    "samtools": ["--version"],
    "fastp": ["--version"],
    "seqkit": ["version"],
    "blastn": ["-version"],
    "minimap2": ["--version"],
    "mafft": ["--version"],
    "megahit": ["--version"],
    "diamond": ["version"],
    "kraken2": ["--version"],
}
versions = {}
for tool, args in commands.items():
    executable = shutil.which(tool)
    if executable is None:
        versions[tool] = {"status": "unavailable"}
        continue
    result = subprocess.run(
        [executable, *args], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    versions[tool] = {
        "exit_code": result.returncode,
        "version_output": result.stdout.strip(),
    }
versions["python_packages"] = subprocess.check_output(
    [sys.executable, "-m", "pip", "freeze"], text=True
).splitlines()
versions["public_panel_hashes"] = {
    p.name: hashlib.sha256(p.read_bytes()).hexdigest()
    for p in (
        REF / "panel_v2.fna",
        REF / "panel_v2.faa",
        REF / "reference_manifest_v2.tsv",
    )
}
(OUT / "versions/software.json").write_text(json.dumps(versions, indent=2) + "\n")
