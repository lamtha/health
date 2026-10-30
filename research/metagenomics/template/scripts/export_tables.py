#!/usr/bin/env python3
"""Export measured taxonomic, pathway and ecological tables; never fill pending with zero."""
import csv,collections,json,math
from pathlib import Path
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results'

def write(name,rows,fields=None):
    if not rows and fields is None:raise ValueError('No rows for '+name)
    with (OUT/name).open('w')as f:
        w=csv.DictWriter(f,delimiter='\t',fieldnames=fields or list(rows[0]),restval='NA',extrasaction='ignore');w.writeheader();w.writerows(rows)

def report(path):
    d={}
    with path.open()as f:
        for line in f:
            c=line.rstrip('\n').split('\t')
            if len(c)!=6:raise ValueError('Unexpected Kraken report format')
            d[c[4]]=dict(fraction=float(c[0])/100,clade=int(c[1]),direct=int(c[2]),rank=c[3],name=c[5].strip())
    return d

def taxonomy():
    if not (ROOT/'analysis/work/taxonomy/TAXONOMY_COMPLETE').exists():return
    r0=report(OUT/'taxonomy/kraken_conf0.0.report.tsv')
    r1=report(OUT/'taxonomy/kraken_conf0.1.report.tsv');r2=report(OUT/'taxonomy/kraken_conf0.2.report.tsv')
    br={}
    for length in [100,150]:
        br[length]={r['taxonomy_id']:r for r in csv.DictReader((OUT/f'taxonomy/bracken_species_readlen{length}.tsv').open(),delimiter='\t')}
    nh=list(csv.DictReader((OUT/'nonhost_read_stats.tsv').open(),delimiter='\t'));total=sum(int(x['num_seqs']) for x in nh)//2
    ids={t for t,r in r0.items() if r['rank']=='S'}|{t for t,r in r1.items() if r['rank']=='S'}|set(br[100])|set(br[150])
    parent={};ranks={};names={}
    db=ROOT/'analysis/databases/kraken/pluspf_16_GB_20260626'
    with (db/'nodes.dmp').open()as f:
        for line in f:
            c=[x.strip() for x in line.split('|')];parent[c[0]]=c[1];ranks[c[0]]=c[2]
    needed=set(ids)
    for t in list(ids):
        while t in parent and parent[t]!=t:
            t=parent[t];needed.add(t)
    with (db/'names.dmp').open()as f:
        for line in f:
            c=[x.strip() for x in line.split('|')]
            if c[0]in needed and c[3]=='scientific name':names[c[0]]=c[1]
    def lineage(t):
        line=[];visited=set()
        while t in parent and t not in visited:
            visited.add(t);line.append((t,ranks[t],names.get(t,t)));t=parent[t]
        return list(reversed(line))
    rows=[]
    for t in ids:
        a=r1.get(t,{});b=r2.get(t,{});x=br[150].get(t,{});y=br[100].get(t,{})
        c1=a.get('clade',0);c2=b.get('clade',0);est=float(x['new_est_reads']) if x else 'NA'
        lin=lineage(t);nonhuman=all(z[0]!='9606'for z in lin)
        rows.append(dict(sample=SAMPLE,taxonomy_id=t,species=names.get(t,a.get('name',x.get('name','unresolved'))),
            domain=next((z[2] for z in lin if z[0]in ['2','2157','2759','10239']),'unresolved'),
            lineage=';'.join(z[1]+':'+z[2] for z in lin),nonhuman=str(nonhuman).lower(),
            kraken_conf0_0_species_clade_fragments=r0.get(t,{}).get('clade',0),
            kraken_conf0_1_species_clade_fragments=c1,kraken_conf0_1_species_direct_fragments=a.get('direct',0),
            kraken_conf0_1_paired_read_equivalents=2*c1,kraken_conf0_2_species_clade_fragments=c2,
            fraction_of_nonhost_library_classified_to_species=c1/total,
            confidence_threshold_retention_ratio=c2/c1 if c1 else 'NA',
            classification_support='at_least_10_fragments_at_both_thresholds' if min(c1,c2)>=10 else 'low_count_or_threshold_sensitive',
            bracken_source_kraken_confidence=0.0,bracken_estimated_fragments_150=est,bracken_fraction_reported_150=x.get('fraction_total_reads','NA'),
            bracken_estimated_fraction_of_nonhost_library_150=est/total if x else 'NA',
            bracken_estimated_fragments_100=float(y['new_est_reads']) if y else 'NA',
            bracken_status_150='estimated' if x else 'not_estimated_below_threshold_or_unresolved',
            confidence_probability='not_calibrated',absence_interpretation='no_confirmed_absence_claim'))
    denom=sum(r['bracken_estimated_fragments_150']for r in rows if r['nonhuman']=='true' and r['bracken_status_150']=='estimated')
    for r in rows:r['relative_pct_among_estimated_nonhuman_species']=100*r['bracken_estimated_fragments_150']/denom if denom and r['nonhuman']=='true' and r['bracken_status_150']=='estimated' else 'NA'
    rows.sort(key=lambda r:r['bracken_estimated_fragments_150'] if r['bracken_status_150']=='estimated' else 0,reverse=True);write('species_abundance.tsv',rows)
    allrows=[]
    for confidence,table in [(0.0,r0),(0.1,r1),(0.2,r2)]:
        for t,a in table.items():allrows.append(dict(kraken_confidence_threshold=confidence,taxonomy_id=t,rank=a['rank'],name=a['name'],clade_fragments=a['clade'],direct_fragments=a['direct'],fraction_of_library=a['clade']/total))
    write('taxonomy/all_taxa_counts.tsv',allrows)
    p=[r['bracken_estimated_fragments_150']/denom for r in rows if r['nonhuman']=='true' and r['bracken_status_150']=='estimated' and r['bracken_estimated_fragments_150']>0] if denom else []
    ecology=[dict(metric='observed_estimated_nonhuman_species',value=len(p),basis='Bracken150; threshold10; includes low-confidence assignments; not confirmed species richness'),
             dict(metric='shannon_species_composition',value=-sum(x*math.log(x)for x in p),basis='Natural log; Bracken estimated composition including low-confidence assignments; not a health score'),
             dict(metric='inverse_simpson_species_composition',value=1/sum(x*x for x in p) if p else 'NA',basis='Bracken150 composition including low-confidence assignments; not a health score'),
             dict(metric='unclassified_fragment_fraction',value=r1.get('0',{}).get('clade',0)/total,basis='Kraken confidence0.1'),
             dict(metric='unclassified_fragment_fraction_conf0',value=r0.get('0',{}).get('clade',0)/total,basis='Kraken confidence0.0; Bracken input'),
             dict(metric='unclassified_fragment_fraction_conf0_2',value=r2.get('0',{}).get('clade',0)/total,basis='Kraken confidence0.2; especially stringent with this capped database'),
             dict(metric='species_with_at_least_10_fragments_at_conf0_1_and_conf0_2',value=sum(r['classification_support']=='at_least_10_fragments_at_both_thresholds' for r in rows),basis='Conservative classification-support subset; not validated species richness'),
             dict(metric='reference_based_depletion_assessable',value='no',basis='No matched healthy comparator or longitudinal baseline supplied')]
    write('ecology_metrics.tsv',ecology)
    patterns=['Faecalibacterium','Roseburia','Agathobacter','Anaerobutyricum','Eubacterium rectale','Bifidobacterium','Akkermansia','Butyricicoccus','Coprococcus']
    comm=[dict(species=r['species'],taxonomy_id=r['taxonomy_id'],relative_pct_among_estimated_nonhuman_species=r['relative_pct_among_estimated_nonhuman_species'],
               kraken_conf0_1_fragments=r['kraken_conf0_1_species_clade_fragments'],kraken_conf0_2_fragments=r['kraken_conf0_2_species_clade_fragments'],
               classification_support=r['classification_support'],bracken_status=r['bracken_status_150'],
               interpretation='Context-dependent commensal reference label; weak assignments are not confirmed presence; protection/depletion not established')
          for r in rows if any(s in r['species']for s in patterns)]
    write('commensal_context.tsv',comm,['species','taxonomy_id','relative_pct_among_estimated_nonhuman_species','kraken_conf0_1_fragments','kraken_conf0_2_fragments','classification_support','bracken_status','interpretation'])

