"""Map existing local, identically filtered nonhost reads; no network operations."""
from bile_sulphur_config import ROOT, CONFIG
import concurrent.futures, csv, json, subprocess, time
from pathlib import Path

B = Path("analysis/envs/metagenomics/bin")
R = Path("analysis/bile_sulphur/references")
W = Path("analysis/bile_sulphur/work")
L = Path("analysis/bile_sulphur/logs")
rows = list(
    csv.DictReader(open("results/followup/control_manifest.tsv"), delimiter="\t")
)
names = ["sample_local"] + [r["run_accession"] for r in rows]


def one(name):
    d = W / name
    d.mkdir(exist_ok=True)
    inp = Path("analysis/followup/controls") / name
    if (d / "MAPPING_COMPLETE").exists():
        return name + " already complete"
    cmd = [
        str(B / "bowtie2"),
        "--very-sensitive-local",
        "--reorder",
        "--seed",
        str(CONFIG["seed"]),
        "-k",
        "50",
        "--threads",
        str(CONFIG["mapping_threads"]),
        "--no-unal",
        "-x",
        str(R / "mapping_index"),
        "-U",
        ",".join(str(inp / f"nonhost_{m}.fastq.gz") for m in [1, 2]),
    ]
    start = time.time()
    print(name, "started", flush=True)
    with (L / f"{name}.bowtie2.log").open("w") as log:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log)
        q = subprocess.Popen(
            [str(B / "samtools"), "view", "-b", "-o", str(d / "panel.bam")],
            stdin=p.stdout,
            stderr=log,
        )
        p.stdout.close()
        b = q.wait()
        a = p.wait()
    if a or b:
        raise RuntimeError((name, a, b))
    json.dump(
        dict(command=cmd, seconds=time.time() - start, bowtie2_exit=a, samtools_exit=b),
        open(d / "mapping_run.json", "w"),
        indent=2,
    )
    (d / "MAPPING_COMPLETE").touch()
    return name + f" mapped in {time.time()-start:.1f}s"


with concurrent.futures.ThreadPoolExecutor(max_workers=CONFIG["workers"]) as pool:
    futures = [pool.submit(one, n) for n in names]
    for f in concurrent.futures.as_completed(futures):
        print(f.result(), flush=True)
