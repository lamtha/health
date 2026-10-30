"""Masked read consensus and catalytic-site audit. Reconstructed DNA stays private.

An overlapping pair contributes at most one vote per base. Disagreeing mates are
discarded at that base. A consensus base needs >=2 distinct read pairs and
>=90% agreement among BQ>=20 calls. This is not phased, assembled, or an intact ORF.
"""
import argparse, collections, csv, json
import numpy as np
from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from common import ROOT, OUT, WORK, REF, CONFIG, write_tsv, groups, fragment

p = argparse.ArgumentParser()
p.add_argument("--bam-dir", default="analysis/followup/work/panel_v2")
args = p.parse_args()
manifest = list(
    csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
)
selected = {
    r["mapping_reference_id"]: r
    for r in manifest
    if r["reference_source_organism"].startswith("Bilophila")
    and r["reference_role"] == "target"
    or r["gene"].startswith(("BT", "BT_"))
}
seqs = {r.id: str(r.seq) for r in SeqIO.parse(REF / "panel_v2.fna", "fasta")}
read_depth = {r: np.zeros(len(seqs[r]), dtype=np.int64) for r in selected}
calls = {
    r: collections.defaultdict(lambda: collections.defaultdict(list)) for r in selected
}
footprints = {r: collections.defaultdict(set) for r in selected}
status = collections.Counter()
intervals = []
for mate in [1, 2]:
    for a, decision, metrics in groups(ROOT / args.bam_dir / f"mate{mate}.bam"):
        ref = a.reference_name
        if ref not in selected:
            continue
        status[(ref, decision)] += 1
        if decision != "accepted":
            continue
        fid = fragment(a.query_name)
        intervals.append(
            dict(
                reference_id=ref,
                fragment_local_id=fid,
                mate=mate,
                start=a.reference_start + 1,
                end=a.reference_end,
                strand="-" if a.is_reverse else "+",
                **metrics,
            )
        )
        for q, r in a.get_aligned_pairs(matches_only=True):
            if q is None or r is None:
                continue
            read_depth[ref][r] += 1
            footprints[ref][fid].add(r)
            calls[ref][fid][r].append(
                (
                    a.query_sequence[q],
                    a.query_qualities[q],
                    "-" if a.is_reverse else "+",
                )
            )

# These files contain local read IDs or reconstructed sample sequences: exclude
# from the small shareable archive and every public repository.
private = WORK / "recovered"
private.mkdir(exist_ok=True)
write_tsv(private / "accepted_alignment_intervals.tsv", intervals)
votes = {}
by_fragment = {}
base_rows = []
summaries = []
consensus = []
for ref, row in selected.items():
    votes[ref] = {q: [collections.Counter() for _ in seqs[ref]] for q in [20, 30]}
    by_fragment[ref] = {q: {} for q in [20, 30]}
    for qmin in [20, 30]:
        for fid, positions in calls[ref].items():
            single = {}
            for pos, observations in positions.items():
                good = [x for x in observations if x[1] >= qmin and x[0] in "ACGT"]
                bases = {x[0] for x in good}
                if len(bases) == 1:
                    base = next(iter(bases))
                    single[pos] = base
                    votes[ref][qmin][pos][base] += 1
            by_fragment[ref][qmin][fid] = single
    recovered = []
    for pos, c in enumerate(votes[ref][20]):
        best, n = c.most_common(1)[0] if c else ("N", 0)
        total = sum(c.values())
        called = best if n >= 2 and n / total >= 0.9 else "N"
        recovered.append(called)
        base_rows.append(
            dict(
                reference_id=ref,
                position_1based=pos + 1,
                reference_base=seqs[ref][pos],
                read_depth=int(read_depth[ref][pos]),
                fragment_depth_bq20=total,
                fragment_depth_bq30=sum(votes[ref][30][pos].values()),
                consensus_base=called,
                major_allele_fraction=n / total if total else "NA",
                A=c["A"],
                C=c["C"],
                G=c["G"],
                T=c["T"],
            )
        )
    dna = "".join(recovered)
    consensus.append(
        SeqRecord(
            Seq(dna),
            id=ref,
            description="masked_BQ20_min2_fragments_AF90_unphased_NOT_intact_ORF",
        )
    )
    dep = read_depth[ref]
    fdep = np.array([sum(c.values()) for c in votes[ref][20]])
    summaries.append(
        dict(
            reference_id=ref,
            gene=row["gene"],
            length_nt=len(dna),
            accepted_fragments=len(footprints[ref]),
            read_mean_depth=float(dep.mean()),
            read_breadth_pct=float((dep > 0).mean() * 100),
            fragment_bq20_mean_depth=float(fdep.mean()),
            fragment_bq20_breadth_pct=float((fdep > 0).mean() * 100),
            masked_consensus_called_pct=100 * (len(dna) - dna.count("N")) / len(dna),
            full_gene_recovered="no" if "N" in dna else "unphased_consensus_only",
            ambiguous_reads=status[(ref, "ambiguous_mapq")],
            identity_length_coverage_rejections=status[
                (ref, "identity_length_coverage")
            ],
        )
    )
