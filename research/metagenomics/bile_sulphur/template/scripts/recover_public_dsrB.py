"""Recover experimentally anchored DsrB-D ORFs missed by automated CDS annotation.
Only public genomes are read. Recovery requires full ungapped DNA, high identity,
valid coding frame/start/stop and near-full protein identity to the experimental
fusion. Genome coordinates are retained, including embedded annotation aliases.
Run after initial search_references.sh and before rebuilding the protein search.
"""
from bile_sulphur_config import ROOT, CONFIG
import csv, json, hashlib
from pathlib import Path
from Bio import SeqIO, Align
from Bio.Seq import Seq
from Bio.Align import substitution_matrices
from reference_validation import validate_full_orf

R = Path("analysis/bile_sulphur/references")
O = Path("results/bile_sulphur/references")
cm = json.load(open(R / "contig_metadata.json"))
cdm = json.load(open(R / "cds_metadata.json"))
genomes = SeqIO.to_dict(SeqIO.parse(R / "genomes.fna", "fasta"))
proteins = SeqIO.to_dict(SeqIO.parse(R / "proteins.faa", "fasta"))
cds = SeqIO.to_dict(SeqIO.parse(R / "cds.fna", "fasta"))
ref = next(
    r for r in SeqIO.parse(R / "curated_panel.faa", "fasta") if r.id == "AAK31310_1"
)
aligner = Align.PairwiseAligner()
aligner.substitution_matrix = substitution_matrices.load("BLOSUM62")
aligner.open_gap_score = -10
aligner.extend_gap_score = -0.5
candidates = {}
for line in open(R / "curated_genome_blast.tsv"):
    v = line.split()
    if (
        v[0] != "AAK31310_1"
        or cm[v[1]]["group"] != "bilophila"
        or float(v[2]) < 99
        or int(v[6]) != 1
        or int(v[7]) != len(ref) * 3 + 3
        or abs(int(v[9]) - int(v[8])) + 1 != int(v[4])
    ):
        continue
    ac = cm[v[1]]["accession"]
    if ac not in candidates or float(v[11]) > float(candidates[ac][11]):
        candidates[ac] = v
rows = []
aliases = []
for ac, v in sorted(candidates.items()):
    lo = min(int(v[8]), int(v[9])) - 1
    hi = max(int(v[8]), int(v[9]))
    dna = genomes[v[1]].seq[lo:hi]
    if int(v[8]) > int(v[9]):
        dna = dna.reverse_complement()
    checked = validate_full_orf(dna, ref.seq)
    if checked is None:
        continue
    pep, identity = checked
    sid = ac + "__recovered_dsrB_D"
    if sid not in cdm:
        with (R / "cds.fna").open("a") as out:
            out.write(f">{sid}\n{dna}\n")
        with (R / "proteins.faa").open("a") as out:
            out.write(f">{sid}\n{pep}\n")
        cdm[sid] = dict(
            accession=ac,
            group="bilophila",
            protein_id="experimental_AAK31310.1_anchored_genomic_ORF",
            original_id=cm[v[1]]["original_id"],
            location=f"{lo+1}..{hi}",
            nt_length=len(dna),
            aa_length=len(pep),
            source="public_genomic_ORF_recovery",
        )
    rows.append(
        dict(
            genome=ac,
            target="AAK31310_1",
            recovered_cds=sid,
            nucleotide_accession=cm[v[1]]["original_id"],
            start_1based=lo + 1,
            end_1based=hi,
            strand="-" if int(v[8]) > int(v[9]) else "+",
            nt_identity_pct=float(v[2]),
            aa_identity_pct=100 * identity,
            length_nt=len(dna),
            internal_stops=0,
            start_codon=str(dna[:3]),
            terminal_stop=str(dna[-3:]),
            sha256=hashlib.sha256(str(dna).encode()).hexdigest(),
            evidence="Public reference complete ORF candidate anchored to experimental fusion; not sample sequence or new biochemical validation",
        )
    )
    # An annotated same-genome CDS identical to a >=180-nt in-frame segment of this
    # recovered fusion is an annotation fragment alias, even if shorter than 100 aa.
    # Full-target read alignment remains mandatory. Never alias another genome/locus.
    original_contig = cm[v[1]]["original_id"]
    for cid, md in list(cdm.items()):
        if (
            md["accession"] != ac
            or cid not in cds
            or original_contig not in md["original_id"]
        ):
            continue
        fragment = str(cds[cid].seq)
        pos = str(dna).find(fragment)
        if pos < 0 and fragment[-3:] in ["TAA", "TAG", "TGA"]:
            pos = str(dna).find(fragment[:-3])
        if pos < 0 or pos % 3 or len(fragment) < 180 or len(fragment) >= 0.9 * len(dna):
            continue
        # Location text must contain endpoints within this recovered locus.
        import re

        endpoints = [int(x) for x in re.findall(r"\d+", md["location"])]
        if not endpoints or min(endpoints) < lo + 1 or max(endpoints) > hi:
            continue
        aliases.append(
            dict(
                source_cds=cid,
                target_group="AAK31310_1",
                recovered_cds=sid,
                genome=ac,
                length_nt=len(fragment),
                evidence="Same public genomic locus and in-frame sequence contained in recovered DsrB-D ORF; annotation-fragment alias; full-target alignment still required",
            )
        )
json.dump(cdm, open(R / "cds_metadata.json", "w"), indent=2)
for name, rs in [
    ("recovered_public_dsrB.tsv", rows),
    ("dsrB_annotation_aliases.tsv", aliases),
]:
    with (O / name).open("w") as f:
        fields = (
            list(rs[0])
            if rs
            else (
                [
                    "source_cds",
                    "target_group",
                    "recovered_cds",
                    "genome",
                    "length_nt",
                    "evidence",
                ]
                if "aliases" in name
                else ["genome", "target", "recovered_cds"]
            )
        )
        w = csv.DictWriter(f, fields, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rs)
print(
    "Recovered public DsrB-D ORFs",
    len(rows),
    "same-locus annotation aliases",
    len(aliases),
    flush=True,
)
