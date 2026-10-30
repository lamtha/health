#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python3 results/scripts/workspace_config.py
umask 077
export PATH="$ROOT/analysis/envs/metagenomics/bin:$PATH"
export JAVA_HOME="$ROOT/analysis/envs/metagenomics/lib/jvm"
export MPLCONFIGDIR="$ROOT/analysis/cache/matplotlib"
mkdir -p analysis/work/qc/raw analysis/work/qc/filtered analysis/work/filtered analysis/logs
fastqc --threads 2 --outdir analysis/work/qc/raw \
  incoming/sample_1.fastq.gz incoming/sample_2.fastq.gz > analysis/logs/fastqc_raw.log 2>&1
fastp --in1 incoming/sample_1.fastq.gz --in2 incoming/sample_2.fastq.gz \
  --out1 analysis/work/filtered/sample_1.fastq.gz --out2 analysis/work/filtered/sample_2.fastq.gz \
  --detect_adapter_for_pe --cut_tail --cut_tail_window_size 4 --cut_tail_mean_quality 20 \
  --qualified_quality_phred 20 --unqualified_percent_limit 40 --n_base_limit 5 --length_required 60 \
  --thread 8 --compression 4 --json analysis/work/qc/fastp.json --html analysis/work/qc/fastp.html \
  --report_title 'sample local paired-end quality filtering' > analysis/logs/fastp.log 2>&1
fastqc --threads 2 --outdir analysis/work/qc/filtered \
  analysis/work/filtered/sample_1.fastq.gz analysis/work/filtered/sample_2.fastq.gz > analysis/logs/fastqc_filtered.log 2>&1
touch analysis/work/qc/QC_COMPLETE
