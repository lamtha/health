"""Quality-filtered fragment codon evidence projected through public allele alignments.
Positions in BwBSH2 are transferred from BwBSH1 experiments. DsrC terminal sites
are family-mechanism inference, not mutagenesis of the Bilophila enzyme.
"""
from bile_sulphur_config import ROOT, CONFIG
import collections, csv, itertools
import pysam
from Bio import SeqIO, Align
from Bio.Seq import Seq
from Bio.Align import substitution_matrices
from quantify_carriers import ROOT, R, W, classify, fragment, write_tsv

O = ROOT / "results/bile_sulphur"
A = ROOT / "analysis/bile_sulphur/references"
refs = {
    r["reference_id"]: r
    for r in csv.DictReader(open(R / "mapping_panel_manifest.tsv"), delimiter="\t")
}
seqs = {r.id: str(r.seq) for r in SeqIO.parse(A / "mapping_panel.fna", "fasta")}
original = {r.id: str(r.seq) for r in SeqIO.parse(A / "curated_panel.faa", "fasta")}
sites = []
for s in csv.DictReader(
    open(ROOT / "results/followup/reference_catalytic_sites.tsv"), delimiter="\t"
):
    for gene, g in [("BwBSH1", "WP_005025869_1"), ("BwBSH2", "WP_016360761_1")]:
        sites.append(
            dict(
                gene=gene,
                target=g,
                position=int(s[gene + "_position"]),
                expected=s[gene + "_residue"],
                source="https://doi.org/10.64898/2026.04.05.716592",
                evidence=s["evidence"]
                + ("; aligned transfer from BwBSH1" if gene == "BwBSH2" else ""),
            )
        )
for pos in [93, 104]:
    sites.append(
        dict(
            gene="dsrC",
            target="WP_005028339_1",
            position=pos,
            expected="C",
            source="https://doi.org/10.1126/science.aad3558;https://doi.org/10.1073/pnas.1815661116",
            evidence="Conserved C-terminal DsrC family redox cysteines; Bilophila identity supported by primary proteomic locus assignment, not site-specific enzyme validation",
        )
    )
write_tsv(R / "critical_sites.tsv", sites)
aligner = Align.PairwiseAligner()
aligner.substitution_matrix = substitution_matrices.load("BLOSUM62")
aligner.open_gap_score = -10
aligner.extend_gap_score = -0.5
lookup = {}
observations = collections.defaultdict(
    lambda: collections.defaultdict(lambda: collections.defaultdict(list))
)
for rid, r in refs.items():
    if r["kind"] != "target" or r["group"] not in {s["target"] for s in sites}:
        continue
    g = r["group"]
    ref = original[g]
    pep = str(Seq(seqs[rid]).translate(table=11)).rstrip("*")
    alignment = aligner.align(ref, pep)[0]
    mapping = {}
    for (qs, qe), (ss, se) in zip(*alignment.aligned):
        for p in range(qs, qe):
            mapping[p] = ss + p - qs
    for i, s in enumerate(sites):
        if s["target"] != g:
            continue
        assert ref[s["position"] - 1] == s["expected"]
        ap = mapping.get(s["position"] - 1)
        if ap is not None:
            for offset in range(3):
                lookup[(rid, 3 * ap + offset)] = (i, offset)
with pysam.AlignmentFile(str(W / "sample_local/panel.bam"), "rb") as bam:
    for qn, aa in itertools.groupby(
        bam.fetch(until_eof=True), key=lambda a: a.query_name
    ):
        a, decision = classify(list(aa), refs)
        if decision != "accepted":
            continue
        for qp, rp in a.get_aligned_pairs(matches_only=True):
            if qp is None or rp is None or (a.reference_name, rp) not in lookup:
                continue
            si, offset = lookup[(a.reference_name, rp)]
            observations[si][fragment(qn)][offset].append(
                (a.query_sequence[qp], a.query_qualities[qp])
            )
out = []
for i, s in enumerate(sites):
    for bq in [20, 30]:
        aas = collections.Counter()
        for positions in observations[i].values():
            codon = []
            for offset in range(3):
                bases = {
                    base
                    for base, quality in positions.get(offset, [])
                    if quality >= bq and base in "ACGT"
                }
                if len(bases) != 1:
                    break
                codon.append(next(iter(bases)))
            if len(codon) == 3:
                aas[str(Seq("".join(codon)).translate())] += 1
        n = sum(aas.values())
        expected = aas[s["expected"]]
        out.append(
            dict(
                **s,
                base_quality_min=bq,
                complete_codon_fragments=n,
                expected_residue_fragments=expected,
                other_residue_fragments=n - expected,
                status="not_covered"
                if n == 0
                else "expected_residue_one_fragment"
                if n == 1 and expected == 1
                else "expected_residue_min2_fragments"
                if expected >= 2 and expected / n >= 0.9
                else "mixed_or_different_residue",
                interpretation="Codon evidence only; not a phased full enzyme, protein expression, metal occupancy or activity"
            )
        )
write_tsv(O / "critical_site_evidence.tsv", out)
print("Critical codon audit", len(out), "rows", flush=True)
