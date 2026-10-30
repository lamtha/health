#!/usr/bin/env python3
"""Export only measured QC values; a pending stage is never represented by zero."""
import csv, json, shutil, zipfile
from datetime import datetime, timezone
from pathlib import Path

from workspace_config import ROOT, SAMPLE
OUT = ROOT / 'results'

def write_tsv(path, rows, fields):
    with path.open('w') as f:
        w = csv.DictWriter(f, delimiter='\t', fieldnames=fields, restval='NA', extrasaction='ignore')
        w.writeheader(); w.writerows(rows)

def main():
    inv = json.loads((OUT / 'input_inventory.json').read_text())
    files = inv['files']
    n = sum(x['reads'] for x in files)
    bases = sum(x['bases'] for x in files)
    rows = [dict(sample=SAMPLE, stage='raw', status='complete', reads=n, pairs=n//2, bases=bases,
                 retained_reads_pct_previous=100, retained_reads_pct_raw=100,
                 q20_pct=100*sum(x['q20_bases'] for x in files)/bases,
                 q30_pct=100*sum(x['q30_bases'] for x in files)/bases,
                 notes='All mate IDs matched; both gzip streams validated to EOF; read lengths are recorded in input_inventory.json')]
    fp = ROOT / 'analysis/work/qc/fastp.json'
    if fp.exists():
        d=json.loads(fp.read_text()); x=d['summary']['after_filtering']
        rows.append(dict(sample=SAMPLE,stage='quality_filtered',status='complete',reads=x['total_reads'],
                         pairs=x['total_reads']//2,bases=x['total_bases'],
                         retained_reads_pct_previous=100*x['total_reads']/n,
                         retained_reads_pct_raw=100*x['total_reads']/n,
                         q20_pct=100*x['q20_rate'],q30_pct=100*x['q30_rate'],
                         notes='fastp; no deduplication; paired reads only'))
    else: rows.append(dict(sample=SAMPLE,stage='quality_filtered',status='pending'))
    nh=OUT/'nonhost_read_stats.tsv'
    if (ROOT/'analysis/work/nonhost/HOST_COMPLETE').exists() and nh.exists():
        x=list(csv.DictReader(nh.open(),delimiter='\t'))
        nr=sum(int(a['num_seqs']) for a in x); nb=sum(int(a['sum_len']) for a in x)
        rows.append(dict(sample=SAMPLE,stage='host_depleted',status='complete',reads=nr,pairs=nr//2,bases=nb,
                         retained_reads_pct_previous=100*nr/rows[-1]['reads'],retained_reads_pct_raw=100*nr/n,
                         notes='Both mates retained only when neither maps to GRCh38 no-alt plus decoys; residual host DNA cannot be excluded'))
    else: rows.append(dict(sample=SAMPLE,stage='host_depleted',status='pending_reference_download',
                           notes='Not yet run; no host fraction or microbial result is available'))
    fields=['sample','stage','status','reads','pairs','bases','retained_reads_pct_previous','retained_reads_pct_raw','q20_pct','q30_pct','notes']
    write_tsv(OUT/'qc_summary.tsv',rows,fields)
    fastqc=[]
    for stage in ['raw','filtered']:
        for p in (ROOT/f'analysis/work/qc/{stage}').glob('*_fastqc.zip'):
            with zipfile.ZipFile(p) as z:
                name=next(n for n in z.namelist() if n.endswith('/summary.txt'))
                for line in z.read(name).decode().splitlines():
                    status,module,sample=line.split('\t')
                    fastqc.append(dict(stage=stage,file=sample,module=module,status=status))
    write_tsv(OUT/'qc/fastqc_checks.tsv',fastqc,['stage','file','module','status'])
    stages=[('pair_validation',OUT/'input_inventory.json'),('quality_control',ROOT/'analysis/work/qc/QC_COMPLETE'),
            ('host_removal',ROOT/'analysis/work/nonhost/HOST_COMPLETE'),('taxonomy',ROOT/'analysis/work/taxonomy/TAXONOMY_COMPLETE'),
            ('marker_taxonomy',ROOT/'analysis/work/metaphlan/METAPHLAN_COMPLETE'),
            ('humann',ROOT/'analysis/work/humann/HUMANN_COMPLETE'),('targeted_mapping',ROOT/'analysis/work/targeted/TARGETED_COMPLETE')]
    stages.append(('pathway_gapfill_sensitivity',ROOT/'analysis/work/humann_no_gapfill/NO_GAPFILL_COMPLETE'))
    now=datetime.now(timezone.utc).isoformat()
    write_tsv(OUT/'analysis_status.tsv',[dict(stage=s,status='complete' if p.exists() else 'pending',updated_utc=now) for s,p in stages],['stage','status','updated_utc'])
    print('QC/status tables updated; completed stages: '+', '.join(s for s,p in stages if p.exists()))

if __name__=='__main__':main()
