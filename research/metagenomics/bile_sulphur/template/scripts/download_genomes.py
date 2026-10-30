"""Download only preselected public reference genomes; verify upstream MD5."""
from bile_sulphur_config import ROOT, CONFIG
import csv, concurrent.futures, hashlib, json, time, urllib.request
from pathlib import Path

D = Path("analysis/bile_sulphur/references/genomes")
D.mkdir(exist_ok=True)
rows = list(
    csv.DictReader(
        open("results/bile_sulphur/references/genome_panel.tsv"), delimiter="\t"
    )
)


def get(url, path):
    if path.exists():
        return path.read_bytes()
    for attempt in range(5):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "local-research-reference-download/1.0"}
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
            path.write_bytes(b)
            return b
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2**attempt)


def one(row):
    ac = row["accession"]
    folder = D / ac
    folder.mkdir(exist_ok=True)
    base = row["base_url"]
    stem = row["stem"]
    md5 = get(base + "/md5checksums.txt", folder / "md5checksums.txt").decode()
    sums = {
        line.split()[1].removeprefix("./"): line.split()[0] for line in md5.splitlines()
    }
    out = []
    for suffix in ["_genomic.fna.gz", "_cds_from_genomic.fna.gz", "_protein.faa.gz"]:
        filename = stem + suffix
        b = get(base + "/" + filename, folder / filename)
        assert hashlib.md5(b).hexdigest() == sums[filename], filename
        out.append(
            dict(
                accession=ac,
                url=base + "/" + filename,
                bytes=len(b),
                md5=sums[filename],
                sha256=hashlib.sha256(b).hexdigest(),
            )
        )
    print(ac, "verified", flush=True)
    return out


allrows = []
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(one, rows):
        allrows += result
json.dump(
    allrows,
    open("results/bile_sulphur/references/download_checksums.json", "w"),
    indent=2,
)
