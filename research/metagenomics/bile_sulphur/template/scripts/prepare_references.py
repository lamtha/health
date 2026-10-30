"""Freeze a purposive public strain/neighbor panel before read quantification."""
from bile_sulphur_config import ROOT, CONFIG
import csv, json
from pathlib import Path
from Bio import SeqIO

B = Path("analysis/bile_sulphur/references")
O = Path("results/bile_sulphur/references")
chosen = {
    "bilophila": [
        "GCF_050780155.1",
        "GCF_000185705.2",
        "GCF_000701705.1",
        "GCF_040948495.1",
        "GCF_054601115.1",
        "GCF_054601155.1",
        "GCF_054601135.1",
        "GCF_000224655.1",
    ],
    "bt": [
        "GCF_000011065.1",
        "GCF_019857385.1",
        "GCF_019896115.1",
        "GCF_018289275.1",
        "GCF_036419675.1",
        "GCF_988235315.1",
        "GCF_024759965.1",
        "GCF_001314975.1",
    ],
    "neighbor": [
        "GCF_059728385.1",
        "GCF_000025985.1",
        "GCF_001314995.1",
        "GCF_025147485.1",
        "GCF_002222615.2",
        "GCF_017815575.1",
        "GCF_021365555.1",
    ],
}
reports = {
    r["accession"]: r
    for p in B.glob("ncbi_taxon_*.json")
    for r in json.load(open(p))["reports"]
}
rows = []
for group, acs in chosen.items():
    for ac in acs:
        r = reports[ac]
        name = r["assembly_info"]["assembly_name"]
        digits = ac.split("_")[1].split(".")[0]
        stem = f"{ac}_{name}"
        rows.append(
            dict(
                accession=ac,
                group=group,
                organism=r["organism"]["organism_name"],
                strain=r["organism"].get("infraspecific_names", {}).get("strain", ""),
                assembly_name=name,
                assembly_level=r["assembly_info"]["assembly_level"],
                checkm=json.dumps(r.get("checkm_info", {}), sort_keys=True),
                base_url=f"https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/{digits[:3]}/{digits[3:6]}/{digits[6:]}/{stem}",
                stem=stem,
            )
        )
with (O / "genome_panel.tsv").open("w") as f:
    w = csv.DictWriter(f, rows[0], delimiter="\t")
    w.writeheader()
    w.writerows(rows)
meta = json.load(open(B / "metaphlan_target_metadata.json"))
markers = meta["markers"]
json.dump(markers, open(B / "candidate_markers.json", "w"), indent=2)
seen = set()
with (B / "candidate_markers.fna").open("w") as out:
    for rec in SeqIO.parse(
        "analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.fna", "fasta"
    ):
        if rec.id in markers:
            SeqIO.write(rec, out, "fasta")
            seen.add(rec.id)
assert seen == set(markers)
json.dump(
    dict(
        selection="Purposive public isolate panel; one complete Bilophila genome plus reference and high-quality isolate drafts; eight distinct Bt strains; seven neighbors. No reads used in selection.",
        bilophila_scope="SGB15452 species complex includes Bilophila sp. 4_1_30; not exclusive proof of named B. wadsworthia strains",
        bt_scope="SGB1861; finite specificity panel, not all environmental homologues",
    ),
    open(O / "panel_scope.json", "w"),
    indent=2,
)
print("genomes", len(rows), "markers", len(seen), flush=True)
