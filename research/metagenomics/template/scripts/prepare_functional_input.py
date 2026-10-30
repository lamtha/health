#!/usr/bin/env python3
"""Concatenate host-depleted mates locally with unambiguous mate-specific IDs."""
import csv,gzip
from pathlib import Path
from workspace_config import ROOT, SAMPLE
dest=ROOT/'analysis/work/functional_input/sample.fastq'
dest.parent.mkdir(parents=True,exist_ok=True)
done=dest.with_suffix('.complete')
if not done.exists():
    n=0
    with dest.with_suffix('.partial').open('w') as out:
        for mate in [1,2]:
            with gzip.open(ROOT/f'analysis/work/nonhost/sample_{mate}.fastq.gz','rt') as f:
                while True:
                    h=f.readline()
                    if not h:break
                    seq=f.readline();plus=f.readline();qual=f.readline()
                    if not h.startswith('@') or not plus.startswith('+') or len(seq)!=len(qual):raise ValueError('Invalid FASTQ')
                    name=h.split()[0][1:]
                    if name.endswith(('/1','/2')):name=name[:-2]
                    out.write('@'+name+f'|mate{mate}\n'+seq+'+\n'+qual);n+=1
    expected=sum(int(r['num_seqs']) for r in csv.DictReader((ROOT/'results/nonhost_read_stats.tsv').open(),delimiter='\t'))
    if n!=expected:raise ValueError(f'Read count mismatch {n} != {expected}')
    dest.with_suffix('.partial').replace(dest);done.write_text(str(n)+'\n')
print(dest)
