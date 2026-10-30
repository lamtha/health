#!/usr/bin/env python3
"""Audit HUMAnN's packaged pathway/EC scope and export annotated gene candidates.

These database annotations are not experimentally validated functions in this
sample. The independently curated reference mapping remains a separate table.
No network access or read-level exports are performed.
"""
import bz2,collections,csv,gzip,re
from pathlib import Path
import humann.config as config
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'
complete=(ROOT/'analysis/work/humann/HUMANN_COMPLETE').exists()

def write(path,rows,fields):
    with path.open('w') as f:
        w=csv.DictWriter(f,delimiter='\t',fieldnames=fields,restval='NA');w.writeheader();w.writerows(rows)

def read_values(name):
    d={}
    if not complete:return d
    with (OUT/'functional'/name).open() as f:
        for line in f:
            if line.startswith('#') or not line.strip():continue
            key,value=line.rstrip().split('\t')[:2];d[key]=float(value)
    return d

definitions={}
for line in Path(config.metacyc_reactions_to_pathways).read_text().splitlines():
    key,definition=line.split('\t',1);definitions[key]=definition.strip()
path_values=read_values('pathway_abundance_rpk.tsv')
reported=collections.defaultdict(list)
for key in path_values:reported[key.partition('|')[0].split(':',1)[0]].append(key)
pathrows=[]
with gzip.open(config.pathway_name_mapping_file,'rt') as f:
    for line in f:
        key,name=line.rstrip().split('\t',1);n=name.lower();category=None
        if 'methanogenesis' in n or 'autotrophic methanogens' in n:category='methanogenesis'
        elif 'histamine' in n:category='histamine'
        elif 'taurine' in n and 'degradation' in n:category='taurine_related'
        elif 'sulfate reduction' in n:category='dissimilatory_sulfur' if 'dissimilatory' in n else 'assimilatory_sulfur_context'
        elif 'to butanoate' in n:category='butyrate_related'
        if category is None:continue
        definition=definitions.get(key)
        status='analysis_pending' if not complete else ('reported_by_HUMAnN' if reported[key] else ('not_reported_by_HUMAnN' if definition else 'not_modeled_in_this_HUMAnN_pathway_catalog'))
        pathrows.append(dict(category=category,pathway_id=key,packaged_name=name,
            modeled_in_packaged_definitions=bool(definition),definition=definition or 'NA',
            terminal_mcr_reaction_in_definition=('METHYL-COM-HTP-RXN' in definition) if definition else 'NA',
            sample_output_status=status,reported_community_and_stratum_rows=len(reported[key]) if complete else 'NA',
            interpretation='Catalog/inference audit; not a complete biochemical pathway or activity demonstration; unmodeled or unreported is not confirmed absence'))
write(OUT/'mechanism_pathway_catalog.tsv',pathrows,list(pathrows[0]))

