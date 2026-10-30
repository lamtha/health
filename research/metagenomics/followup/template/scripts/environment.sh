#!/usr/bin/env bash
# Source from entry-point scripts; never run analysis inside a Git checkout.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
python3 results/followup/scripts/followup_config.py
umask 077
export PATH="$PWD/analysis/envs/metagenomics/bin:$PATH"
