#!/usr/bin/env python3
"""Add a reusable follow-up module to an existing private metagenomics workspace."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

SOURCE = Path(__file__).resolve().parent


def read_controls(path):
    if path is None:
        return []
    with Path(path).open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    seen_runs, seen_donors = set(), set()
    for row in rows:
        if not re.fullmatch(r"(?:SRR|ERR|DRR)\d+", row.get("run_accession", "")):
            raise ValueError("Controls require public SRA/ENA run accessions")
        donor = row.get("donor", "")
        if not donor or donor in seen_donors or row["run_accession"] in seen_runs:
            raise ValueError(
                "Select exactly one run per independent donor before quantification"
            )
        seen_runs.add(row["run_accession"])
        seen_donors.add(donor)
        cohorts = row.get("cohorts", "").split(";")
        if any(
            not re.fullmatch(r"[a-z][a-z0-9_]*", c) or c == "all_controls"
            for c in cohorts
            if c
        ):
            raise ValueError(
                "Cohort labels must be simple slugs; all_controls is implicit"
            )
        if row.get("read_count") and int(row["read_count"]) <= 0:
            raise ValueError("Expected read_count is a positive paired-fragment count")
    if not rows:
        raise ValueError("The supplied control manifest is empty")
    return [
        {k: r.get(k, "") for k in ("run_accession", "donor", "cohorts", "read_count")}
        for r in rows
    ]


def initialize(
    workspace,
    controls=None,
    common_depth=2_000_000,
    max_read_length=146,
    workers=2,
    seed=42,
    resamples=5000,
):
    root = Path(workspace).expanduser().resolve(strict=True)
    if any((p / ".git").exists() for p in (root, *root.parents)):
        raise ValueError("Follow-up analysis must run outside every Git checkout")
    config = json.loads((root / "workspace.json").read_text())
    if config.get("schema_version") != 1 or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", config.get("sample_id", "")
    ):
        raise ValueError("Initialize the parent metagenomics workspace first")
    if not (root / "results/scripts/workspace_config.py").is_file():
        raise ValueError("The parent workflow scripts are required")
    if min(common_depth, workers, resamples) <= 0 or max_read_length < 80 or seed < 0:
        raise ValueError(
            "Depth/workers/resamples must be positive; read length >=80; seed >=0"
        )
    rows = read_controls(controls)
    for p in ("results/followup", "analysis/followup", "followup.json"):
        if (root / p).exists():
            raise FileExistsError(
                "Existing follow-up state is never overwritten; use a fresh workspace"
            )
    old_umask = os.umask(0o077)
    try:
        out = root / "results/followup"
        shutil.copytree(
            SOURCE / "template",
            out,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        # Freeze the shared depth-label implementation with this workflow.
        shutil.copy2(SOURCE.parent / "template/scripts/coverage_evidence.py", out / "scripts/coverage_evidence.py")
        # copytree preserves source modes; restore private directory permissions.
        for directory in [out, *(p for p in out.rglob("*") if p.is_dir())]:
            directory.chmod(0o700)
        for p in (
            "analysis/followup/work/recovered",
            "analysis/followup/references",
            "analysis/followup/controls",
            "analysis/followup/logs",
            "results/followup/versions",
            "results/followup/figures",
        ):
            (root / p).mkdir(parents=True, exist_ok=True)
        with (out / "control_manifest.tsv").open("w") as stream:
            writer = csv.DictWriter(
                stream,
                fieldnames=["run_accession", "donor", "cohorts", "read_count"],
                delimiter="\t",
                lineterminator="\n",
            )
            writer.writeheader()
            writer.writerows(rows)
        settings = dict(
            schema_version=1,
            common_depth=common_depth,
            max_read_length=max_read_length,
            workers=workers,
            seed=seed,
            resamples=resamples,
            controls_sha256=hashlib.sha256(
                (out / "control_manifest.tsv").read_bytes()
            ).hexdigest(),
        )
        (root / "followup.json").write_text(json.dumps(settings, indent=2) + "\n")
        (out / "versions/followup_config.sha256").write_text(
            hashlib.sha256((root / "followup.json").read_bytes()).hexdigest() + "\n"
        )
        assets = [
            {
                "path": str(p.relative_to(out)),
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
            for p in sorted(out.rglob("*"))
            if p.is_file()
        ]
        (out / "versions/workflow_assets.json").write_text(
            json.dumps(assets, indent=2) + "\n"
        )
    finally:
        os.umask(old_umask)
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument(
        "--controls",
        type=Path,
        help="Preselected public runs TSV; omit for recovery/assembly only",
    )
    parser.add_argument("--common-depth", type=int, default=2_000_000)
    parser.add_argument("--max-read-length", type=int, default=146)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resamples", type=int, default=5000)
    args = parser.parse_args()
    print(initialize(**vars(args)))