# Explicit EC classes, with specificity caveats. Old/current Dsr identifiers
# are both audited because the installed annotation mappings predate 2023.
ecs={
 '3.5.1.24':('bile_salt_hydrolysis','Conventional BSH annotation; does not establish BwBSH1/2 or taurine-versus-glycine preference'),
 '2.6.1.77':('taurine_transamination','Tpa annotation alone does not establish downstream sulfide generation'),
 '1.4.99.2':('taurine_related','Taurine dehydrogenase annotation; not the Bilophila tpa-sarD-islAB route'),
 '1.8.99.3':('dissimilatory_sulfur','Obsolete EC identifier; substrate/direction and accessory proteins require verification'),
 '1.8.99.5':('dissimilatory_sulfur','Legacy Dsr EC identifier; current classification 1.8.1.22; not sufficient for net sulfide production'),
 '1.8.1.22':('dissimilatory_sulfur','Dsr-system annotation can occur in reductive or oxidative sulfur metabolism'),
 '1.8.1.2':('assimilatory_sulfur_context','Assimilatory sulfite reduction; not proof of respiratory or net released H2S'),
 '1.8.7.1':('assimilatory_sulfur_context','Ferredoxin-dependent sulfite reduction; not proof of net released H2S'),
 '4.4.1.15':('cysteine_sulfide_candidate','D-cysteine desulfhydrase annotation; substrate availability and activity unmeasured'),
 '4.4.1.28':('cysteine_sulfide_candidate','L-cysteine desulfidase annotation; substrate availability and activity unmeasured'),
 '4.4.1.1':('cysteine_sulfide_candidate','Multifunctional cystathionine gamma-lyase; cysteine side activity cannot be quantified from annotation'),
 '4.4.1.8':('cysteine_side_activity_context','Cystathionine beta-lyase annotation; cysteine side activity is enzyme-dependent and not established by this annotation'),
 '4.1.99.1':('cysteine_side_activity_context','Tryptophanase annotation; cysteine side activity is enzyme-dependent and not established by this annotation'),
 '2.8.1.2':('sulfur_transfer_context','3-mercaptopyruvate sulfurtransferase annotation; sulfur transfer is not itself proof of net free H2S generation'),
 '4.4.1.25':('cysteate_sulfonate_candidate','Cysteate sulfo-lyase releases sulfite; not the isethionate sulfite-lyase IslA'),
 '2.8.4.1':('terminal_methanogenesis','MCR enzyme-complex annotation; not necessarily mcrA-specific, and direction/activity unmeasured'),
 '4.1.1.22':('histamine_synthesis_candidate','Histidine decarboxylase annotation requires substrate-specific sequence evidence'),
 '1.4.3.21':('amine_oxidation_context','Broad primary-amine oxidase; does not establish histamine specificity or anaerobic clearance'),
 '1.4.3.22':('histamine_oxidation_candidate','Diamine oxidase annotation requires oxygen; not an estimate of host DAO or in vivo clearance'),
 '2.1.1.8':('histamine_methylation_candidate','Histamine N-methyltransferase annotation; not complete histamine mineralization'),
 '3.2.1.18':('mucin_glycan_candidate','Sialidase annotation alone does not establish mucin specificity or mucosal injury'),
 '3.2.1.51':('mucin_glycan_candidate','Alpha-L-fucosidase annotation alone does not establish mucin specificity'),
 '3.2.1.63':('mucin_glycan_candidate','1,2-alpha-L-fucosidase annotation alone does not establish mucin specificity'),
}
family_map=collections.defaultdict(list);catalog=[];seen=set()
with bz2.open(config.metacyc_gene_to_reactions,'rt') as f:
    for line in f:
        columns=line.rstrip().split('\t');reaction,ec=columns[:2]
        if ec not in ecs and not ec.startswith('3.1.6.'):continue
        category,caveat=ecs.get(ec,('sulfatase_context','Sulfatase annotation; substrate specificity and mucin relevance require independent validation'))
        families=[x for x in columns[2:] if x.startswith('UniRef90_')]
        seen.add(ec)
        item=dict(ec=ec,reaction_id=reaction,category=category,uniref90_families_in_mapping=len(families),
                  mapping_status='present_in_packaged_mapping',specificity_caveat=caveat)
        catalog.append(item)
        for family in families:family_map[family].append(item)
for ec,(category,caveat) in ecs.items():
    if ec not in seen:catalog.append(dict(ec=ec,reaction_id='NA',category=category,uniref90_families_in_mapping=0,
        mapping_status='EC_not_in_packaged_mapping',specificity_caveat=caveat))
write(OUT/'mechanism_reaction_catalog.tsv',catalog,list(catalog[0]))
if complete:
    rpk=read_values('gene_families_rpk.tsv');cpm=read_values('gene_families_cpm.tsv');rows=[]
    for key,value in rpk.items():
        family,sep,stratum=key.partition('|');family=family.split(':',1)[0]
        for item in family_map.get(family,[]):
            rows.append(dict(sample=SAMPLE,gene_family=family,organism_stratum=stratum if sep else 'community_unstratified',
                abundance_rpk=value,abundance_cpm=cpm.get(key,'NA'),ec=item['ec'],reaction_id=item['reaction_id'],
                category=item['category'],evidence_quality='HUMAnN_homology_and_packaged_annotation_only',
                specificity_caveat=item['specificity_caveat'],sample_function_experimentally_validated='no',
                read_depth='not_measured_by_this_export',nucleotide_breadth='not_measured_by_this_export',
                per_gene_sequence_identity='not_measured_by_this_export'))
    fields=['sample','gene_family','organism_stratum','abundance_rpk','abundance_cpm','ec','reaction_id','category','evidence_quality',
            'specificity_caveat','sample_function_experimentally_validated','read_depth','nucleotide_breadth','per_gene_sequence_identity']
    write(OUT/'mechanism_gene_families.tsv',rows,fields)
print('Exported pathway/reaction catalog audit'+(' and measured gene-family annotations.' if complete else '; sample functional results remain pending.'))
