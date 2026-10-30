"""Record executable versions and public references; archive no sample sequences."""
from bile_sulphur_config import ROOT, CONFIG
import csv, gzip, hashlib, json, platform, subprocess, sys
from pathlib import Path
from Bio import __version__ as biopython
import numpy, pysam

O = Path("results/bile_sulphur/versions")
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
paths = [
    Path("analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.pkl"),
    Path(
        "analysis/databases/humann/chocophlan/g__Bacteroides.s__Bacteroides_thetaiotaomicron.centroids.v201901_v31.ffn.gz"
    ),
    Path("analysis/references/bilophila_complete_assembly.gb"),
] + [
    Path("analysis/bile_sulphur/references") / name
    for name in ["curated_panel.fna", "curated_panel.faa", "mapping_panel.fna"]
]
checks = []
for p in paths:
    sha = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            sha.update(chunk)
    checks.append(dict(path=str(p), bytes=p.stat().st_size, sha256=sha.hexdigest()))
json.dump(checks, open(O / "database_checksums.json", "w"), indent=2)
for name in ["mapping_panel.fna", "curated_panel.fna", "curated_panel.faa"]:
    with open(
        Path("analysis/bile_sulphur/references") / name, "rb"
    ) as source, gzip.GzipFile(
        str(Path("results/bile_sulphur/references") / (name + ".gz")), "wb", mtime=0
    ) as out:
        out.write(source.read())
assets = [
    dict(path=str(p), sha256=hashlib.sha256(p.read_bytes()).hexdigest())
    for p in sorted(Path("results/bile_sulphur/scripts").glob("*"))
    if p.is_file()
]
json.dump(assets, open(O / "analysis_scripts_sha256.json", "w"), indent=2)
print("Versions and public reference hashes recorded", flush=True)
