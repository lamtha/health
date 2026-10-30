#!/usr/bin/env python3
"""Record actual full-run settings and hashes of selected public pangenomes."""
import csv,hashlib,json
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
log=ROOT/'analysis/logs/humann_internal.log'
lines=log.read_text().splitlines();settings={}
for line in lines:
    if ' = ' in line and ' - ' not in line:
        key,value=line.split(' = ',1);settings[key.strip()]=value.strip()
expected={'bypass prescreen':'False','bypass nucleotide index':'False',
    'bypass nucleotide search':'False','bypass translated search':'False','translated search':'diamond',
    'threads':'8','search mode':'uniref90','minpath':'on','xipe':'off','gap fill':'on'}
for key,value in expected.items():
    if settings.get(key)!=value:raise ValueError('Unexpected full-run setting: '+key)
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(8<<20),b''):h.update(b)
    return h.hexdigest()
selected=sorted({l.split('Adding file to database: ',1)[1] for l in lines if 'Adding file to database: ' in l})
if not selected:raise ValueError('No selected pangenomes recorded')
records=[]
for name in selected:
    p=ROOT/'analysis/databases/humann/chocophlan'/name
    records.append(dict(public_pangenome_file=name,bytes=p.stat().st_size,sha256=sha(p)))
with (OUT/'versions/humann_selected_pangenomes.tsv').open('w') as f:
    w=csv.DictWriter(f,delimiter='\t',fieldnames=list(records[0]));w.writeheader();w.writerows(records)
complete=(ROOT/'analysis/work/humann/HUMANN_COMPLETE').exists()
record=dict(full_run_complete=complete,actual_settings=settings,selected_pangenome_files=len(records),
    selected_pangenome_interpretation='Reference selection; not a count of independently confirmed sample organisms',
    measured_taxonomic_profile_sha256=sha(OUT/'taxonomy/metaphlan_profile.tsv'),
    launcher_sha256=sha(OUT/'scripts/humann_with_metaphlan_version_compat.py'),
    full_run_log_sha256=sha(log),
    successful_nucleotide_prepass=(ROOT/'analysis/work/humann/NUCLEOTIDE_COMPLETE').exists(),
    no_gapfill_reconstruction_complete=(ROOT/'analysis/work/humann_no_gapfill/NO_GAPFILL_COMPLETE').exists(),
    completed_stage_timing_lines=[l for l in lines if 'TIMESTAMP: Completed' in l],
    compatibility_adjustment="Version metadata parser only: config.metaphlan_version['line']=0; scientific algorithms unchanged")
if record['no_gapfill_reconstruction_complete']:
    ng_log=ROOT/'analysis/logs/humann_no_gapfill_internal.log'
    ng_lines=ng_log.read_text().splitlines();ng_settings={}
    for line in ng_lines:
        if ' = ' in line and ' - ' not in line:
            key,value=line.split(' = ',1);ng_settings[key.strip()]=value.strip()
    for key,value in {'gap fill':'off','minpath':'on','xipe':'off','search mode':'uniref90','input file format':'genetable'}.items():
        if ng_settings.get(key)!=value:raise ValueError('Unexpected no-gap-fill setting: '+key)
    for key in ['pathways database file 1','pathways database file 2']:
        if ng_settings.get(key)!=settings[key]:raise ValueError('No-gap-fill pathway mapping differs')
    record['no_gapfill_reconstruction']=dict(actual_settings=ng_settings,log_sha256=sha(ng_log),
        input_gene_family_rpk_sha256=sha(OUT/'functional/gene_families_rpk.tsv'),
        explanation='Reconstruction from the final gene table only; logged default DEMO sequence-database paths are unused; no sequence search is performed')
(OUT/'versions/humann_execution.json').write_text(json.dumps(record,indent=2)+'\n')
alignment_path=OUT/'versions/humann_alignment_settings.json'
alignment=json.loads(alignment_path.read_text())
numeric={'prescreen_threshold':'prescreen threshold','nucleotide_identity_threshold':'nucleotide identity threshold',
    'nucleotide_query_coverage_threshold':'nucleotide query coverage threshold','nucleotide_subject_coverage_threshold':'nucleotide subject coverage threshold',
    'identity_threshold_uniref90_mode':'translated identity threshold','translated_query_coverage_threshold':'translated query coverage threshold',
    'translated_subject_coverage_threshold':'translated subject coverage threshold','evalue_threshold':'evalue threshold'}
for key,logged in numeric.items():
    if float(alignment[key])!=float(settings[logged]):raise ValueError('Preflight/log setting mismatch: '+key)
if ' '.join(alignment['bowtie2_align_opts'])!=settings['bowtie2 options']:raise ValueError('Bowtie2 options differ')
if ' '.join(alignment['diamond_opts_uniref90'])!=settings['diamond options']:raise ValueError('DIAMOND options differ')
alignment.update(status='Verified against completed full-run log' if complete else 'Verified against actual full-run configuration; execution still in progress',
    minpath='on',xipe='off',primary_gap_fill='on',full_run_complete=complete)
alignment_path.write_text(json.dumps(alignment,indent=2)+'\n')
print('Recorded actual HUMAnN configuration and',len(records),'public pangenome hashes; full-run complete:',complete)
