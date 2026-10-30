#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
export PATH="$ROOT/analysis/envs/metagenomics/bin:$PATH"
[[ -f analysis/work/nonhost/HOST_COMPLETE ]] || { echo 'Host removal not complete' >&2; exit 2; }
mkdir -p analysis/work/targeted
PANEL=results/references/target_panel.fna
INDEX=analysis/work/targeted/curated_panel
bowtie2-build --threads 8 "$PANEL" "$INDEX" > analysis/logs/target_index.log 2>&1
# Map mates independently so reads crossing CDS boundaries are not rejected by
# artificial reference boundaries. Mate identity is retained in separate BAMs.
for MATE in 1 2; do
  bowtie2 --very-sensitive-local --reorder --seed 42 -k 10 --threads 8 --no-unal \
    -x "$INDEX" -U "analysis/work/nonhost/sample_${MATE}.fastq.gz" \
    2> "analysis/logs/target_mate${MATE}.log" \
    | samtools view -b -o "analysis/work/targeted/mate${MATE}.bam" -
done
python results/scripts/summarize_targets.py
touch analysis/work/targeted/TARGETED_COMPLETE
