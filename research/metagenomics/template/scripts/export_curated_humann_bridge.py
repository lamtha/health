#!/usr/bin/env python3
"""Link validated reference accessions to exact HUMAnN UniRef90 representative IDs.

This is an accession-level cross-reference, not a claim that every UniRef90
cluster member has the reference's experimentally established specificity.
No sequence, read identifier, or sample allele is exported.
"""
import csv
from pathlib import Path

from workspace_config import ROOT, SAMPLE
OUT = ROOT / 'results'
if not (ROOT / 'analysis/work/humann/HUMANN_COMPLETE').exists():
    raise SystemExit('Full HUMAnN run must be complete')

def values(name):
    result = {}
    with (OUT / 'functional' / name).open() as stream:
        for line in stream:
            if line.startswith('#') or not line.strip():
                continue
            key, value = line.rstrip().split('\t')[:2]
            if key in result:
                raise ValueError('Duplicate functional key')
            result[key] = float(value)
    return result

rpk = values('gene_families_rpk.tsv')
cpm = values('gene_families_cpm.tsv')
by_family = {}
for key in rpk:
    by_family.setdefault(key.partition('|')[0], []).append(key)
targets = {r['target_id']: r for r in csv.DictReader((OUT / 'gene_hits.tsv').open(), delimiter='\t')}
rows = []
for ref in csv.DictReader((OUT / 'references/reference_manifest.tsv').open(), delimiter='\t'):
    accession = ref['uniprot_accession']
    usable = bool(accession and accession not in ('NA', 'none', 'unavailable'))
    family = 'UniRef90_' + accession if usable else 'NA'
    matches = by_family.get(family, [])
    target = targets[ref['target_id']]
    for key in matches or [None]:
        _, _, stratum = key.partition('|') if key else ('', '', '')
        rows.append(dict(
            sample=SAMPLE, target_id=ref['target_id'], gene=ref['gene'],
            protein_accession=ref['protein_accession'], uniprot_accession=accession,
            reference_source_organism=ref['reference_source_organism'],
            reference_evidence=ref['reference_evidence'], primary_publication=ref['primary_publication'],
            gene_family=family,
            bridge_status=('exact_reference_representative_ID_reported' if matches else
                           'exact_representative_ID_not_reported' if usable else 'no_curated_UniProt_ID_for_this_reference'),
            organism_stratum=(stratum or 'community_unstratified') if key else 'NA',
            abundance_rpk=rpk[key] if key else 'NA', abundance_cpm=cpm[key] if key else 'NA',
            targeted_fragments=target['unique_mapped_fragments'],
            targeted_breadth_1x_pct=target['breadth_1x_pct'],
            targeted_mean_read_depth=target['mean_read_depth'],
            targeted_aligned_read_identity_pct=target['aligned_read_sequence_identity_pct'],
            targeted_fragment_taxonomic_assignment=target['organism_assignment'],
            evidence_quality='Exact accession link plus HUMAnN reference-pangenome association; not physical genome linkage',
            specificity_caveat='UniRef90 cluster membership does not establish identical substrate specificity; targeted nucleotide evidence is separate',
            negative_interpretation='Unreported representative ID is not gene absence: homologues may have another cluster representative',
            intact_gene_demonstrated='no', active_pathway_demonstrated='no'))
with (OUT / 'curated_reference_humann_matches.tsv').open('w') as stream:
    writer = csv.DictWriter(stream, delimiter='\t', fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
print('Exported', len(rows), 'reference/stratum rows;',
      len({r['target_id'] for r in rows if r['bridge_status']=='exact_reference_representative_ID_reported'}),
      'curated targets have exact representative-ID matches.')
