#!/bin/bash
set -euo pipefail
R=analysis/bile_sulphur/references
B=analysis/envs/assembly/bin
"$B/makeblastdb" -in "$R/genomes.fna" -dbtype nucl -out "$R/genome_db" > analysis/bile_sulphur/logs/genome_db.log
"$B/makeblastdb" -in "$R/proteins.faa" -dbtype prot -out "$R/protein_db" > analysis/bile_sulphur/logs/protein_db.log
"$B/blastn" -query "$R/candidate_markers.fna" -db "$R/genome_db" -task blastn -word_size 11 -evalue 1e-10 -max_target_seqs 10000 -num_threads 8 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore' -out "$R/marker_genome_blast.tsv" &
P1=$!
"$B/blastp" -query "$R/target_proteins.faa" -db "$R/protein_db" -evalue 1e-8 -max_target_seqs 10000 -num_threads 8 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore' -out "$R/target_protein_blast.tsv" &
P2=$!
wait "$P1"
wait "$P2"

"$B/blastn" -query "$R/curated_panel.fna" -db "$R/genome_db" -task blastn -num_threads 4 -evalue 1e-15 -max_target_seqs 10000 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore' -out "$R/curated_genome_blast.tsv"
