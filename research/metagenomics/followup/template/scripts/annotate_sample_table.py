"""Attach verified reference provenance to the original-length sample table."""
import csv
from common import OUT, REF, WORK, write_tsv

with (REF / "reference_manifest_v2.tsv").open() as f:
    references = {
        r["mapping_reference_id"]: r for r in csv.DictReader(f, delimiter="\t")
    }
with (WORK / "panel_v2/gene_quantification.tsv").open() as f:
    rows = list(csv.DictReader(f, delimiter="\t"))
for r in rows:
    ref = references[r["reference_id"]]
    r.update(
        reference_protein_accession=ref["protein_accession"],
        reference_nucleotide_accession=ref["nucleotide_accession"],
        reference_function_evidence=ref["reference_evidence"],
        reference_primary_publication=ref["primary_publication"],
    )
write_tsv(OUT / "gene_hits.tsv", rows)
