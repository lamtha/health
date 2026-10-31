#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
analysis/envs/metagenomics/bin/python results/bile_sulphur/scripts/bile_sulphur_config.py
analysis/envs/metagenomics/bin/python - <<'PY'
import csv
from Bio import SeqIO
R='analysis/bile_sulphur/references/'
meta={r['reference_id']:r for r in csv.DictReader(open('results/bile_sulphur/references/mapping_panel_manifest.tsv'),delimiter='\t')}
with open(R+'marker_alleles.fna','w')as m,open(R+'target_alleles.fna','w')as t:
 for rec in SeqIO.parse(R+'mapping_panel.fna','fasta'):
  if meta[rec.id]['kind']=='marker':SeqIO.write(rec,m,'fasta')
  elif meta[rec.id]['kind']=='target':SeqIO.write(rec,t,'fasta')
PY
R=analysis/bile_sulphur/references
analysis/envs/assembly/bin/blastn -query "$R/marker_alleles.fna" -subject "$R/target_alleles.fna" -word_size 11 -evalue 1e-8 -outfmt '6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore' -out "$R/marker_target_overlap.tsv"
if [[ -s "$R/marker_target_overlap.tsv" ]]; then
  echo 'Marker–target overlap requires review before mapping' >&2
  exit 1
fi
analysis/envs/metagenomics/bin/bowtie2-build --threads 8 "$R/mapping_panel.fna" "$R/mapping_index" > analysis/bile_sulphur/logs/bowtie_build.log 2>&1
