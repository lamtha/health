#!/usr/bin/env python3
"""Cross-check classifier reports, private per-fragment outputs and estimates."""
import collections,csv,json
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
total=sum(int(r['num_seqs']) for r in csv.DictReader((OUT/'nonhost_read_stats.tsv').open(),delimiter='\t'))//2
checks={}
for confidence in ['0.0','0.1','0.2']:
    direct={};root=0;unclassified=0
    with (OUT/f'taxonomy/kraken_conf{confidence}.report.tsv').open() as f:
        for line in f:
            c=line.rstrip('\n').split('\t')
            if len(c)!=6:raise ValueError('Unexpected Kraken report columns')
            clade,count=int(c[1]),int(c[2]);taxid=c[4];direct[taxid]=count
            if not 0<=count<=clade<=total:raise ValueError('Invalid report count')
            if taxid=='1':root=clade
            if taxid=='0':unclassified=clade
    if root+unclassified!=total or sum(direct.values())!=total:raise ValueError('Report/library fragment totals disagree')
    observed=collections.Counter();n=0
    with (ROOT/f'analysis/work/taxonomy/kraken_conf{confidence}.reads.tsv').open() as f:
        for line in f:
            c=line.split('\t',3)
            if len(c)<4 or c[0] not in ['C','U']:raise ValueError('Invalid private classifier record')
            observed[c[2]]+=1;n+=1
    if n!=total or any(observed[t]!=direct.get(t,0) for t in set(observed)|set(direct)):
        raise ValueError('Private classifier records do not match report counts')
    checks['kraken_conf'+confidence]=dict(fragments=n,classified=root,unclassified=unclassified,report_counts_match_private_records=True)
for length in [100,150]:
    with (OUT/f'taxonomy/bracken_species_readlen{length}.tsv').open() as f:
        reader=csv.DictReader(f,delimiter='\t')
        required={'name','taxonomy_id','taxonomy_lvl','kraken_assigned_reads','added_reads','new_est_reads','fraction_total_reads'}
        if not required.issubset(reader.fieldnames or []):raise ValueError('Bracken output missing required columns')
        rows=list(reader)
    if not rows:raise ValueError('No estimated species; inspect classifier/model results before accepting empty output')
    if len({r['taxonomy_id'] for r in rows})!=len(rows):raise ValueError('Duplicate Bracken species rows')
    estimate=sum(float(r['new_est_reads']) for r in rows)
    if not 0<estimate<=total:raise ValueError('Invalid total estimated abundance')
    for r in rows:
        if r['taxonomy_lvl']!='S' or float(r['new_est_reads'])<0 or not 0<=float(r['fraction_total_reads'])<=1:
            raise ValueError('Invalid Bracken species estimate')
    checks['bracken_readlen'+str(length)]=dict(species_rows=len(rows),estimated_fragments=estimate,source_confidence=0.0)
(OUT/'versions/taxonomy_output_validation.json').write_text(json.dumps(checks,indent=2)+'\n')
print('Taxonomic output totals and formats validated; no read-level data exported.')
