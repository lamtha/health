#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/envs/metagenomics/bin:$PATH"
ref=analysis/followup/references
work=analysis/followup/work
mkdir -p "$work/panel_v2" "$work/context"
analysis/envs/assembly/bin/blastn -query "$ref/panel_v2.fna" -subject "$ref/context_genomes.fna" -max_target_seqs 100 -evalue 1e-20 -outfmt '6 qseqid sseqid pident length qlen qstart qend sstart send bitscore evalue' -out "$work/context/reference_gene_locations.tsv"
bowtie2-build --threads 8 "$ref/panel_v2.fna" "$work/panel_v2/index" > analysis/followup/logs/panel_index.log 2>&1
for mate in 1 2; do
  bowtie2 --very-sensitive-local --reorder --seed 42 -k 10 --threads 8 --no-unal -x "$work/panel_v2/index" -U "analysis/work/nonhost/sample_${mate}.fastq.gz" 2> "analysis/followup/logs/panel_mate${mate}.log" | samtools view -b -o "$work/panel_v2/mate${mate}.bam"
done
touch "$work/panel_v2/COMPLETE"
bowtie2-build --threads 8 "$ref/context_genomes.fna" "$work/context/index" > analysis/followup/logs/context_index.log 2>&1
bowtie2 --very-sensitive-local --reorder --seed 42 -k 5 --threads 8 --dovetail --no-unal -X 1000 -x "$work/context/index" -1 analysis/work/nonhost/sample_1.fastq.gz -2 analysis/work/nonhost/sample_2.fastq.gz 2> analysis/followup/logs/context_mapping.log | samtools view -b -o "$work/context/name_ordered.bam"
samtools sort -@ 4 -o "$work/context/sorted.bam" "$work/context/name_ordered.bam"
samtools index "$work/context/sorted.bam"
touch "$work/context/COMPLETE"
