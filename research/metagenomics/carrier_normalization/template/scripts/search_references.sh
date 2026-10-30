#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
analysis/envs/metagenomics/bin/python results/carrier_normalization/scripts/carrier_config.py
R=analysis/carrier_normalization/references
B=analysis/envs/assembly/bin
"$B/makeblastdb" -in "$R/genomes.fna" -dbtype nucl -out "$R/genome_db" > analysis/carrier_normalization/logs/genome_db.log
"$B/makeblastdb" -in "$R/proteins.faa" -dbtype prot -out "$R/protein_db" > analysis/carrier_normalization/logs/protein_db.log
"$B/blastn" -query "$R/candidate_markers.fna" -db "$R/genome_db" -task blastn -word_size 11 -evalue 1e-10 -max_target_seqs 10000 -num_threads 8 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore' -out "$R/marker_genome_blast.tsv" &
P1=$!
"$B/blastp" -query "$R/target_proteins.faa" -db "$R/protein_db" -evalue 1e-8 -max_target_seqs 10000 -num_threads 8 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore' -out "$R/target_protein_blast.tsv" &
P2=$!
wait "$P1"
wait "$P2"
