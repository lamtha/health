#!/usr/bin/env python3
"""Export measured MetaPhlAn species representatives with their original scale.

NCBI identifiers and merged-species annotations are preserved without guessing
species names for unnamed SGBs. No sample sequences or read IDs are exported.
"""
import csv,json,math
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
if not (ROOT/'analysis/work/metaphlan/METAPHLAN_COMPLETE').exists():
    raise SystemExit('Marker taxonomy has not completed')
profile=OUT/'taxonomy/metaphlan_profile.tsv'
rows=[];unknown=None;processed=None;database=None;header=None
for line in profile.read_text().splitlines():
    if line.startswith('#mpa_'):database=line[1:]
    if line.endswith(' reads processed'):processed=int(line[1:].split()[0])
    if line.startswith('#clade_name'):header=line[1:].split('\t');continue
    if line.startswith('#') or not line:continue
    if not header:raise ValueError('Profile header not found')
    data=dict(zip(header,line.split('\t')))
    clade=data['clade_name'];value=float(data['relative_abundance'])
    if not math.isfinite(value) or not 0<=value<=100:raise ValueError('Invalid marker abundance')
    if clade=='UNCLASSIFIED':unknown=value
    terminal=clade.split('|')[-1]
    if not terminal.startswith('s__'):continue
    taxid=data['NCBI_tax_id'].split('|')[-1]
    rows.append(dict(sample=SAMPLE,method='MetaPhlAn4.2.5',database=database,
        representative_species_or_SGB=terminal[3:],ncbi_taxonomy_id=taxid or 'NA',
        full_clade=clade,relative_abundance_pct_as_reported=value,
        additional_merged_species=data.get('additional_species','') or 'none_reported',
        abundance_scale='Original MetaPhlAn profile scale including its UNCLASSIFIED estimate; not a Kraken read fraction',
        confidence_probability='not_calibrated',absence_interpretation='Unreported taxa are not confirmed absent'))
if not rows:raise ValueError('No species representative rows; inspect profile')
if len({r['full_clade'] for r in rows})!=len(rows):raise ValueError('Duplicate species representative row')
total=sum(r['relative_abundance_pct_as_reported'] for r in rows)
if unknown is not None and abs(total+unknown-100)>0.01:raise ValueError('Species plus unclassified marker abundance does not sum to 100%')
expected=sum(int(r['num_seqs']) for r in csv.DictReader((OUT/'nonhost_read_stats.tsv').open(),delimiter='\t'))
if processed!=expected:raise ValueError('MetaPhlAn processed-read count differs from the nonhost input')
rows.sort(key=lambda r:r['relative_abundance_pct_as_reported'],reverse=True)
with (OUT/'taxonomy/metaphlan_species_abundance.tsv').open('w') as f:
    w=csv.DictWriter(f,delimiter='\t',fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
p=[r['relative_abundance_pct_as_reported']/total for r in rows if r['relative_abundance_pct_as_reported']>0]
ecology=[dict(metric='reported_species_or_SGB_representatives',value=len(rows),basis='MetaPhlAn markers; includes unnamed SGB representatives; not exhaustive richness'),
    dict(metric='unclassified_estimate_pct',value=unknown,basis='MetaPhlAn estimate; not a directly classified-read fraction'),
    dict(metric='shannon_identified_representative_composition',value=-sum(v*math.log(v) for v in p),basis='Natural log; renormalized within identified representatives for this diversity calculation only; unclassified estimate excluded; not a health score'),
    dict(metric='inverse_simpson_identified_representative_composition',value=1/sum(v*v for v in p),basis='Identified representatives only; unclassified estimate excluded; not a health score')]
with (OUT/'taxonomy/metaphlan_ecology.tsv').open('w') as f:
    w=csv.DictWriter(f,delimiter='\t',fieldnames=['metric','value','basis']);w.writeheader();w.writerows(ecology)
(OUT/'versions/marker_taxonomy_validation.json').write_text(json.dumps(dict(database=database,
    processed_reads=processed,expected_reads=expected,species_representative_rows=len(rows),
    species_abundance_sum_pct=total,unclassified_estimate_pct=unknown,
    scale='As reported by MetaPhlAn, without renormalizing away the unclassified estimate'),indent=2)+'\n')
print('Validated and exported',len(rows),'MetaPhlAn species/SGB representatives.')
