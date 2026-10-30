"""Expand the frozen competitive panel with two experimentally investigated Bt loci."""
import csv, hashlib, json
import shutil
from Bio import SeqIO, Align
from Bio.Align import substitution_matrices
from Bio.SeqRecord import SeqRecord
from common import ROOT, OUT, REF, write_tsv

rows = list(
    csv.DictReader(
        (ROOT / "results/references/reference_manifest.tsv").open(), delimiter="\t"
    )
)
nt = list(SeqIO.parse(ROOT / "results/references/target_panel.fna", "fasta"))
aa = list(SeqIO.parse(ROOT / "results/references/target_panel.faa", "fasta"))
additions = list(
    csv.DictReader((OUT / "references/bt_bsh_manifest.tsv").open(), delimiter="\t")
)
new_nt = list(SeqIO.parse(OUT / "references/bt_bsh_additions.fna", "fasta"))
new_aa = list(SeqIO.parse(OUT / "references/bt_bsh_additions.faa", "fasta"))
by_id = {r.id: r for r in new_nt}
proteins = {r.id: str(r.seq) for r in new_aa}
for row in additions:
    rid = row["mapping_reference_id"]
    assert (
        hashlib.sha256(str(by_id[rid].seq).encode()).hexdigest()
        == row["reference_nt_sha256"]
    )
    assert str(by_id[rid].seq.translate()).rstrip("*")[1:] == proteins[rid][1:]
rows.extend(additions)
nt.extend(new_nt)
aa.extend(new_aa)
genomes = []
for name in ["B_theta_VPI5482", "bilophila_complete_assembly"]:
    for rec in SeqIO.parse(ROOT / f"analysis/references/{name}.gb", "genbank"):
        genomes.append(SeqRecord(rec.seq, id=rec.id, description=rec.description))
assert len(rows) == 124
all_nt = {r.id: str(r.seq) for r in nt}
assert len(all_nt) == len(rows) == len(aa)
for row in rows:
    assert (
        hashlib.sha256(all_nt[row["mapping_reference_id"]].encode()).hexdigest()
        == row["reference_nt_sha256"]
    )
write_tsv(REF / "reference_manifest_v2.tsv", rows)
SeqIO.write(nt, REF / "panel_v2.fna", "fasta")
SeqIO.write(aa, REF / "panel_v2.faa", "fasta")
SeqIO.write(genomes, REF / "context_genomes.fna", "fasta")
for name in ("panel_v2.fna", "panel_v2.faa", "reference_manifest_v2.tsv"):
    shutil.copyfile(REF / name, OUT / "references" / name)
proteins = {r.id: str(r.seq) for r in aa}
a = Align.PairwiseAligner()
a.mode = "global"
a.substitution_matrix = substitution_matrices.load("BLOSUM62")
a.open_gap_score = -10
a.extend_gap_score = -0.5
alignment = a.align(proteins["WP_005025869_1"], proteins["WP_016360761_1"])[0]
(REF / "BwBSH1_BwBSH2_alignment.txt").write_text(str(alignment))
mapping = {
    int(x) + 1: int(y) + 1 for x, y in zip(*alignment.indices) if x >= 0 and y >= 0
}
sites = []
for pos, res, kind in [
    (110, "H", "metal_ligand_mutagenesis"),
    (112, "H", "metal_ligand_mutagenesis"),
    (373, "K", "bridging_carboxylated_lysine_mutagenesis"),
    (441, "H", "metal_ligand_mutagenesis"),
    (474, "H", "metal_ligand_mutagenesis"),
    (583, "D", "metal_ligand_mutagenesis"),
    (196, "H", "catalytic_mutagenesis"),
    (194, "S", "predicted_substrate_binding"),
    (381, "Q", "predicted_substrate_binding"),
    (443, "N", "predicted_substrate_binding"),
    (544, "H", "predicted_substrate_binding"),
]:
    assert proteins["WP_005025869_1"][pos - 1] == res
    p2 = mapping[pos]
    r2 = proteins["WP_016360761_1"][p2 - 1]
    assert r2 == res, (pos, p2, res, r2)
    sites.append(
        dict(
            BwBSH1_position=pos,
            BwBSH1_residue=res,
            BwBSH2_position=p2,
            BwBSH2_residue=r2,
            evidence=kind,
            source="https://doi.org/10.64898/2026.04.05.716592",
            numbering="full_length_reference; mutants experimentally tested in BwBSH1, positions transferred to BwBSH2 by alignment",
        )
    )
write_tsv(OUT / "reference_catalytic_sites.tsv", sites)
(OUT / "versions/panel_v2_hashes.json").write_text(
    json.dumps(
        {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                REF / "panel_v2.fna",
                REF / "panel_v2.faa",
                REF / "reference_manifest_v2.tsv",
                REF / "context_genomes.fna",
            ]
        },
        indent=2,
    )
    + "\n"
)
print(
    "Prepared 124 references and aligned catalytic positions:",
    [(r["BwBSH1_position"], r["BwBSH2_position"]) for r in sites],
)
