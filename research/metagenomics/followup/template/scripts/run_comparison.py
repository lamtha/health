"""Local comparison coordinator; independently downloaded controls are processed as ready."""
import concurrent.futures, csv, subprocess, time, json
from common import ROOT, OUT, CONFIG

base = ROOT / "analysis/followup/controls"
rows = list(csv.DictReader((OUT / "control_manifest.tsv").open(), delimiter="\t"))
if not rows:
    raise ValueError("No preselected controls; initialize a comparison workspace first")
subprocess.run(
    ["python3", str(ROOT / "results/scripts/01_inventory_paircheck.py")],
    cwd=ROOT,
    check=True,
)
todo = ["sample_local"] + [r["run_accession"] for r in rows]
running = {}
deadline = time.monotonic() + 8 * 3600


def run(name):
    d = base / name
    d.mkdir(exist_ok=True)
    with (d / "pipeline.log").open("a") as f:
        subprocess.run(
            ["bash", str(OUT / "scripts/process_comparison_sample.sh"), name],
            cwd=ROOT,
            stdout=f,
            stderr=f,
            check=True,
        )
    return name


with concurrent.futures.ThreadPoolExecutor(max_workers=CONFIG["workers"]) as pool:
    while todo or running:
        if time.monotonic() > deadline:
            raise TimeoutError(
                "Comparison unfinished; inspect download/stage logs, resume explicitly"
            )
        for name in list(todo):
            if (base / name / "DOWNLOAD_FAILED").exists():
                raise RuntimeError(
                    "A public control download failed; inspect its local log"
                )
            if len(running) >= CONFIG["workers"]:
                break
            if name == "sample_local" or (base / name / "DOWNLOAD_COMPLETE").exists():
                running[pool.submit(run, name)] = name
                todo.remove(name)
                print("started", name, flush=True)
        for fut in list(running):
            if fut.done():
                name = running.pop(fut)
                fut.result()
                print("complete", name, flush=True)
        time.sleep(5)
(base / "COMPARISON_COMPLETE").touch()
