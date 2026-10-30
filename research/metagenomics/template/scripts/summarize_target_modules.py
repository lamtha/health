#!/usr/bin/env python3
"""Report co-detection of surveyed core genes, never call an active/intact pathway."""
import csv,json
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
if not (ROOT/'analysis/work/targeted/TARGETED_COMPLETE').exists():raise SystemExit('Targeted analysis is not complete')
genes=list(csv.DictReader((OUT/'gene_hits.tsv').open(),delimiter='\t'))
rules=[
 ('Bilophila_bile_taurine_to_sulfide_surveyed_core','Bilophila wadsworthia',[['BwBSH1','BwBSH2'],['tpa'],['sarD'],['islA'],['islB'],['dsrA'],['dsrB']]),
 ('Bilophila_taurine_to_sulfide_surveyed_core','Bilophila wadsworthia',[['tpa'],['sarD'],['islA'],['islB'],['dsrA'],['dsrB']]),
 ('Bilophila_sulfite_reductase_core','Bilophila wadsworthia',[['dsrA'],['dsrB']]),
 ('Salmonella_asr_sulfite_reductase_core','Salmonella',[['asrA'],['asrB'],['asrC']]),
 ('Salmonella_thiosulfate_reductase_core','Salmonella',[['phsA'],['phsB'],['phsC']]),
 ('M_smithii_terminal_methanogenesis_complex','Methanobrevibacter smithii',[['mcrA'],['mcrB'],['mcrG']]),
 ('M_stadtmanae_terminal_methanogenesis_complex','Methanosphaera stadtmanae',[['mcrA'],['mcrB'],['mcrG']]),
 ('M_luminyensis_terminal_methanogenesis_complex','Methanomassiliicoccus luminyensis',[['mcrA'],['mcrB'],['mcrG']]),
 ('L_reuteri_histamine_synthesis_module','Lactobacillus reuteri',[['hdcA'],['hdcB'],['hdcP']]),
 ('P_putida_histamine_initial_hin_locus','Pseudomonas putida',[['hinA'],['hinB'],['hinC'],['hinD']]),
]
out=[]
for name,organism,steps in rules:
    selected=[g for g in genes if organism in g['reference_source_organism'] and g['reference_role']=='target']
    supported=[];broad=[];abund=[];details=[]
    for alternatives in steps:
        candidates=[g for g in selected if g['gene']in alternatives]
        some=any(g['detection_call']in ['broad_reference_coverage','substantial_partial_coverage','partial_reference_evidence','partial_reference_only']for g in candidates)
        high=any(g['detection_call']=='broad_reference_coverage'for g in candidates)
        supported.append(some);broad.append(high)
        abund.append(max([float(g['fragments_per_kb_per_million_nonhost_fragments'])for g in candidates]or[0]))
        details.append({'alternatives':alternatives,'reference_ids':[g['target_id']for g in candidates],'some_qualifying_support':some,'broad_coverage':high})
    out.append(dict(sample=SAMPLE,module=name,reference_source_group=organism,required_surveyed_steps=len(steps),
                    steps_with_partial_or_better_evidence=sum(supported),steps_with_broad_reference_coverage=sum(broad),
                    surveyed_core_broad_coverage_fraction=sum(broad)/len(steps),
                    minimum_step_fragments_per_kb_per_million_nonhost_fragments=min(abund),
                    result='all_surveyed_core_steps_broadly_covered' if all(broad) else 'incomplete_evidence_for_surveyed_core',
                    steps=json.dumps(details,separators=(',',':')),same_genome_linkage_demonstrated='no',
                    complete_intact_pathway_demonstrated='no',activity_demonstrated='no',
                    limitation='Reference-specific co-detection only; marker set excludes some cofactors/electron-transfer/accessory requirements; do not infer active pathway or absence'))
with (OUT/'targeted_modules.tsv').open('w')as f:
    w=csv.DictWriter(f,delimiter='\t',fieldnames=list(out[0]));w.writeheader();w.writerows(out)
print('Exported',len(out),'surveyed-core marker modules')
