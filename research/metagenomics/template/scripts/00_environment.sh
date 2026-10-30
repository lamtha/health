#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
mkdir -p analysis/cache/conda analysis/envs analysis/logs
export CONDA_PKGS_DIRS="$ROOT/analysis/cache/conda"
export CONDA_SUBDIR=osx-64
# This recorded environment is for macOS ARM running x86_64 tools under Rosetta.
# Other platforms need a separately resolved environment and fresh validation.
conda create -y -p "$ROOT/analysis/envs/metagenomics" \
  --file results/versions/conda-explicit-osx-64.txt
# Repair the two observed Bioconda packaging problems, without scientific-code edits.
printf '%s\n' "$ROOT/analysis/envs/metagenomics/lib/python3.12/site-packages" \
  > "$ROOT/analysis/envs/metagenomics/lib/python3.11/site-packages/humann_conda_layout_fix.pth"
conda install -y -p "$ROOT/analysis/envs/metagenomics" --force-reinstall \
  --file results/versions/repair-executables-explicit.txt
CONDA_SUBDIR=osx-arm64 conda create -y -p "$ROOT/analysis/envs/downloads" \
  --file results/versions/conda-explicit-downloads-osx-arm64.txt
export PATH="$ROOT/analysis/envs/metagenomics/bin:$PATH"
humann --version
bowtie2 --version
diamond version
python results/scripts/install_bracken.py
