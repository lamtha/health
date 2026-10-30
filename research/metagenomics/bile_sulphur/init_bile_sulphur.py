#!/usr/bin/env python3
"""Install bile/sulphur carrier normalization into a private, completed follow-up workspace."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil

SOURCE = Path(__file__).resolve().parent


def initialize(workspace, workers=2, mapping_threads=6, interval_seed=20261030):
    root = Path(workspace).expanduser().resolve(strict=True)
    if any((p / ".git").exists() for p in (root, *root.parents)):
        raise ValueError("Research data must stay outside every Git checkout")
    parent = json.loads((root / "followup.json").read_text())
    expected = (
        (root / "results/followup/versions/followup_config.sha256").read_text().strip()
    )
    parent_hash = hashlib.sha256((root / "followup.json").read_bytes()).hexdigest()
    if parent_hash != expected:
        raise ValueError("Follow-up settings changed")
    controls = root / "results/followup/control_manifest.tsv"
    if hashlib.sha256(controls.read_bytes()).hexdigest() != parent["controls_sha256"]:
        raise ValueError("Predeclared control manifest changed")
    with controls.open() as stream:
        if not list(csv.DictReader(stream, delimiter="\t")):
            raise ValueError(
                "Preselect at least one independent public control in the follow-up"
            )
    if not 80 <= parent["max_read_length"] <= 200:
        raise ValueError(
            "This marker panel supports a common maximum read length of 80–200 nt"
        )
    if min(workers, mapping_threads) < 1 or interval_seed < 0:
        raise ValueError("Workers/threads must be positive and seed nonnegative")
    for relative in (
        "bile_sulphur.json",
        "results/bile_sulphur",
        "analysis/bile_sulphur",
    ):
        if (root / relative).exists():
            raise FileExistsError(
                "Existing carrier analysis is never overwritten; use a fresh workspace"
            )
    old_umask = os.umask(0o077)
    try:
        out = root / "results/bile_sulphur"
        shutil.copytree(
            SOURCE / "template",
            out,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        for directory in [out, *(p for p in out.rglob("*") if p.is_dir())]:
            directory.chmod(0o700)
        for relative in (
            "analysis/bile_sulphur/references",
            "analysis/bile_sulphur/work",
            "analysis/bile_sulphur/logs",
            "results/bile_sulphur/references",
            "results/bile_sulphur/versions",
            "results/bile_sulphur/figures",
        ):
            (root / relative).mkdir(parents=True, exist_ok=True)
        config = dict(
            schema_version=1,
            workers=workers,
            mapping_threads=mapping_threads,
            interval_seed=interval_seed,
            parent_config_sha256=parent_hash,
            **{
                k: parent[k]
                for k in ("common_depth", "max_read_length", "seed", "resamples")
            }
        )
        path = root / "bile_sulphur.json"
        path.write_text(json.dumps(config, indent=2) + "\n")
        (out / "versions/config.sha256").write_text(
            hashlib.sha256(path.read_bytes()).hexdigest() + "\n"
        )
        assets = [
            {
                "path": str(p.relative_to(out)),
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
            for p in sorted((out / "scripts").glob("*"))
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
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--mapping-threads", type=int, default=6)
    parser.add_argument("--interval-seed", type=int, default=20261030)
    print(initialize(**vars(parser.parse_args())))
