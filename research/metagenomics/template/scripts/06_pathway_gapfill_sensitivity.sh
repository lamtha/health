#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
export PATH="$ROOT/analysis/envs/metagenomics/bin:$PATH"
[[ -f analysis/work/humann/HUMANN_COMPLETE ]] || { echo 'Full HUMAnN analysis is not complete' >&2; exit 2; }
mkdir -p analysis/work/humann_no_gapfill results/functional
if [[ ! -f analysis/work/humann_no_gapfill/NO_GAPFILL_COMPLETE ]]; then
  # Reconstruct pathways from the final, species-stratified gene table. No
  # sequence alignment is repeated and no provisional prepass table is used.
  humann --input results/functional/gene_families_rpk.tsv --input-format genetable \
    --output analysis/work/humann_no_gapfill --output-basename sample_no_gapfill \
    --threads 8 --memory-use maximum --search-mode uniref90 --gap-fill off \
    --o-log analysis/logs/humann_no_gapfill_internal.log > analysis/logs/humann_no_gapfill.log 2>&1
  cp analysis/work/humann_no_gapfill/sample_no_gapfill_pathabundance.tsv \
    results/functional/pathway_abundance_no_gapfill_rpk.tsv
  cp analysis/work/humann_no_gapfill/sample_no_gapfill_pathcoverage.tsv \
    results/functional/pathway_coverage_no_gapfill.tsv
  touch analysis/work/humann_no_gapfill/NO_GAPFILL_COMPLETE
fi
