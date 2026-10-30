#!/usr/bin/env python3
"""Check final table consistency and provenance, not biological/clinical truth."""
import collections,csv,json,math
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
def rows(name):return list(csv.DictReader((OUT/name).open(),delimiter='\t'))
def require(condition,message):
    if not condition:raise ValueError(message)
status=rows('analysis_status.tsv')
require(all(r['status']=='complete' for r in status),'A requested analysis stage is incomplete')
qc=rows('qc_summary.tsv');counts=[int(r['reads']) for r in qc]
require(all(counts[i]>=counts[i+1] for i in range(len(counts)-1)),'Read retention is not monotonic')
require(all(int(r['reads'])==2*int(r['pairs']) for r in qc),'Paired read totals disagree')
inventory=json.loads((OUT/'input_inventory.json').read_text())
require(counts[0]==sum(r['reads'] for r in inventory['files']),'Raw depth differs from the inventory')
total=int(qc[-1]['pairs'])
species=rows('species_abundance.tsv')
require(len(species)==len({r['taxonomy_id'] for r in species}),'Duplicate species identifiers')
for r in species:
    c=[int(r['kraken_conf'+x+'_species_clade_fragments']) for x in ['0_0','0_1','0_2']]
    require(total>=c[0]>=c[1]>=c[2]>=0,'Inconsistent classification threshold counts')
p=sum(float(r['relative_pct_among_estimated_nonhuman_species']) for r in species if r['relative_pct_among_estimated_nonhuman_species']!='NA')
require(abs(p-100)<1e-6,'Estimated nonhuman composition does not sum to 100%')
refs=rows('references/reference_manifest.tsv');genes=rows('gene_hits.tsv')
require({r['mapping_reference_id'] for r in refs}=={r['mapping_reference_id'] for r in genes},'Target panel and hit-table references differ')
require(len(genes)==len(refs)==len({r['target_id'] for r in genes}),'Duplicate/missing targeted reference rows')
metrics=json.loads((OUT/'versions/target_mapping_metrics.json').read_text())
require(sum(int(r['unique_mapped_reads']) for r in genes)==metrics['accepted_reads'],'Accepted targeted-read totals differ')
for r in genes:
    nr,nf=int(r['unique_mapped_reads']),int(r['unique_mapped_fragments'])
    require(0<=nf<=nr<=2*nf,'Target fragment/mate counts are inconsistent')
    require(0<=float(r['breadth_5x_pct'])<=float(r['breadth_1x_pct'])<=100,'Invalid target breadth')
    expected=nf*1e9/int(r['reference_nt_length'])/total
    require(abs(float(r['fragments_per_kb_per_million_nonhost_fragments'])-expected)<1e-6,'Target abundance denominator differs')
    if nr:require(float(r['aligned_read_sequence_identity_pct'])>=94.99999,'Target hit violates the identity threshold')
support=collections.Counter()
for r in rows('gene_taxonomic_support.tsv'):
    support[(r['target_id'],r['kraken_confidence_threshold'])]+=int(r['supporting_fragments'])
for r in genes:
    for c in ['0.1','0.2']:require(support[(r['target_id'],c)]==int(r['unique_mapped_fragments']),'Target/classifier join does not account for every supporting fragment')
def numeric_table(name,coverage=False):
    values={}
    for line in (OUT/'functional'/name).read_text().splitlines():
        if line.startswith('#') or not line:continue
        key,value=line.split('\t')[:2];value=float(value)
        require(key not in values,'Duplicate functional feature: '+name)
        require(math.isfinite(value) and value>=0,'Invalid functional value: '+name)
        if coverage:require(value<=1.00000001,'Coverage exceeds one: '+name)
        values[key]=value
    require(bool(values),'Empty functional table: '+name)
    return values
functional_counts={}
for name in ['gene_families_rpk.tsv','gene_families_cpm.tsv','pathway_abundance_rpk.tsv','pathway_abundance_cpm.tsv',
             'pathway_coverage.tsv','pathway_abundance_no_gapfill_rpk.tsv','pathway_coverage_no_gapfill.tsv']:
    values=numeric_table(name,coverage='coverage' in name);functional_counts[name]=len(values)
    if '_cpm' in name:
        community=sum(v for k,v in values.items() if '|' not in k)
        require(abs(community-1e6)<1.0,'Community CPM total differs from one million: '+name)
gene_values=numeric_table('gene_families_rpk.tsv');strata=collections.defaultdict(float)
for key,value in gene_values.items():
    family,separator,_=key.partition('|')
    if separator:strata[family]+=value
for family,value in strata.items():
    require(family in gene_values and value<=gene_values[family]+max(1e-5,1e-7*gene_values[family]),'Species strata exceed the community gene-family total')
require(all(r['gap_fill_off_status']!='pending' for r in rows('pathways.tsv')),'Gap-fill comparison is still pending')
require(all(r['sample_output_status']!='analysis_pending' for r in rows('mechanism_pathway_catalog.tsv')),'Mechanism catalog is stale')
execution=json.loads((OUT/'versions/humann_execution.json').read_text())
require(execution['full_run_complete'] and execution['no_gapfill_reconstruction_complete'],'HUMAnN provenance is incomplete/stale')
bridge=rows('curated_reference_humann_matches.tsv')
require({r['target_id'] for r in bridge}=={r['target_id'] for r in refs},'Curated accession bridge does not account for the full panel')
gene_cpm=numeric_table('gene_families_cpm.tsv')
for r in bridge:
    if r['bridge_status']!='exact_reference_representative_ID_reported':continue
    require(r['gene_family']=='UniRef90_'+r['uniprot_accession'],'Curated bridge accession differs')
    key=r['gene_family']+('' if r['organism_stratum']=='community_unstratified' else '|'+r['organism_stratum'])
    require(key in gene_values and float(r['abundance_rpk'])==gene_values[key] and float(r['abundance_cpm'])==gene_cpm[key],'Curated bridge does not match full functional tables')
for name in ['chocophlan','uniref90']:
    require(json.loads((OUT/f'versions/{name}_verification.json').read_text())['gzip_eof_crc_verified'],'Public reference archive integrity was not verified')
require('analysis in progress' not in (OUT/'summary.md').read_text().lower(),'Summary has not undergone final review')
require('**Status: in progress.**' not in (OUT/'methods.md').read_text(),'Methods still describe an unfinished run')
result=dict(internal_consistency_checks_passed=True,nonhost_fragments=total,species_rows=len(species),target_reference_rows=len(genes),
    functional_rows=functional_counts,interpretation='Format, count, normalization and provenance checks only; not proof of biological activity or clinical validity')
(OUT/'versions/result_validation.json').write_text(json.dumps(result,indent=2)+'\n')
print('Final table consistency, normalization and provenance checks passed.')
