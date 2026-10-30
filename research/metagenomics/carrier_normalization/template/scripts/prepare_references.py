"""Freeze public isolate panel and extract candidate MetaPhlAn markers locally."""
from carrier_config import ROOT, CONFIG
import csv, json, hashlib
from pathlib import Path
from Bio import SeqIO

BASE = Path("analysis/carrier_normalization/references")
OUT = Path("results/carrier_normalization/references")
chosen = {
    "gnavus": [
        "GCF_009831375.1",
        "GCF_988234565.1",
        "GCF_988234975.1",
        "GCF_042850355.1",
        "GCF_020181455.1",
        "GCF_964271935.1",
        "GCF_964272175.1",
        "GCF_030167985.1",
        "GCF_046603815.1",
    ],
    "torques": [
        "GCF_044591705.1",
        "GCF_988233465.1",
        "GCF_988233695.1",
        "GCF_988237865.1",
        "GCF_988237625.1",
        "GCF_988233635.1",
        "GCF_988238285.1",
        "GCF_033096525.1",
    ],
    "neighbor": [
        "GCF_025152405.1",
        "GCF_055383675.1",
        "GCF_055387595.1",
        "GCF_055380515.1",
        "GCF_042852765.1",
        "GCF_056148955.1",
    ],
}
reports = {
    r["accession"]: r
    for r in json.load(open(BASE / "ncbi_taxon_2316020.json"))["reports"]
}
for t in ["33038", "33039"]:
    reports.update(
        {
            r["accession"]: r
            for r in json.load(open(BASE / f"ncbi_taxon_{t}.json"))["reports"]
        }
    )
rows = []
for group, acs in chosen.items():
    for ac in acs:
        r = reports[ac]
        name = r["assembly_info"]["assembly_name"]
        digits = ac.split("_")[1].split(".")[0]
        stem = f"{ac}_{name}"
        base = f"https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/{digits[:3]}/{digits[3:6]}/{digits[6:]}/{stem}"
        rows.append(
            dict(
                accession=ac,
                group=group,
                organism=r["organism"]["organism_name"],
                strain=r["organism"].get("infraspecific_names", {}).get("strain", ""),
                assembly_name=name,
                assembly_level=r["assembly_info"]["assembly_level"],
                checkm=json.dumps(r.get("checkm_info", {}), sort_keys=True),
                base_url=base,
                stem=stem,
            )
        )
with (OUT / "genome_panel.tsv").open("w") as f:
    w = csv.DictWriter(f, rows[0], delimiter="\t")
    w.writeheader()
    w.writerows(rows)
meta = json.load(open(BASE / "metaphlan_target_metadata.json"))
sgbs = {"t__SGB4584", "t__SGB4571", "t__SGB4608"}
markers = {k: v for k, v in meta["markers"].items() if v["clade"] in sgbs}
json.dump(markers, open(BASE / "candidate_markers.json", "w"), indent=2)
seen = set()
with (BASE / "candidate_markers.fna").open("w") as out:
    for rec in SeqIO.parse(
        "analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.fna", "fasta"
    ):
        if rec.id in markers:
            SeqIO.write(rec, out, "fasta")
            seen.add(rec.id)
assert seen == set(markers), (len(seen), len(markers))
print("genomes", len(rows), "markers", len(seen), flush=True)
