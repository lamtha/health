"""Depth-aware evidence labels; uncovered reference positions are not deletions."""
import math


def coverage_evidence(reads, fragments, breadth, depth, starts, partial, ambiguous=0):
    if not reads:
        call, quality = (
            ("ambiguous_reference_compatible_reads", "unresolved_homology")
            if ambiguous
            else ("no_qualifying_reference_match", "not_detected_by_this_panel")
        )
    elif fragments < 3 or breadth < 0.10:
        call, quality = "trace_fragment_evidence", "very_low"
    elif partial:
        call, quality = "partial_reference_only", "limited_by_incomplete_reference"
    elif breadth >= 0.95 and depth >= 5 and starts >= 10:
        call, quality = "broad_reference_coverage", "high_for_DNA_match_only"
    elif depth < 5:
        call, quality = (
            "depth_limited_reference_evidence",
            "limited_by_sampling_and_reference_coverage",
        )
    elif breadth >= 0.80 and fragments >= 5:
        call, quality = (
            "substantial_incomplete_reference_coverage",
            "moderate_for_DNA_match_only",
        )
    else:
        call, quality = "incomplete_reference_coverage", "low_for_DNA_match_only"
    return dict(
        detection_call=call,
        evidence_quality=quality,
        expected_breadth_uniform_poisson_pct=100 * -math.expm1(-depth),
        breadth_model_scope="1-exp(-mean depth); illustrative independent uniform sampling only; ignores paired dependence, ends, mapping and library bias; not a deletion test",
        incomplete_reference=bool(partial),
    )
