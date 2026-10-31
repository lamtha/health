"""Allow exact protein-sequence aliases without relaxing cross-protein competition."""
from collections import defaultdict


def protein_groups(sequences):
    by_sequence = defaultdict(list)
    for reference, seq in sequences.items():
        by_sequence[seq].append(reference)
    return {
        reference: tuple(sorted(members))
        for members in by_sequence.values()
        for reference in members
    }


def competing_score_gap(parsed, equivalence):
    best = max(parsed, key=lambda row: float(row[11]))
    same = equivalence.get(best[1], (best[1],))
    others = [float(row[11]) for row in parsed if row[1] not in same]
    return float(best[11]) - max(others) if others else float("inf")