def humann_table(name):
    d={}
    with (OUT/'functional'/name).open()as f:
        for line in f:
            if line.startswith('#')or not line.strip():continue
            c=line.rstrip('\n').split('\t')
            try:d[c[0]]=float(c[1])
            except (ValueError,IndexError):continue
    return d

def functional():
    if not (ROOT/'analysis/work/humann/HUMANN_COMPLETE').exists():return
    abundance=humann_table('pathway_abundance_rpk.tsv');cpm=humann_table('pathway_abundance_cpm.tsv');cov=humann_table('pathway_coverage.tsv')
    no_gap_complete=(ROOT/'analysis/work/humann_no_gapfill/NO_GAPFILL_COMPLETE').exists()
    ng_ab=humann_table('pathway_abundance_no_gapfill_rpk.tsv') if no_gap_complete else {}
    ng_cov=humann_table('pathway_coverage_no_gapfill.tsv') if no_gap_complete else {}
    rows=[]
    for key in sorted(set(abundance)|set(cov)|set(ng_ab)|set(ng_cov)):
        pathway,sep,organism=key.partition('|')
        rows.append(dict(sample=SAMPLE,method='HUMAnN3.9_MetaCyc',pathway=pathway,
                         feature_type='special_summary' if pathway in ['UNMAPPED','UNINTEGRATED','UNGROUPED'] else 'MetaCyc_pathway',
                         organism_stratum=organism if sep else 'community_unstratified',abundance_rpk=abundance.get(key,0),
                         abundance_cpm=cpm.get(key,0),humann_pathway_coverage=cov.get(key,'NA'),
                         minpath_enabled=True,primary_gap_fill_enabled=True,
                         abundance_rpk_gap_fill_off=ng_ab.get(key,0) if no_gap_complete else 'NA',
                         coverage_gap_fill_off=ng_cov.get(key,'NA'),
                         gap_fill_off_status=('reported' if key in ng_ab or key in ng_cov else 'not_reported') if no_gap_complete else 'pending',
                         coverage_meaning='HUMAnN inferred pathway support; not nucleotide breadth or intact-operon proof',
                         activity_demonstrated='no',absence_interpretation='No confirmed absence; reference/depth/algorithm dependent'))
    write('pathways.tsv',rows)
    genes=humann_table('gene_families_cpm.tsv');values=[v for k,v in genes.items() if '|' not in k and k not in ['UNMAPPED','UNINTEGRATED'] and v>0]
    s=sum(values);p=[v/s for v in values] if s else []
    write('functional_diversity.tsv',[dict(metric='observed_unstratified_gene_families',value=len(values),basis='HUMAnN UniRef90; no healthy reference comparison'),
        dict(metric='shannon_gene_family_composition',value=-sum(x*math.log(x)for x in p),basis='Natural log of normalized gene-family composition; sequencing-depth dependent')])

if __name__=='__main__':taxonomy();functional()
