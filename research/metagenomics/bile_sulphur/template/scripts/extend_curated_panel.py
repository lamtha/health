"""Add publication-linked Bilophila respiratory accessories to the verified panel.
These are pathway/context assignments, not claims of purified-enzyme validation.
"""
from bile_sulphur_config import ROOT, CONFIG
import csv, hashlib, json, shutil
from pathlib import Path
from Bio import SeqIO

R = Path("analysis/bile_sulphur/references")
O = Path("results/bile_sulphur/references")
old = Path("results/followup/references")
rows = list(csv.DictReader(open(old / "reference_manifest_v2.tsv"), delimiter="\t"))
selected = {
    "WP_005028751.1": ("ald", "taurine_pyruvate_recycling", "HMPREF0179_02712", "2019"),
    "WP_005024907.1": ("adhE", "acetaldehyde_processing", "HMPREF0179_00640", "2019"),
    "WP_005028339.1": (
        "dsrC",
        "sulfite_reduction_accessory",
        "HMPREF0179_02481",
        "2019",
    ),
}
for pid, gene in [
    ("WP_005028187.1", "dsrP"),
    ("WP_005028188.1", "dsrO"),
    ("WP_005028189.1", "dsrJ"),
    ("WP_005028190.1", "dsrK"),
    ("WP_005028191.1", "dsrM"),
]:
    selected[pid] = (gene, "respiratory_electron_transfer", "", "2024")
for ext in ["fna", "faa"]:
    shutil.copyfile(old / f"panel_v2.{ext}", R / f"curated_panel.{ext}")
seen = set()
with (R / "curated_panel.fna").open("a") as ntout, (R / "curated_panel.faa").open(
    "a"
) as aaout:
    for rec in SeqIO.parse(
        "analysis/references/bilophila_complete_assembly.gb", "genbank"
    ):
        for f in rec.features:
            pid = f.qualifiers.get("protein_id", [""])[0]
            if f.type != "CDS" or pid not in selected:
                continue
            gene, pathway, locus, paper = selected[pid]
            nt = str(f.extract(rec.seq)).upper()
            pep = str(f.extract(rec.seq).translate(table=11)).rstrip("*")
            expected = f.qualifiers["translation"][0]
            assert (
                len(nt) % 3 == 0
                and "*" not in pep
                and ("M" + pep[1:]) == ("M" + expected[1:])
            )
            assert not locus or locus in f.qualifiers.get("old_locus_tag", [])
            rid = pid.replace(".", "_")
            ntout.write(f">{rid}\n{nt}\n")
            aaout.write(f">{rid}\n{expected}\n")
            row = {k: "NA" for k in rows[0]}
            row.update(
                target_id=rid,
                gene=gene,
                pathway=pathway,
                substrate="pathway accessory or electron transfer; not stand-alone sulfide production",
                protein_accession=pid,
                reference_source_organism="Bilophila wadsworthia 3_1_6",
                nucleotide_accession=rec.id,
                cds_location=str(f.location),
                reference_nt_length=len(nt),
                reference_aa_length=len(expected),
                reference_partial="false",
                reference_evidence="primary_proteomics_pathway_assignment"
                if paper == "2019"
                else "genomic_annotation_and_primary_co_culture_pathway_context",
                primary_publication="https://doi.org/10.1073/pnas.1815661116"
                if paper == "2019"
                else "https://doi.org/10.1080/19490976.2024.2431644",
                reference_role="accessory_context",
                translation_validation="exact_with_initiator_M_rule",
                reference_nt_sha256=hashlib.sha256(nt.encode()).hexdigest(),
                notes="DsrMKJOP annotations saying sulfate do not establish ability to activate sulfate; terminal sulfite reduction context. Short DsrC/DsrJ use full-depth sensitivity as interior coverage is sparse.",
                mapping_reference_id=rid,
            )
            rows.append(row)
            seen.add(pid)
assert seen == set(selected)
with (O / "curated_reference_manifest.tsv").open("w") as out:
    w = csv.DictWriter(out, rows[0], delimiter="\t", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
print("curated", len(rows), "references; accessories", len(seen))
