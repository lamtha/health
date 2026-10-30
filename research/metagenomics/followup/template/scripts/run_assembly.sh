#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/tools/megahit-native/build:$PWD/analysis/envs/metagenomics/bin:$PATH"
megahit --version > results/followup/versions/megahit.txt 2>&1
# Plain files avoid a failed compressed-input FIFO on this macOS installation.
mkdir -p analysis/followup/work/assembly_input
for mate in 1 2; do
  file="analysis/followup/work/assembly_input/mate${mate}.fastq"
  if [ ! -f "$file" ]; then
    /usr/bin/gzip -cd "analysis/work/nonhost/sample_${mate}.fastq.gz" > "$file.partial"
    mv "$file.partial" "$file"
  fi
done
# Whole nonhost sample: recruitment does not restrict the assembly to known taxa.
megahit -1 analysis/followup/work/assembly_input/mate1.fastq -2 analysis/followup/work/assembly_input/mate2.fastq -o analysis/followup/work/megahit_native --num-cpu-threads 8 --memory 0.45 --min-contig-len 300 --k-list 21,29,39,59,79,99,119 --no-hw-accel
touch analysis/followup/work/ASSEMBLY_COMPLETE
