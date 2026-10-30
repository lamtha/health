#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/envs/metagenomics/bin:$PATH"
work=analysis/followup/work
[[ -f "$work/ASSEMBLY_SEARCH_COMPLETE" ]]
if [[ ! -s "$work/target_contigs.fna" ]]; then
  python results/followup/scripts/empty_readback.py
  exit 0
fi
bowtie2-build --threads 6 "$work/megahit_native/final.contigs.fa" "$work/assembly_index" > analysis/followup/logs/assembly_readback_index.log 2>&1
bowtie2 --very-sensitive-local --reorder --seed 42 -k 5 --threads 6 --dovetail -X 1000 --no-unal -x "$work/assembly_index" -1 analysis/work/nonhost/sample_1.fastq.gz -2 analysis/work/nonhost/sample_2.fastq.gz 2> analysis/followup/logs/assembly_readback.log | python results/followup/scripts/assembly_readback.py > analysis/followup/logs/assembly_readback_metrics.log 2>&1
