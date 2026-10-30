"""Quantify completed local mappings while remaining samples map."""
import concurrent.futures, csv, subprocess, time
from bile_sulphur_config import CONFIG
from pathlib import Path

W = Path("analysis/bile_sulphur/work")
L = Path("analysis/bile_sulphur/logs")
names = ["sample_local"] + [
    r["run_accession"]
    for r in csv.DictReader(
        open("results/followup/control_manifest.tsv"), delimiter="\t"
    )
]


def one(name):
    if (W / name / "QUANTIFICATION_COMPLETE").exists():
        return name + " already quantified"
    with (L / f"{name}.quantification.log").open("w") as f:
        subprocess.run(
            [
                "analysis/envs/metagenomics/bin/python",
                "results/bile_sulphur/scripts/quantify_carriers.py",
                name,
            ],
            stdout=f,
            stderr=subprocess.STDOUT,
            check=True,
        )
    return name + " quantified"


if not all((W / name / "MAPPING_COMPLETE").exists() for name in names):
    raise RuntimeError("Finish mapping every preselected library before quantification")
pending = set(names)
running = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=CONFIG["workers"]) as pool:
    while pending or running:
        for future, name in list(running.items()):
            if future.done():
                print(future.result(), flush=True)
                del running[future]
        for name in names:
            if (
                name in pending
                and len(running) < CONFIG["workers"]
                and (W / name / "MAPPING_COMPLETE").exists()
            ):
                print(name, "quantification started", flush=True)
                running[pool.submit(one, name)] = name
                pending.remove(name)
        if pending or running:
            time.sleep(5)
