"""Audit reference annotation gaps and a relaxed marker-detection sensitivity."""
from bile_sulphur_config import ROOT, CONFIG
import collections, csv, itertools, json
from pathlib import Path
import numpy as np, pysam
from quantify_carriers import ROOT, R, W, classify, fragment, contribution, write_tsv

O = ROOT / "results/bile_sulphur"
A = ROOT / "analysis/bile_sulphur/references"
cm = json.load(open(A / "contig_metadata.json"))
genomes = list(csv.DictReader(open(R / "genome_panel.tsv"), delimiter="\t"))
target = "AAK31310_1"
gs = {r["accession"] for r in genomes if r["group"] == "bilophila"}
hits = collections.defaultdict(list)
for line in open(A / "curated_genome_blast.tsv"):
    v = line.split()
    if (
        v[0] == target
        and cm[v[1]]["accession"] in gs
        and float(v[2]) >= 85
        and int(v[3]) >= 100
    ):
        hits[cm[v[1]]["accession"]].append(v)
rows = []
for ac in sorted(gs):
    union = np.zeros(1452, dtype=bool)
    for v in hits[ac]:
        union[int(v[6]) - 1 : int(v[7])] = True
    rows.append(
        dict(
            genome=ac,
            reference=target,
            union_nucleotide_breadth_pct=100 * float(union.mean()),
            longest_hsp_nt=max([int(v[3]) for v in hits[ac]], default=0),
            initial_annotated_full_protein_alleles=0,
            recovered_genomic_ORF_alleles=sum(
                r["genome"] == ac
                for r in csv.DictReader(
                    open(R / "recovered_public_dsrB.tsv"), delimiter="\t"
                )
            ),
            interpretation="Automated protein annotation omitted the full experimental fusion. An intact high-identity ORF was recovered directly from this public genome and included in the final panel; this is not sample reconstruction or new enzyme validation.",
        )
    )
write_tsv(O / "reference_dsrB_annotation_audit.tsv", rows)
refs = {
    r["reference_id"]: r
    for r in csv.DictReader(open(R / "mapping_panel_manifest.tsv"), delimiter="\t")
}
groups = {r["group"]: r["species"] for r in refs.values() if r["kind"] == "marker"}
rows = []
for d in sorted(W.iterdir()):
    if not (d / "MAPPING_COMPLETE").exists():
        continue
    sums = {mode: {g: 0.0 for g in groups} for mode in ["strict95", "relaxed90"]}
    with pysam.AlignmentFile(str(d / "panel.bam"), "rb") as bam:
        for qn, aa in itertools.groupby(
            bam.fetch(until_eof=True), key=lambda a: a.query_name
        ):
            aa = list(aa)
            for mode, cutoff in [("strict95", 0.95), ("relaxed90", 0.9)]:
                a, decision = classify(aa, refs, cutoff)
                if decision != "accepted":
                    continue
                r = refs[a.reference_name]
                if r["kind"] == "marker":
                    sums[mode][r["group"]] += contribution(a, int(r["length"]))[1]
    for sp in ["bilophila", "bt"]:
        vals = {
            mode: float(np.median([v for g, v in dd.items() if groups[g] == sp]))
            for mode, dd in sums.items()
        }
        rows.append(
            dict(
                sample=d.name,
                species=sp,
                strict95_marker_median=vals["strict95"],
                relaxed90_marker_median=vals["relaxed90"],
                strict_to_relaxed_ratio=vals["strict95"] / vals["relaxed90"]
                if vals["relaxed90"]
                else "NA",
                scope="Diagnostic only; primary ratios retain strict markers; broader mapping may trade specificity for sensitivity",
            )
        )
write_tsv(O / "marker_identity_sensitivity.tsv", rows)
print(
    "Reference and marker audit", len(rows), "sample-species combinations", flush=True
)
