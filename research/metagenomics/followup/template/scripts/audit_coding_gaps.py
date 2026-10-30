"""Audit rejected terminal alignments and observable coding disruptions locally."""
import collections, json
from Bio import SeqIO
from common import WORK, OUT, groups, fragment, write_tsv

wanted = {"WP_016360761_1", "WP_005028753_1"}
stops = {
    r.id: [i + 1 for i, aa in enumerate(str(r.seq)[:-1]) if aa == "*"]
    for r in SeqIO.parse(WORK / "recovered/masked_consensus.faa", "fasta")
    if r.id in wanted
}
indels = collections.defaultdict(set)
rejected = []
for mate in (1, 2):
    for a, decision, m in groups(WORK / f"panel_v2/mate{mate}.bam"):
        if a.reference_name not in wanted:
            continue
        if decision != "accepted":
            if a.reference_name == "WP_005028753_1":
                rejected.append(
                    dict(
                        mate=mate,
                        decision=decision,
                        reference_start=a.reference_start + 1,
                        reference_end=a.reference_end,
                        **m,
                    )
                )
            continue
        pos = a.reference_start
        for op, n in a.cigartuples:
            if op in (1, 2):
                indels[
                    (
                        a.reference_name,
                        pos + 1,
                        "insertion" if op == 1 else "deletion",
                        n,
                    )
                ].add(fragment(a.query_name))
            if op in (0, 2, 3, 7, 8):
                pos += n
write_tsv(
    OUT / "tpa_rejected_best_alignments.tsv",
    rejected,
    [
        "mate",
        "decision",
        "reference_start",
        "reference_end",
        "identity",
        "query_coverage",
        "aligned_bases",
        "score_gap",
    ],
)
records = [
    dict(
        reference_id=k[0],
        position=k[1],
        event=k[2],
        length=k[3],
        supporting_pairs=len(v),
    )
    for k, v in indels.items()
]
(OUT / "coding_disruption_audit.json").write_text(
    json.dumps(
        dict(
            unphased_masked_consensus_internal_stop_positions=stops,
            accepted_alignment_indels=records,
            interpretation="No observed disruption in covered sequence is not evidence of an intact gene; gaps, excluded divergent alignments and unphased consensus remain limitations.",
        ),
        indent=2,
    )
    + "\n"
)
