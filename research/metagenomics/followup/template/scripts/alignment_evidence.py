"""Aggregate aligned spans without summing overlapping loci or duplicate records."""


def union_length(intervals):
    end = total = 0
    for start, stop in sorted(intervals):
        if start < 0 or stop < start:
            raise ValueError("Expected zero-based half-open coordinates")
        total += max(0, stop - max(start, end))
        end = max(end, stop)
    return total


def context_summary(hits, length):
    primary = [h for h in hits if h["alignment_type"] == "P"]
    references = {h["reference"] for h in primary}
    if not references:
        return dict(
            best_context_reference="none",
            best_context_identity_pct="NA",
            best_context_contig_breadth_pct=0,
            best_context_largest_block_pct=0,
            context_breadth_definition="union of primary query intervals for one context reference",
        )
    by_reference = {r: [h for h in primary if h["reference"] == r] for r in references}
    reference = min(
        references,
        key=lambda r: (
            -union_length(
                [(h["query_start"], h["query_end"]) for h in by_reference[r]]
            ),
            r,
        ),
    )
    selected = by_reference[reference]
    best = max(selected, key=lambda h: h["query_end"] - h["query_start"])
    return dict(
        best_context_reference=reference,
        best_context_identity_pct=best["identity"],
        best_context_contig_breadth_pct=100
        * union_length([(h["query_start"], h["query_end"]) for h in selected])
        / length,
        best_context_largest_block_pct=100
        * (best["query_end"] - best["query_start"])
        / length,
        context_breadth_definition="union of primary query intervals for one context reference; identity is largest primary block",
    )


def unique_mate_loci(records):
    result = {}
    for a in records:
        key = (a.reference_id, a.reference_start, a.is_reverse, a.cigarstring)
        if key not in result or a.get_tag("AS") > result[key].get_tag("AS"):
            result[key] = a
    return sorted(result.values(), key=lambda a: -a.get_tag("AS"))
