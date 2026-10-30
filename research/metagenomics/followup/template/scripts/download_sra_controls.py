"""Alternative public SRA transport with full quality scores, never SRA Lite.

Uses the same selected run IDs. Integrity is checked against NCBI's run MD5;
FASTQ headers/gzip containers differ from ENA so ENA compressed MD5s do not apply.
"""
import concurrent.futures, csv, gzip, hashlib, json, shutil, subprocess, urllib.request
from pathlib import Path
from common import ROOT, OUT, REF, CONFIG

base = ROOT / "analysis/followup/controls"
import os

tool = Path(
    os.environ.get(
        "SRA_TOOLKIT_BIN", str(ROOT / "analysis/tools/sratoolkit.3.4.1-mac-arm64/bin")
    )
)
version = subprocess.check_output(
    [str(tool / "fasterq-dump"), "--version"], text=True
).strip()
rows = list(csv.DictReader((OUT / "control_manifest.tsv").open(), delimiter="\t"))


def fetch(row):
    run = row["run_accession"]
    d = base / run
    d.mkdir(exist_ok=True)
    if (d / "DOWNLOAD_COMPLETE").exists():
        return run + " already verified"
    (d / "DOWNLOAD_FAILED").unlink(missing_ok=True)
    try:
        meta = REF / (run + "_sdl.json")
        if not meta.exists():
            meta.write_bytes(
                urllib.request.urlopen(
                    "https://locate.ncbi.nlm.nih.gov/sdl/2/retrieve?acc=" + run,
                    timeout=90,
                ).read()
            )
        data = json.loads(meta.read_text())
        entry = next(f for f in data["result"][0]["files"] if f["type"] == "sra")
        url = next(x["link"] for x in entry["locations"] if x["service"] == "s3")
        assert url.startswith(
            "https://sra-pub-run-odp.s3.amazonaws.com/sra/"
        ) and url.endswith("/" + run)
        transport_urls = [url]
        archive = d / (run + ".sra")
        tmp = d / (run + ".sra.partial")
        if not archive.exists():
            with (d / "sra_download.log").open("a") as log:
                subprocess.run(
                    [
                        str(ROOT / "analysis/envs/downloads/bin/aria2c"),
                        "--continue=true",
                        "--auto-file-renaming=false",
                        "--file-allocation=none",
                        "--max-connection-per-server=16",
                        "--split=16",
                        "--min-split-size=4M",
                        "--max-tries=8",
                        "--retry-wait=3",
                        "--connect-timeout=30",
                        "--timeout=90",
                        "--summary-interval=30",
                        "--console-log-level=warn",
                        "--dir=" + str(d),
                        "--out=" + tmp.name,
                        *transport_urls,
                    ],
                    stdout=log,
                    stderr=log,
                    check=True,
                )
            assert tmp.stat().st_size == entry["size"]
            assert (
                hashlib.file_digest(tmp.open("rb"), "md5").hexdigest() == entry["md5"]
            )
            tmp.rename(archive)
        assert (
            archive.stat().st_size == entry["size"]
            and hashlib.file_digest(archive.open("rb"), "md5").hexdigest()
            == entry["md5"]
        )
        with (d / "fasterq.log").open("w") as log:
            subprocess.run(
                [str(tool / "vdb-validate"), str(archive)],
                stdout=log,
                stderr=log,
                check=True,
            )
            subprocess.run(
                [
                    str(tool / "fasterq-dump"),
                    str(archive),
                    "--split-files",
                    "--threads",
                    "3",
                    "--outdir",
                    str(d),
                    "--temp",
                    str(d / "sra_temp"),
                    "--force",
                ],
                stdout=log,
                stderr=log,
                check=True,
            )
        records = []
        for mate in [1, 2]:
            plain = d / f"{run}_{mate}.fastq"
            dest = d / f"raw_{mate}.fastq.gz"
            assert plain.exists() and plain.stat().st_size > 0
            with plain.open("rb") as src, gzip.open(
                str(dest) + ".sra_partial", "wb", compresslevel=2
            ) as dst:
                shutil.copyfileobj(src, dst, 8 * 1024 * 1024)
            (d / (dest.name + ".sra_partial")).rename(dest)
            records.append(
                dict(
                    mate=mate,
                    bytes=dest.stat().st_size,
                    sha256=hashlib.file_digest(dest.open("rb"), "sha256").hexdigest(),
                )
            )
            plain.unlink()
        (d / "download_verified.json").write_text(
            json.dumps(
                dict(
                    source=url,
                    transport_urls=transport_urls,
                    sra_format="normalized full base qualities; not SRA Lite",
                    sra_md5=entry["md5"],
                    sra_bytes=entry["size"],
                    sra_sha256=hashlib.file_digest(
                        archive.open("rb"), "sha256"
                    ).hexdigest(),
                    vdb_validate="passed",
                    fasterq_version=version,
                    fastq_outputs=records,
                    ena_md5_applicable=False,
                ),
                indent=2,
            )
            + "\n"
        )
        (d / "DOWNLOAD_COMPLETE").touch()
        return run + " SRA verified and converted"
    except Exception as e:
        (d / "DOWNLOAD_FAILED").write_text(str(e))
        raise


with concurrent.futures.ThreadPoolExecutor(max_workers=CONFIG["workers"]) as pool:
    for f in concurrent.futures.as_completed([pool.submit(fetch, r) for r in rows]):
        print(f.result(), flush=True)
