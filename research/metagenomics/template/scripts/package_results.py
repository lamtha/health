#!/usr/bin/env python3
"""Package an explicit allowlist of small results, never reads or private QC HTML.

Run only after scientific review updates summary.md and methods.md. This script
refuses pending analysis stages or an in-progress summary.
"""
import csv,hashlib,json,zipfile
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
status=list(csv.DictReader((OUT/'analysis_status.tsv').open(),delimiter='\t'))
if any(x['status']!='complete' for x in status):raise SystemExit('Cannot package: analysis stages incomplete')
if 'analysis in progress' in (OUT/'summary.md').read_text().lower():raise SystemExit('Scientific review still pending')
if '**Status: in progress.**' in (OUT/'methods.md').read_text():raise SystemExit('Methods still describe an incomplete analysis')
if not (OUT/'versions/result_validation.json').exists():raise SystemExit('Run validate_result_tables.py after final review before packaging')
required=['qc_summary.tsv','species_abundance.tsv','gene_hits.tsv','pathways.tsv','summary.md','methods.md']
if any(not (OUT/p).exists() for p in required):raise SystemExit('Required result missing')
paths=[]
for p in OUT.iterdir():
    if p.is_file() and p.suffix in ['.tsv','.md','.json'] and p.name!='package_manifest.json':paths.append(p)
for directory,suffixes in [('scripts',{'.py','.sh'}),('references',{'.tsv','.json','.fna','.faa'}),
                            ('versions',{'.json','.txt','.tsv'}),('functional',{'.tsv'}),('taxonomy',{'.tsv'}),
                            ('figures',{'.png','.pdf'})]:
    paths.extend(p for p in (OUT/directory).glob('*') if p.is_file() and p.suffix in suffixes)
paths.append(OUT/'qc/fastqc_checks.tsv')
paths=sorted(set(paths));manifest=[]
for p in paths:
    if p.stat().st_size>200_000_000:raise ValueError('Unexpectedly large result: '+str(p))
    if p.suffix in ['.fna','.faa'] and p.parent!=OUT/'references':raise ValueError('Unapproved sequence file')
    manifest.append(dict(path=str(p.relative_to(OUT)),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
(OUT/'package_manifest.json').write_text(json.dumps(dict(sample=SAMPLE,contains_sample_reads=False,
    sequence_files='Only accession-verified public microbial reference sequences',files=manifest),indent=2)+'\n')
archive=OUT/(SAMPLE+'_small_results.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as z:
    for p in paths+[OUT/'package_manifest.json']:z.write(p,str(p.relative_to(OUT)))
with zipfile.ZipFile(archive)as z:
    assert z.testzip()is None
    assert not any(n.endswith(('.fastq','.fq','.fastq.gz','.fq.gz','.bam','.sam','.cram')) for n in z.namelist())
print(archive,archive.stat().st_size,'bytes; no sample reads or private read-level intermediates')
