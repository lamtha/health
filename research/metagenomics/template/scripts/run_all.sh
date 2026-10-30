#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
mkdir -p analysis/logs
[[ -x analysis/envs/metagenomics/bin/python ]] || bash results/scripts/00_environment.sh
export PATH="$ROOT/analysis/tools/Bracken-3.1:$ROOT/analysis/envs/metagenomics/bin:$PATH"
python results/scripts/install_bracken.py
python results/scripts/record_software.py
python results/scripts/01_inventory_paircheck.py
bash results/scripts/02_quality_control.sh
MPLCONFIGDIR="$ROOT/analysis/cache/matplotlib" multiqc analysis/work/qc \
  --dirs --dirs-depth 2 --force -o results/qc -n multiqc_report.html > analysis/logs/multiqc.log 2>&1
python results/scripts/update_qc_status.py
python results/scripts/download_public.py host_md5 host_manifest kraken_md5 metaphlan_md5 --workers 2
python results/scripts/download_public.py host kraken metaphlan --workers 3 \
  > analysis/logs/reproduction_database_downloads.log 2>&1 &
PUBLIC_DOWNLOAD_PID=$!
python results/scripts/download_chocophlan_ranges.py > analysis/logs/chocophlan_ranges.log 2>&1 &
CHOCO_DOWNLOAD_PID=$!
python results/scripts/download_uniref90_ranges.py --workers 32 > analysis/logs/uniref90_ranges.log 2>&1 &
UNIREF_DOWNLOAD_PID=$!
# Finish public downloads before entering the compute coordinator: a failed
# download must not leave the coordinator waiting forever for a ready marker.
trap 'kill "$PUBLIC_DOWNLOAD_PID" "$CHOCO_DOWNLOAD_PID" "$UNIREF_DOWNLOAD_PID" 2>/dev/null || true' EXIT
wait "$PUBLIC_DOWNLOAD_PID"
wait "$CHOCO_DOWNLOAD_PID"
wait "$UNIREF_DOWNLOAD_PID"
trap - EXIT
python results/scripts/run_ready_stages.py > analysis/logs/coordinator.log 2>&1
bash results/scripts/06_pathway_gapfill_sensitivity.sh
python results/scripts/record_humann_provenance.py
python results/scripts/summarize_targets.py
python results/scripts/summarize_target_modules.py
python results/scripts/plot_target_coverage.py
python results/scripts/export_tables.py
python results/scripts/export_marker_taxonomy.py
python results/scripts/export_mechanism_annotations.py
python results/scripts/export_curated_humann_bridge.py
python results/scripts/update_qc_status.py
echo 'Compute/export complete. Review summary.md and methods.md, then run validate_result_tables.py followed by package_results.py.'
