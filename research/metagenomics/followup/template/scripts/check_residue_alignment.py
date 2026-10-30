"""Independently check transferred BwBSH sites with MAFFT before sample interpretation."""
import csv
import subprocess
from Bio import SeqIO
from common import OUT, REF

selected = [
    r
    for r in SeqIO.parse(REF / "panel_v2.faa", "fasta")
    if r.id in {"WP_005025869_1", "WP_016360761_1"}
]
SeqIO.write(selected, REF / "BwBSH_public_proteins.faa", "fasta")
with (OUT / "references/BwBSH_mafft.faa").open("w") as output:
    subprocess.run(
        [
            "mafft",
            "--globalpair",
            "--maxiterate",
            "1000",
            str(REF / "BwBSH_public_proteins.faa"),
        ],
        stdout=output,
        check=True,
    )
aligned = {
    r.id: str(r.seq) for r in SeqIO.parse(OUT / "references/BwBSH_mafft.faa", "fasta")
}
i = j = 0
mapping = {}
for a, b in zip(aligned["WP_005025869_1"], aligned["WP_016360761_1"]):
    i += a != "-"
    j += b != "-"
    if a != "-" and b != "-":
        mapping[i] = j
for row in csv.DictReader(
    (OUT / "reference_catalytic_sites.tsv").open(), delimiter="\t"
):
    if mapping[int(row["BwBSH1_position"])] != int(row["BwBSH2_position"]):
        raise ValueError("Independent residue alignments disagree")
(OUT / "versions/residue_alignment.txt").write_text(
    "Biopython and MAFFT transferred-site positions agree.\n"
)