SeqIO.write(consensus, private / "masked_consensus.fna", "fasta")
SeqIO.write(
    [
        SeqRecord(
            r.seq[: len(r.seq) // 3 * 3].translate(), id=r.id, description=r.description
        )
        for r in consensus
    ],
    private / "masked_consensus.faa",
    "fasta",
)
write_tsv(private / "base_evidence.tsv", base_rows)
write_tsv(OUT / "gene_recovery.tsv", summaries)

sites = list(
    csv.DictReader((OUT / "reference_catalytic_sites.tsv").open(), delimiter="\t")
)
site_rows = []
for s in sites:
    for label, ref in [("BwBSH1", "WP_005025869_1"), ("BwBSH2", "WP_016360761_1")]:
        pos = int(s[label + "_position"])
        p0 = (pos - 1) * 3
        ref_codon = seqs[ref][p0 : p0 + 3]
        row = dict(
            gene=label,
            reference_id=ref,
            BwBSH1_experiment_position=s["BwBSH1_position"],
            sample_reference_position=pos,
            reference_residue=s[label + "_residue"],
            site_evidence=s["evidence"],
        )
        for qmin in [20, 30]:
            counts = collections.Counter(
                "".join(bases[k] for k in range(p0, p0 + 3))
                for bases in by_fragment[ref][qmin].values()
                if all(k in bases for k in range(p0, p0 + 3))
            )
            amino = collections.Counter()
            for codon, n in counts.items():
                amino[str(Seq(codon).translate())] += n
            depth = [sum(votes[ref][qmin][k].values()) for k in range(p0, p0 + 3)]
            expected = s[label + "_residue"]
            n = sum(amino.values())
            agree = amino[expected]
            call = (
                "not_covered"
                if not n
                else (
                    "different_residue_or_mixture"
                    if agree / n < 0.9
                    else (
                        "reference_residue_supported_min2_fragments"
                        if agree >= 2
                        else "reference_residue_single_fragment"
                    )
                )
            )
            row.update(
                {
                    f"BQ{qmin}_codon_base_depths": ",".join(map(str, depth)),
                    f"BQ{qmin}_complete_codon_fragments": n,
                    f"BQ{qmin}_expected_aa_fragments": agree,
                    f"BQ{qmin}_amino_acid_counts": json.dumps(
                        dict(amino), sort_keys=True
                    ),
                    f"BQ{qmin}_call": call,
                }
            )
        row[
            "interpretation"
        ] = "DNA codon support only; no metal occupancy, lysine carboxylation, folding, expression or enzyme activity demonstrated"
        site_rows.append(row)
write_tsv(OUT / "catalytic_site_evidence.tsv", site_rows)

# Conditional spatial null preserving each observed fragment's mate footprint.
# Circular random shifts deliberately avoid pretending independent mates are
# separate molecules. This is exploratory, not a clinical hypothesis test.
ref = "WP_005028753_1"
L = len(seqs[ref])
observed = read_depth[ref] > 0


def longest_gap(x):
    runs = "".join("1" if v else "0" for v in x).split("1")
    return max(map(len, runs))


rng = np.random.default_rng(CONFIG["seed"])
breadths = []
gaps = []
patterns = [np.array(sorted(v)) for v in footprints[ref].values()]
for _ in range(20000):
    cover = np.zeros(L, dtype=bool)
    for indices in patterns:
        cover[(indices + int(rng.integers(L))) % L] = True
    breadths.append(float(cover.mean()))
    gaps.append(longest_gap(cover))
null = dict(
    reference_id=ref,
    unique_fragments=len(patterns),
    seed=CONFIG["seed"],
    replicates=20000,
    observed_breadth=float(observed.mean()),
    observed_longest_uncovered_run=longest_gap(observed),
    null_breadth_quantiles=np.quantile(breadths, [0.025, 0.5, 0.975]).tolist(),
    fraction_simulations_breadth_le_observed=float(
        np.mean(np.array(breadths) <= observed.mean())
    ),
    null_longest_gap_quantiles=np.quantile(gaps, [0.025, 0.5, 0.975]).tolist(),
    fraction_simulations_gap_ge_observed=float(
        np.mean(np.array(gaps) >= longest_gap(observed))
    ),
    assumptions="conditional circular random placement of observed fragment footprints; ignores sequence bias, divergence and terminal effects; not a clinical p value",
)
(OUT / "tpa_coverage_null.json").write_text(json.dumps(null, indent=2) + "\n")
print(json.dumps(null, indent=2))
print(
    "BwBSH2 site audit:",
    [
        (
            x["sample_reference_position"],
            x["BQ20_call"],
            x["BQ20_complete_codon_fragments"],
        )
        for x in site_rows
        if x["gene"] == "BwBSH2"
    ],
)
