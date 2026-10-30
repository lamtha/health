"""Create public-genome FASTA databases and provenance for validation searches."""
from bile_sulphur_config import ROOT, CONFIG
import csv, gzip, json, re
from pathlib import Path
from Bio import SeqIO
from Bio.SeqRecord import SeqRecord

BASE = Path("analysis/bile_sulphur/references")
meta = {}
genome_meta = {}
rows = list(
    csv.DictReader(
        open("results/bile_sulphur/references/genome_panel.tsv"), delimiter="\t"
    )
)
with (BASE / "genomes.fna").open("w") as go, (BASE / "proteins.faa").open("w") as po, (
    BASE / "cds.fna"
).open("w") as co:
    for row in rows:
        ac = row["accession"]
        folder = BASE / "genomes" / ac
        stem = row["stem"]
        with gzip.open(folder / (stem + "_genomic.fna.gz"), "rt") as f:
            for i, r in enumerate(SeqIO.parse(f, "fasta")):
                nid = f"{ac}__contig{i}"
                genome_meta[nid] = dict(
                    accession=ac, group=row["group"], original_id=r.id, length=len(r)
                )
                r.id = nid
                r.description = ""
                SeqIO.write(r, go, "fasta")
        with gzip.open(folder / (stem + "_cds_from_genomic.fna.gz"), "rt") as f:
            for i, r in enumerate(SeqIO.parse(f, "fasta")):
                pid = re.search(r"\[protein_id=([^]]+)\]", r.description)
                location = re.search(r"\[location=([^]]+)\]", r.description)
                if not pid:
                    continue
                nid = f"{ac}__cds{i}"
                nt = str(r.seq).upper()
                pep = str(r.seq.translate(table=11)).rstrip("*")
                if "*" in pep or len(nt) % 3:
                    continue
                meta[nid] = dict(
                    accession=ac,
                    group=row["group"],
                    protein_id=pid.group(1),
                    original_id=r.id,
                    location=location.group(1) if location else "",
                    nt_length=len(nt),
                    aa_length=len(pep),
                    source="NCBI_RefSeq",
                )
                r.id = nid
                r.description = ""
                SeqIO.write(r, co, "fasta")
                po.write(f">{nid}\n{pep}\n")
    for species in ["bt"]:
        path = Path(
            "analysis/databases/humann/chocophlan/g__Bacteroides.s__Bacteroides_thetaiotaomicron.centroids.v201901_v31.ffn.gz"
        )
        with gzip.open(path, "rt") as f:
            for i, r in enumerate(SeqIO.parse(f, "fasta")):
                nt = str(r.seq).upper()
                if len(nt) % 3:
                    continue
                pep = str(r.seq.translate(table=11)).rstrip("*")
                if "*" in pep:
                    continue
                nid = f"choco_{species}__{i}"
                meta[nid] = dict(
                    accession="ChocoPhlAn_v201901_v31",
                    group=species,
                    protein_id=r.id,
                    original_id=r.id,
                    location="",
                    nt_length=len(nt),
                    aa_length=len(pep),
                    source="HUMAnN_species_pangenome",
                )
                r.id = nid
                r.description = ""
                SeqIO.write(r, co, "fasta")
                po.write(f">{nid}\n{pep}\n")
json.dump(meta, open(BASE / "cds_metadata.json", "w"), indent=2)
json.dump(genome_meta, open(BASE / "contig_metadata.json", "w"), indent=2)
manifest = list(
    csv.DictReader(
        open("results/bile_sulphur/references/curated_reference_manifest.tsv"),
        delimiter="\t",
    )
)
ids = {
    r["mapping_reference_id"]
    for r in manifest
    if any(
        t in r["reference_source_organism"].lower()
        for t in ["bilophila", "thetaiotaomicron"]
    )
}
with (BASE / "target_proteins.faa").open("w") as o:
    for r in SeqIO.parse("analysis/bile_sulphur/references/curated_panel.faa", "fasta"):
        if r.id in ids:
            SeqIO.write(r, o, "fasta")
print(len(genome_meta), "contigs", len(meta), "CDS", len(ids), "targets", flush=True)
