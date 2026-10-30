"""Recognize strong same-target CDS fragments without treating them as full genes.
Their alignments cease to compete with their own full reference, but quantification
still requires a qualifying alignment to a full target allele. FASTA IDs/sequences
are unchanged, so existing BAMs remain valid. Other paralogues remain competitors.
"""
from carrier_config import ROOT, CONFIG
import csv, json
from pathlib import Path

R = Path("results/carrier_normalization/references")


def read(path):
    with Path(path).open() as f:
        return list(csv.DictReader(f, delimiter="\t"))


def write(path, rows):
    with Path(path).open("w") as f:
        w = csv.DictWriter(f, rows[0], delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


hom = read(R / "target_homolog_validation.tsv")
provenance = read(R / "reference_provenance.tsv")
manifest = read(R / "mapping_panel_manifest.tsv")
target_species = {r["group"]: r["species"] for r in manifest if r["kind"] == "target"}
fragments = {}
for r in hom:
    eligible = (
        r["retained_target_homolog"] == "False"
        and r["species"] == target_species[r["target"]]
        and float(r["identity_pct"]) >= 95
        and 0.1 <= float(r["query_coverage"]) < 0.9
        and float(r["subject_coverage"]) >= 0.9
        and float(r["bits"]) >= 1.1 * float(r["next_target_bits"])
    )
    if eligible:
        fragments[r["cds_id"]] = r
aliases = {}
rows = []
for p in provenance:
    if (
        p["source"] not in fragments
        or p["kind"] != "decoy"
        or json.loads(p["details"])["blast"]["length"] < 100
    ):
        continue
    r = fragments[p["source"]]
    aliases[p["reference_id"]] = r["target"]
    rows.append(
        dict(
            reference_id=p["reference_id"],
            source_cds=p["source"],
            target_group=r["target"],
            protein_id=r["protein_id"],
            identity_pct=r["identity_pct"],
            query_coverage=r["query_coverage"],
            subject_coverage=r["subject_coverage"],
            evidence="high-identity partial CDS; requires independent full-target read alignment; no full-gene claim",
        )
    )
for r in manifest:
    r["classification_group"] = aliases.get(r["reference_id"], r["group"])
write(R / "mapping_panel_manifest.tsv", manifest)
write(R / "partial_reference_groups.tsv", rows)
print(len(aliases), "partial reference aliases; FASTA unchanged", flush=True)
