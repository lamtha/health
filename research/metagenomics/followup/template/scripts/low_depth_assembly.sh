#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/tools/megahit-native/build:$PWD/analysis/envs/metagenomics/bin:$PATH"
python results/followup/scripts/recruit_bilophila.py
megahit -1 analysis/followup/work/bilophila_recruited/mate1.fastq -2 analysis/followup/work/bilophila_recruited/mate2.fastq -o analysis/followup/work/bilophila_low_depth --num-cpu-threads 4 --memory 8000000000 --min-count 1 --min-contig-len 100 --k-list 21,29,39 --prune-level 0 --no-hw-accel
analysis/envs/assembly/bin/blastn -query analysis/followup/references/panel_v2.fna -subject analysis/followup/work/bilophila_low_depth/final.contigs.fa -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore gaps mismatch' -max_target_seqs 100 -evalue 1e-20 -out analysis/followup/work/low_depth_gene_hits.tsv
touch analysis/followup/work/LOW_DEPTH_ASSEMBLY_COMPLETE
