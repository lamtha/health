"""Validate measured tables against the frozen references and preselected cohorts."""
import csv
import json
import math
from common import OUT, REF, CONFIG


def table(path):
    with path.open() as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def validate_rows(rows, references, names):
    expected = {(name, ref) for name in names for ref in references}
    actual = [(r["sample"], r["reference_id"]) for r in rows]
    if len(actual) != len(set(actual)) or set(actual) != expected:
        raise ValueError("Missing or duplicate sample/reference rows")
    for row in rows:
        ref = references[row["reference_id"]]
        n, k, reads = (
            int(row[f])
            for f in ("nonhost_fragments", "unique_fragments", "accepted_reads")
        )
        if not 0 <= k <= n or n <= 0 or not k <= reads <= 2 * k:
            raise ValueError("Invalid paired counts")
        if row["reference_sha256"] != ref["reference_nt_sha256"]:
            raise ValueError("Reference hash differs")
        for field in ("breadth_pct", "rarefied_breadth_pct"):
            if not 0 <= float(row[field]) <= 100:
                raise ValueError("Invalid coverage")
        if k and not 95 <= float(row["aligned_identity_pct"]) <= 100:
            raise ValueError("Identity below acceptance rule")
        unique_n, unique_k = (
            int(row[f])
            for f in (
                "exact_unique_nonhost_sequence_pairs",
                "exact_unique_target_sequence_pairs",
            )
        )
        rare_n, rare_k = (
            int(row[f])
            for f in ("rarefied_total_fragments", "rarefied_unique_fragments")
        )
        if not (
            0 < unique_n <= n
            and 0 <= unique_k <= min(k, unique_n)
            and 0 < rare_n <= n
            and 0 <= rare_k <= min(k, rare_n)
        ):
            raise ValueError("Invalid sensitivity counts")
        length = int(ref["reference_nt_length"])
        for field, value in [
            ("FPKM", k * 1e9 / length / n),
            ("deduplicated_FPKM", unique_k * 1e9 / length / unique_n),
            ("rarefied_FPKM", rare_k * 1e9 / length / rare_n),
        ]:
            if not math.isclose(float(row[field]), value, rel_tol=1e-9, abs_tol=1e-12):
                raise ValueError("Abundance denominator mismatch")


def main():
    references = {
        r["mapping_reference_id"]: r for r in table(REF / "reference_manifest_v2.tsv")
    }
    sample = table(OUT / "gene_hits.tsv")
    validate_rows(sample, references, {"sample_original"})
    controls = table(OUT / "control_manifest.tsv")
    counts = dict(
        references=len(references),
        controls=len(controls),
        original_sample_rows=len(sample),
    )
    if controls:
        names = {"sample_local"} | {r["run_accession"] for r in controls}
        rows = table(OUT / "control_gene_abundances.tsv")
        validate_rows(rows, references, names)
        if any(
            int(r["rarefied_total_fragments"]) != CONFIG["common_depth"] for r in rows
        ):
            raise ValueError("Comparison did not reach predeclared common depth")
        cohorts = {"all_controls": len(controls)}
        for row in controls:
            for label in filter(None, row["cohorts"].split(";")):
                cohorts[label] = cohorts.get(label, 0) + 1
        comparison = table(OUT / "control_gene_comparison.tsv")
        keys = [(r["reference_id"], r["cohort"], r["measure"]) for r in comparison]
        expected = {
            (r, c, m)
            for r in references
            for c in cohorts
            for m in ("FPKM", "rarefied_FPKM", "deduplicated_FPKM")
        }
        if len(keys) != len(set(keys)) or set(keys) != expected:
            raise ValueError("Incomplete comparison")
        for row in comparison:
            n = int(row["n_independent_controls"])
            if (
                n != cohorts[row["cohort"]]
                or sum(
                    int(row[f])
                    for f in ("controls_lower", "controls_equal", "controls_higher")
                )
                != n
            ):
                raise ValueError("Cohort counts disagree")
            quantiles = [
                float(row[f])
                for f in (
                    "control_min",
                    "control_q25",
                    "control_median",
                    "control_q75",
                    "control_max",
                )
            ]
            if sorted(quantiles) != quantiles:
                raise ValueError("Quantile order invalid")
        counts.update(comparison_rows=len(comparison), sample_gene_rows=len(rows))
    (OUT / "versions/output_validation.json").write_text(
        json.dumps(dict(status="passed", **counts), indent=2) + "\n"
    )
    print("Output validation passed")


if __name__ == "__main__":
    main()
