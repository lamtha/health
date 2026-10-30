#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/envs/assembly/bin:$PWD/analysis/envs/metagenomics/bin:$PATH"
work=analysis/followup/work
[[ -f "$work/ASSEMBLY_COMPLETE" ]]
contigs="$work/megahit_native/final.contigs.fa"
if [[ ! -f "$work/ASSEMBLY_SEARCH_COMPLETE" ]]; then
makeblastdb -in "$contigs" -dbtype nucl -out "$work/assembly_blast" > analysis/followup/logs/assembly_blast_db.log 2>&1
blastn -query analysis/followup/references/panel_v2.fna -db "$work/assembly_blast" -num_threads 4 -max_target_seqs 100 -evalue 1e-20 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore gaps mismatch' -out "$work/assembly_nucleotide_hits.tsv"
tblastn -query analysis/followup/references/panel_v2.faa -db "$work/assembly_blast" -num_threads 4 -max_target_seqs 100 -evalue 1e-10 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore gaps mismatch' -out "$work/assembly_protein_hits.tsv"
touch "$work/ASSEMBLY_SEARCH_COMPLETE"
fi
analysis/envs/metagenomics/bin/python results/followup/scripts/summarize_assembly.py
if [[ ! -s "$work/target_contigs.fna" ]]; then
  for output in assembly_target_taxonomy.report.tsv assembly_target_taxonomy.reads.tsv assembly_target_taxonomy_conf0.1.report.tsv assembly_target_taxonomy_conf0.1.reads.tsv target_contigs_context.paf target_contigs_context_exact.paf; do
    : > "$work/$output"
  done
  touch "$work/ASSEMBLY_CONTEXT_COMPLETE"
  exit 0
fi
# Classify only selected sample contigs locally; classifier confidence is not a probability.
kraken2 --db analysis/databases/kraken/pluspf_16_GB_20260626 --threads 4 --confidence 0.2 --report "$work/assembly_target_taxonomy.report.tsv" --output "$work/assembly_target_taxonomy.reads.tsv" "$work/target_contigs.fna" > analysis/followup/logs/assembly_kraken.stdout.log 2> analysis/followup/logs/assembly_kraken.log
kraken2 --db analysis/databases/kraken/pluspf_16_GB_20260626 --threads 4 --confidence 0.1 --report "$work/assembly_target_taxonomy_conf0.1.report.tsv" --output "$work/assembly_target_taxonomy_conf0.1.reads.tsv" "$work/target_contigs.fna" > analysis/followup/logs/assembly_kraken_conf0.1.stdout.log 2> analysis/followup/logs/assembly_kraken_conf0.1.log
# Contig-to-reference context does not by itself prove the carrier or a MAG.
minimap2 -x asm5 --secondary=yes -t 4 analysis/followup/references/context_genomes.fna "$work/target_contigs.fna" > "$work/target_contigs_context.paf" 2> analysis/followup/logs/contig_context.log
minimap2 -cx asm5 --secondary=yes -t 4 analysis/followup/references/context_genomes.fna "$work/target_contigs.fna" > "$work/target_contigs_context_exact.paf" 2> analysis/followup/logs/contig_context_exact.log
touch "$work/ASSEMBLY_CONTEXT_COMPLETE"
