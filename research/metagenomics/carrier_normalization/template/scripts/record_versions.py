from carrier_config import ROOT, CONFIG
import csv, gzip, hashlib, json, platform, subprocess, sys
from pathlib import Path
from Bio import __version__ as biopython
import numpy, pysam

O = Path("results/carrier_normalization/versions")
O.mkdir(exist_ok=True)
versions = dict(
    python=sys.version,
    platform=platform.platform(),
    biopython=biopython,
    numpy=numpy.__version__,
    pysam=pysam.__version__,
    tools={},
)
for tool, args in [
    ("analysis/envs/metagenomics/bin/bowtie2", ["--version"]),
    ("analysis/envs/metagenomics/bin/samtools", ["--version"]),
    ("analysis/envs/assembly/bin/blastn", ["-version"]),
    ("analysis/envs/assembly/bin/blastp", ["-version"]),
]:
    r = subprocess.run(
        [tool] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=True,
    )
    versions["tools"][Path(tool).name] = r.stdout
json.dump(versions, open(O / "software_versions.json", "w"), indent=2)
paths = (
    [Path("analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.pkl")]
    + [
        Path(
            f"analysis/databases/humann/chocophlan/g__Blautia.s__Ruminococcus_{s}.centroids.v201901_v31.ffn.gz"
        )
        for s in ["gnavus", "torques"]
    ]
    + [
        Path("results/followup/references/panel_v2.fna"),
        Path("results/followup/references/panel_v2.faa"),
        Path("analysis/carrier_normalization/references/mapping_panel.fna"),
    ]
)
checks = []
for p in paths:
    sha = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            sha.update(chunk)
    checks.append(dict(path=str(p), bytes=p.stat().st_size, sha256=sha.hexdigest()))
json.dump(checks, open(O / "database_checksums.json", "w"), indent=2)
# Public reference sequences only; never copy BAMs, reads or sample assemblies.
with open(
    "analysis/carrier_normalization/references/mapping_panel.fna", "rb"
) as f, gzip.GzipFile(
    "results/carrier_normalization/references/mapping_panel.fna.gz", "wb", mtime=0
) as out:
    out.write(f.read())
