#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/envs/metagenomics/bin:$PATH"
python - <<'PY'
from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from pathlib import Path
refs=list(SeqIO.parse('analysis/followup/references/panel_v2.faa','fasta'))
seqs={str(r.seq)for r in refs}
for name in ['bilophila_complete_assembly','B_theta_VPI5482']:
 for r in SeqIO.parse('analysis/references/'+name+'.gb','genbank'):
  for f in r.features:
   if f.type!='CDS' or 'translation'not in f.qualifiers:continue
   seq=f.qualifiers['translation'][0]
   if seq in seqs:continue
   seqs.add(seq);refs.append(SeqRecord(Seq(seq),id='context_'+f.qualifiers.get('protein_id',['unknown'])[0]+'_'+f.qualifiers.get('locus_tag',['unknown'])[0],description=''))
SeqIO.write(refs,'analysis/followup/references/context_competitive_proteins.faa','fasta')
print(len(refs),'distinct context/panel proteins')
PY
diamond makedb --in analysis/followup/references/context_competitive_proteins.faa --db analysis/followup/work/context_proteins > analysis/followup/logs/diamond_db.log 2>&1
for mate in 1 2; do
 diamond blastx --query "analysis/work/nonhost/sample_${mate}.fastq.gz" --db analysis/followup/work/context_proteins --out "analysis/followup/work/translated_mate${mate}.tsv" --threads 4 --sensitive --id 80 --query-cover 80 --evalue 1e-10 --max-target-seqs 10 --outfmt 6 qseqid sseqid pident length qstart qend qlen sstart send slen evalue bitscore > "analysis/followup/logs/diamond_mate${mate}.log" 2>&1
done
touch analysis/followup/work/TRANSLATED_SEARCH_COMPLETE
