#!/usr/bin/env python3
"""Conservative competitive mapping metrics. No network access.

Read-level identity and coverage are not full-gene sequence identity. Species
labels describe reference origin; short-read mapping alone does not prove carrier.
"""
import collections, csv, itertools, json, math, statistics
from array import array
from pathlib import Path
import pysam
from coverage_evidence import coverage_evidence
from workspace_config import ROOT, SAMPLE;OUT=ROOT/'results';WORK=ROOT/'analysis/work/targeted'

def writer(path, rows, fields):
    with path.open('w') as f:
        w=csv.DictWriter(f,delimiter='\t',fieldnames=fields,restval='NA',extrasaction='ignore');w.writeheader();w.writerows(rows)

def frag_id(name):
    return name[:-2] if name.endswith(('/1','/2')) else name

def main():
    manifest=list(csv.DictReader((OUT/'references/reference_manifest.tsv').open(),delimiter='\t'))
    refs={r['mapping_reference_id']:int(r['reference_nt_length']) for r in manifest}
    depth={r:array('I',[0])*n for r,n in refs.items()}
    reads=collections.Counter();ambig=collections.Counter();frag={r:set() for r in refs};starts={r:set() for r in refs}
    matches=collections.Counter();aligned=collections.Counter();mapqs=collections.defaultdict(list)
    read_to_refs=collections.defaultdict(set);stats=collections.Counter()
    boundary_rejections=collections.Counter();max_query_length=0
    for mate in [1,2]:
        with pysam.AlignmentFile(WORK/f'mate{mate}.bam','rb') as bam:
            for name,group in itertools.groupby(bam.fetch(until_eof=True),key=lambda a:a.query_name):
                group=list(group);stats['mapped_read_groups']+=1
                # Compete against ALL alignments, even if a competing alignment
                # fails a threshold. This prevents dropping an inconvenient best hit.
                ordered=sorted(group,key=lambda a:a.get_tag('AS') if a.has_tag('AS') else -100000,reverse=True)
                best=ordered[0]
                if best.is_unmapped or best.is_supplementary:continue
                ref=best.reference_name
                cols=sum(n for op,n in best.cigartuples if op in (0,1,2,7,8))
                qspan=sum(n for op,n in best.cigartuples if op in (0,1,7,8))
                qlen=best.infer_read_length();nm=best.get_tag('NM')
                ident=1-nm/cols if cols else 0;qcov=qspan/qlen if qlen else 0
                max_query_length=max(max_query_length,qlen or 0)
                if ident<.95 or qcov<.90 or qspan<80:
                    stats['rejected_identity_length_or_query_coverage']+=1
                    scores=[a.get_tag('AS') for a in ordered[1:] if a.has_tag('AS')]
                    if best.has_tag('XS'):scores.append(best.get_tag('XS'))
                    gap=best.get_tag('AS')-max(scores) if scores else 100000
                    if ident>=.95 and qspan>=80 and qcov<.90 and gap>=10 and (best.mapping_quality==255 or best.mapping_quality>=20) and (best.reference_start==0 or best.reference_end==refs[ref]):
                        boundary_rejections[ref]+=1
                    continue
                other=[a.get_tag('AS') for a in ordered[1:] if a.has_tag('AS')]
                # Bowtie2 may report a second-best score beyond the -k output.
                if best.has_tag('XS'):other.append(best.get_tag('XS'))
                gap=best.get_tag('AS')-max(other) if other else 100000
                if gap<10 or (best.mapping_quality!=255 and best.mapping_quality<20):
                    stats['ambiguous_or_low_mapq_reads']+=1
                    for rr in set(a.reference_name for a in ordered if a.has_tag('AS') and best.get_tag('AS')-a.get_tag('AS')<10):
                        ambig[rr]+=1
                    continue
                stats['accepted_reads']+=1;reads[ref]+=1;fid=frag_id(name)
                frag[ref].add(fid);read_to_refs[fid].add(ref)
                starts[ref].add((best.reference_start,best.is_reverse,mate))
                matches[ref]+=cols-nm;aligned[ref]+=cols;mapqs[ref].append(best.mapping_quality)
                # Only aligned reference bases covered by read bases contribute.
                for q,r in best.get_aligned_pairs(matches_only=True):
                    if q is not None and r is not None:depth[ref][r]+=1
    nh=list(csv.DictReader((OUT/'nonhost_read_stats.tsv').open(),delimiter='\t'))
    total_reads=sum(int(x['num_seqs']) for x in nh);total_fragments=total_reads//2
    # Optional Kraken assignments add independent classifier evidence, never
    # convert reference-only mapping into a definitive strain/carrier assertion.
    tax=collections.defaultdict(collections.Counter)
    tax_species={c:collections.defaultdict(collections.Counter) for c in ['0.1','0.2']}
    tax_names={}
    kr=ROOT/'analysis/work/taxonomy/kraken_conf0.1.reads.tsv'
    if kr.exists():
        db=ROOT/'analysis/databases/kraken/pluspf_16_GB_20260626'
        parent={};ranks={};species_cache={}
        with (db/'nodes.dmp').open() as f:
            for line in f:
                c=[x.strip() for x in line.split('|')];parent[c[0]]=c[1];ranks[c[0]]=c[2]
        def species_ancestor(t):
            original=t;visited=set()
            while t in parent and t not in visited:
                if ranks[t]=='species':species_cache[original]=t;return t
                visited.add(t);t=parent[t]
            species_cache[original]='unresolved';return 'unresolved'
        for confidence in ['0.1','0.2']:
            path=ROOT/f'analysis/work/taxonomy/kraken_conf{confidence}.reads.tsv'
            if not path.exists():continue
            with path.open() as f:
                for line in f:
                    cols=line.rstrip('\n').split('\t');fid=frag_id(cols[1])
                    if fid in read_to_refs:
                        tid=cols[2];species=species_cache.get(tid) or species_ancestor(tid)
                        for ref in read_to_refs[fid]:
                            tax_species[confidence][ref][species]+=1
                            if confidence=='0.1':tax[ref][tid]+=1
        wanted={t for byref in tax_species.values() for counter in byref.values() for t in counter if t!='unresolved'}
        with (db/'names.dmp').open() as f:
            for line in f:
                c=[x.strip() for x in line.split('|')]
                if c[0]in wanted and c[3]=='scientific name':tax_names[c[0]]=c[1]
    output=[]
    for row in manifest:
        ref=row['mapping_reference_id'];d=depth[ref];length=len(d);nfrag=len(frag[ref]);nread=reads[ref]
        b1=sum(v>0 for v in d)/length;b5=sum(v>=5 for v in d)/length;mean=sum(d)/length
        partial=row['reference_partial']=='true'
        label=coverage_evidence(nread,nfrag,b1,mean,len(starts[ref]),partial,ambig[ref])
        interior=d[max_query_length:length-max_query_length] if length>2*max_query_length else []
        carrier='reference-compatible; actual carrier unresolved' if nread else 'unassigned'
        carrier_confidence='unresolved';carrier_taxid='NA';carrier_fraction='NA'
        candidates=[(t,n) for t,n in tax_species['0.2'][ref].items() if t!='unresolved']
        if candidates and nfrag:
            tid,support=max(candidates,key=lambda x:x[1]);fraction=support/nfrag
            carrier_taxid=tid;carrier_fraction=round(fraction,6)
            if support>=10 and fraction>=.8 and tax_species['0.1'][ref][tid]>=support:
                carrier='read-classifier-supported candidate: '+tax_names.get(tid,tid)
                carrier_confidence='moderate_taxonomic_support_without_assembly_linkage'
        result=dict(row, sample=SAMPLE,analysis_status='complete',**label,
                    interior_trim_nt=max_query_length,
                    interior_mean_read_depth=sum(interior)/len(interior) if interior else 'NA',
                    boundary_overhang_rejected_reads=boundary_rejections[ref],
                    full_gene_abundance_scope='strict CDS-reference index with gene-end loss; not an unbiased short-gene abundance estimate',unique_mapped_reads=nread,unique_mapped_fragments=nfrag,
                    ambiguous_candidate_reads=ambig[ref],distinct_alignment_start_strand_mates=len(starts[ref]),
                    mean_read_depth=round(mean,6),median_read_depth=statistics.median(d),
                    breadth_1x_pct=round(100*b1,4),breadth_5x_pct=round(100*b5,4),
                    aligned_read_sequence_identity_pct=round(100*matches[ref]/aligned[ref],5) if aligned[ref] else 'NA',
                    median_available_mapq=statistics.median([q for q in mapqs[ref] if q!=255]) if any(q!=255 for q in mapqs[ref]) else 'NA',
                    reads_with_mapq_unavailable_255=sum(q==255 for q in mapqs[ref]),
                    fragments_per_kb_per_million_nonhost_fragments=round(nfrag*1e9/length/total_fragments,8),
                    total_nonhost_fragments=total_fragments,
                    organism_assignment=carrier,organism_assignment_confidence=carrier_confidence,
                    dominant_supporting_species_taxid_conf0_2=carrier_taxid,dominant_species_fraction_of_all_supporting_fragments_conf0_2=carrier_fraction,
                    kraken_fragment_taxids=json.dumps(tax[ref].most_common(10),separators=(',',':')) if kr.exists() else 'not_yet_available',
                    supporting_fragment_species_conf0_1=json.dumps(tax_species['0.1'][ref].most_common(10),separators=(',',':')) if kr.exists() else 'not_yet_available',
                    supporting_fragment_species_conf0_2=json.dumps(tax_species['0.2'][ref].most_common(10),separators=(',',':')) if kr.exists() else 'not_yet_available',
                    intact_gene_demonstrated='no',active_pathway_demonstrated='no')
        output.append(result)
    writer(OUT/'gene_hits.tsv',output,list(output[0]))
    # Human-readable long table of carrier context. Unresolved fragments stay
    # in the denominator; these rows do not weaken the carrier reporting rule.
    support_rows=[]
    for row in manifest:
        ref=row['mapping_reference_id'];nfrag=len(frag[ref])
        for confidence in ['0.1','0.2']:
            counts=tax_species[confidence][ref]
            if (ROOT/'analysis/work/taxonomy/TAXONOMY_COMPLETE').exists() and sum(counts.values())!=nfrag:
                raise ValueError('Target/classifier fragment join is incomplete for '+ref+' at '+confidence)
            for tid,count in counts.most_common():
                support_rows.append(dict(target_id=row['target_id'],gene=row['gene'],reference_source_organism=row['reference_source_organism'],
                    kraken_confidence_threshold=confidence,supporting_species_taxid=tid,
                    supporting_species_name=tax_names.get(tid,'unresolved_at_species_level'),supporting_fragments=count,
                    total_target_supporting_fragments=nfrag,fraction_of_all_target_supporting_fragments=count/nfrag,
                    interpretation='Read-classifier context only; no assembly linkage or demonstrated function; unresolved fragments retained'))
    writer(OUT/'gene_taxonomic_support.tsv',support_rows,['target_id','gene','reference_source_organism','kraken_confidence_threshold',
        'supporting_species_taxid','supporting_species_name','supporting_fragments','total_target_supporting_fragments',
        'fraction_of_all_target_supporting_fragments','interpretation'])
    # Aggregate coverage over public-reference coordinates only. These bins
    # contain no sample read names, sequences, or reconstructed sample alleles.
    bins=[]
    for row in manifest:
        ref=row['mapping_reference_id'];d=depth[ref]
        for start in range(0,len(d),50):
            end=min(start+50,len(d));v=d[start:end]
            bins.append(dict(mapping_reference_id=ref,protein_accession=row['protein_accession'],
                start_1based=start+1,end_1based_inclusive=end,reference_nt_length=len(d),
                mean_accepted_read_depth=round(sum(v)/len(v),6),minimum_depth=min(v),maximum_depth=max(v),
                fraction_bases_covered_1x=round(sum(x>0 for x in v)/len(v),6),
                fraction_bases_covered_5x=round(sum(x>=5 for x in v)/len(v),6)))
    writer(OUT/'target_coverage_bins.tsv',bins,list(bins[0]))
    (OUT/'versions/target_mapping_metrics.json').write_text(json.dumps(dict(stats,total_nonhost_fragments=total_fragments,
        min_identity=.95,min_query_coverage=.90,min_aligned_query_bases=80,min_mapq=20,min_alignment_score_gap=10,
        max_reported_alignments=10,mapq_255_rule='MAPQ unavailable; require best/second score gap >=10; exclude 255 from median MAPQ',coverage_definition='accepted uniquely assigned reads; overlapping mates counted separately',
        abundance_definition='unique fragments per kilobase of reference per million nonhost fragments; one fragment may overlap multiple genes',
        uncertainty='Panel-limited sensitivity; conserved reads may remain unassigned; no genome linkage, ORF reconstruction, expression, activity or absolute abundance established'),indent=2)+'\n')
    print('Summarized',len(output),'references;',stats['accepted_reads'],'accepted reads')

if __name__=='__main__':main()
