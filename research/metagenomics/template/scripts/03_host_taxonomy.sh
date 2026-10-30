#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
export PATH="$ROOT/analysis/tools/Bracken-3.1:$ROOT/analysis/envs/metagenomics/bin:$PATH"
HOST="$ROOT/analysis/databases/host/GRCh38_noalt_decoy_as"
KRAKEN="$ROOT/analysis/databases/kraken/pluspf_16_GB_20260626"
[[ -f analysis/work/qc/QC_COMPLETE ]] || { echo 'QC not complete' >&2; exit 2; }
[[ -f analysis/databases/host/VERIFIED ]] || { echo 'Verified human index not ready' >&2; exit 2; }
mkdir -p analysis/work/nonhost analysis/work/taxonomy results/taxonomy
if [[ ! -f analysis/work/nonhost/HOST_COMPLETE ]]; then
  bowtie2 --very-sensitive --dovetail --seed 42 --threads 8 -x "$HOST" \
    -1 analysis/work/filtered/sample_1.fastq.gz -2 analysis/work/filtered/sample_2.fastq.gz \
    2> analysis/logs/host_bowtie2.log \
    | samtools view -u -f 12 -F 2304 - \
    | samtools collate -@ 2 -u -O - \
    | samtools fastq -@ 2 -n -1 analysis/work/nonhost/sample_1.fastq.gz \
      -2 analysis/work/nonhost/sample_2.fastq.gz -0 /dev/null -s /dev/null - \
      2> analysis/logs/host_samtools.log
  seqkit stats -T analysis/work/nonhost/sample_1.fastq.gz analysis/work/nonhost/sample_2.fastq.gz \
    > results/nonhost_read_stats.tsv
  touch analysis/work/nonhost/HOST_COMPLETE
fi
[[ "${1:-all}" == host ]] && exit 0
[[ -f "$KRAKEN/VERIFIED" ]] || { echo 'Verified Kraken database not ready' >&2; exit 2; }
for CONF in 0.0 0.1 0.2; do
  kraken2 --db "$KRAKEN" --paired --gzip-compressed --threads 8 --confidence "$CONF" \
    --report "results/taxonomy/kraken_conf${CONF}.report.tsv" \
    --output "analysis/work/taxonomy/kraken_conf${CONF}.reads.tsv" \
    analysis/work/nonhost/sample_1.fastq.gz analysis/work/nonhost/sample_2.fastq.gz \
    > "analysis/logs/kraken_conf${CONF}.stdout.log" 2> "analysis/logs/kraken_conf${CONF}.log"
done
# 150 is a model approximation for these variable-length reads; sensitivity runs
# at 100 and 150 are retained. Kraken paired counts refer to fragments, not mates.
# Use default-confidence Kraken assignments with standard precomputed Bracken
# distributions. Higher confidence runs assess classification support separately.
for LENGTH in 100 150; do
  bracken -d "$KRAKEN" -i results/taxonomy/kraken_conf0.0.report.tsv \
    -o "results/taxonomy/bracken_species_readlen${LENGTH}.tsv" -r "$LENGTH" -l S -t 10 \
    > "analysis/logs/bracken_${LENGTH}.log" 2>&1
done
python results/scripts/validate_taxonomy_outputs.py
touch analysis/work/taxonomy/TAXONOMY_COMPLETE
