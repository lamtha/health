#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
export PATH="$ROOT/analysis/envs/metagenomics/bin:$PATH"
export MPLCONFIGDIR="$ROOT/analysis/cache/matplotlib"
[[ -f analysis/work/nonhost/HOST_COMPLETE ]] || { echo 'Host removal not complete' >&2; exit 2; }
[[ -f analysis/databases/metaphlan/VERIFIED ]] || { echo 'Verified MetaPhlAn database not ready' >&2; exit 2; }
mkdir -p analysis/work/metaphlan analysis/work/humann results/functional results/taxonomy
python results/scripts/prepare_functional_input.py
if [[ ! -f analysis/work/metaphlan/METAPHLAN_COMPLETE ]]; then
  metaphlan analysis/work/functional_input/sample.fastq --input_type fastq \
    --db_dir analysis/databases/metaphlan --index mpa_vJun23_CHOCOPhlAnSGB_202403 \
    --offline --nproc 8 --read_min_len 60 \
    --mapout analysis/work/metaphlan/sample.mapout.bz2 \
    -o results/taxonomy/metaphlan_profile.tsv > analysis/logs/metaphlan.log 2>&1
  touch analysis/work/metaphlan/METAPHLAN_COMPLETE
fi
[[ "${1:-all}" == metaphlan ]] && exit 0
HUMANN_BASE=(python results/scripts/humann_with_metaphlan_version_compat.py --input analysis/work/functional_input/sample.fastq --output analysis/work/humann
  --output-basename sample --threads 8 --memory-use maximum
  --taxonomic-profile results/taxonomy/metaphlan_profile.tsv
  --nucleotide-database analysis/databases/humann/chocophlan
  --protein-database analysis/databases/humann/uniref90
  --search-mode uniref90 --translated-alignment diamond)
if [[ "${1:-all}" == nucleotide ]]; then
  [[ -f analysis/databases/humann/chocophlan.VERIFIED ]] || { echo 'Verified ChocoPhlAn database not ready' >&2; exit 2; }
  if [[ ! -f analysis/work/humann/NUCLEOTIDE_COMPLETE ]]; then
    # --resume retains the successfully generated SAM for the later full run.
    # Never reuse any partial index/alignment from an unsuccessful attempt.
    [[ ! -d analysis/work/humann/sample_humann_temp ]] || {
      echo 'Unverified HUMAnN cache exists; inspect/move it aside before a fresh prepass' >&2; exit 2;
    }
    "${HUMANN_BASE[@]}" --resume --bypass-translated-search \
      --o-log analysis/logs/humann_nucleotide_internal.log > analysis/logs/humann_nucleotide.log 2>&1
    touch analysis/work/humann/NUCLEOTIDE_COMPLETE
  fi
  # Prepass outputs stay private; they are not final functional results.
  exit 0
fi
for DB in chocophlan uniref90; do
  [[ -f "analysis/databases/humann/$DB.VERIFIED" ]] || { echo "Verified $DB database not ready" >&2; exit 2; }
done
if [[ ! -f analysis/work/humann/HUMANN_COMPLETE ]]; then
  RESUME_OPTIONS=()
  if [[ -f analysis/work/humann/NUCLEOTIDE_COMPLETE ]]; then
    RESUME_OPTIONS=(--resume)
    # An interrupted full run may leave a partial merged translated output.
    # Recompute translated search; only completed nucleotide work is reused.
    rm -f analysis/work/humann/sample_humann_temp/sample_diamond_aligned.tsv
  fi
  "${HUMANN_BASE[@]}" "${RESUME_OPTIONS[@]}" \
    --o-log analysis/logs/humann_internal.log > analysis/logs/humann.log 2>&1
  cp analysis/work/humann/sample_genefamilies.tsv results/functional/gene_families_rpk.tsv
  cp analysis/work/humann/sample_pathabundance.tsv results/functional/pathway_abundance_rpk.tsv
  cp analysis/work/humann/sample_pathcoverage.tsv results/functional/pathway_coverage.tsv
  humann_renorm_table --input results/functional/gene_families_rpk.tsv \
    --output results/functional/gene_families_cpm.tsv --units cpm --mode community --special y --update-snames \
    > analysis/logs/humann_normalization.log 2>&1
  humann_renorm_table --input results/functional/pathway_abundance_rpk.tsv \
    --output results/functional/pathway_abundance_cpm.tsv --units cpm --mode community --special y --update-snames \
    >> analysis/logs/humann_normalization.log 2>&1
  touch analysis/work/humann/HUMANN_COMPLETE
fi
