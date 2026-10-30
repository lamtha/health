"""Descriptive exact-reference comparisons; no clinical thresholds or case-control inference."""
import csv, json, collections
import numpy as np
from common import ROOT, OUT, REF, CONFIG, write_tsv

base = ROOT / "analysis/followup/controls"
manifest = list(csv.DictReader((OUT / "control_manifest.tsv").open(), delimiter="\t"))
assert (
    base / "COMPARISON_COMPLETE"
).exists(), "All preselected controls must finish before final ranking"
names = ["sample_local"] + [r["run_accession"] for r in manifest]
tables = {
    name: list(
        csv.DictReader((base / name / "gene_quantification.tsv").open(), delimiter="\t")
    )
    for name in names
}
assert all(len(t) == 124 for t in tables.values())
references = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
}
for rows in tables.values():
    for r in rows:
        ref = references[r["reference_id"]]
        r.update(
            reference_protein_accession=ref["protein_accession"],
            reference_nucleotide_accession=ref["nucleotide_accession"],
            reference_function_evidence=ref["reference_evidence"],
            reference_primary_publication=ref["primary_publication"],
        )
all_rows = [r for name in names for r in tables[name]]
write_tsv(OUT / "control_gene_abundances.tsv", all_rows)
index = {name: {r["reference_id"]: r for r in tables[name]} for name in names}
cohorts = {"all_controls": [r["run_accession"] for r in manifest]}
for row in manifest:
    for label in filter(None, row["cohorts"].split(";")):
        cohorts.setdefault(label, []).append(row["run_accession"])
if not manifest:
    raise ValueError("No preselected controls")
results = []
qc = []
rng = np.random.default_rng(CONFIG["seed"])
for name in names:
    fastp = json.loads((base / name / "fastp.json").read_text())
    b = fastp["summary"]["before_filtering"]
    a = fastp["summary"]["after_filtering"]
    nonhost = int(tables[name][0]["nonhost_fragments"])
    if name != "sample_local":
        meta = next(r for r in manifest if r["run_accession"] == name)
        assert not meta["read_count"] or b["total_reads"] == 2 * int(
            meta["read_count"]
        ), (name, "ENA/SRA depth mismatch", b["total_reads"], meta["read_count"])
    qc.append(
        dict(
            sample=name,
            raw_reads=b["total_reads"],
            filtered_reads=a["total_reads"],
            nonhost_fragments=nonhost,
            read_retention_pct=200 * nonhost / b["total_reads"],
            filtered_pairs_removed_by_host_mapping=a["total_reads"] // 2 - nonhost,
            raw_bases=b["total_bases"],
            filtered_bases=a["total_bases"],
            max_read_length=CONFIG["max_read_length"],
            common_depth_fragments=tables[name][0]["rarefied_total_fragments"],
            Q30_rate_after_filtering=a["q30_rate"],
            fastp_estimated_duplication_fraction=fastp.get("duplication", {}).get(
                "rate", "NA"
            ),
            exact_unique_nonhost_sequence_pairs=tables[name][0][
                "exact_unique_nonhost_sequence_pairs"
            ],
            exact_sequence_pair_duplicate_fraction=tables[name][0][
                "exact_sequence_pair_duplicate_fraction"
            ],
        )
    )
    qc[-1].update(
        filtered_read1_mean_length=a["read1_mean_length"],
        filtered_read2_mean_length=a["read2_mean_length"],
        quality_filter_retention_pct=100 * a["total_reads"] / b["total_reads"],
    )
for ref, patient in index["sample_local"].items():
    for cohort, controls in cohorts.items():
        for measure in ["FPKM", "rarefied_FPKM", "deduplicated_FPKM"]:
            values = np.array([float(index[n][ref][measure]) for n in controls])
            value = float(patient[measure])
            median = float(np.median(values))
            lower = int(np.sum(values < value))
            equal = int(np.sum(values == value))
            greater = int(np.sum(values > value))
            results.append(
                dict(
                    reference_id=ref,
                    gene=patient["gene"],
                    reference_source_organism=patient["reference_source_organism"],
                    pathway=patient["pathway"],
                    reference_role=patient["reference_role"],
                    cohort=cohort,
                    n_independent_controls=len(controls),
                    measure=measure,
                    sample_value=value,
                    control_min=float(values.min()),
                    control_q25=float(np.quantile(values, 0.25)),
                    control_median=median,
                    control_q75=float(np.quantile(values, 0.75)),
                    control_max=float(values.max()),
                    controls_lower=lower,
                    controls_equal=equal,
                    controls_higher=greater,
                    controls_with_strict_fragments=sum(
                        int(index[n][ref]["unique_fragments"]) > 0 for n in controls
                    ),
                    controls_with_broad_gene_coverage=sum(
                        index[n][ref]["detection_call"] == "broad_reference_coverage"
                        for n in controls
                    ),
                    sample_detection=patient["detection_call"],
                    fold_over_control_median=value / median
                    if median > 0
                    else "undefined_zero_median",
                    range_position="above_observed_range"
                    if value > values.max()
                    else (
                        "below_observed_range"
                        if value < values.min()
                        else "within_observed_range"
                    ),
                    interpretation="descriptive reference-compatible DNA abundance; not a healthy percentile, disease threshold, enzyme flux or total pathway capacity",
                )
            )
for r in results:
    r["fold_over_control_maximum"] = (
        r["sample_value"] / r["control_max"]
        if r["control_max"] > 0
        else "undefined_zero_maximum"
    )
write_tsv(OUT / "control_gene_comparison.tsv", results)
write_tsv(OUT / "comparison_qc_summary.tsv", qc)
profiles = []
for name in names:
    for r in csv.DictReader(
        (base / name / "gene_coverage_bins.tsv").open(), delimiter="\t"
    ):
        if r["reference_id"] in [
            "WP_016360761_1",
            "WP_005028753_1",
            "WP_008761025_1",
            "AAO76743_1",
        ]:
            profiles.append(r)
write_tsv(OUT / "control_coverage_profiles.tsv", profiles)
# Technical sampling sensitivity, not uncertainty in the healthy population.
sampling = []
for ref, p in index["sample_local"].items():
    sims = {}
    for name in names:
        r = index[name][ref]
        N = int(r["nonhost_fragments"])
        K = int(r["unique_fragments"])
        n = CONFIG["common_depth"]
        assert N >= n
        sims[name] = rng.hypergeometric(K, N - K, n, size=CONFIG["resamples"])
    for cohort, controls in cohorts.items():
        max_control = np.max(np.stack([sims[name] for name in controls]), axis=0)
        sampling.append(
            dict(
                reference_id=ref,
                gene=p["gene"],
                cohort=cohort,
                common_fragments=CONFIG["common_depth"],
                replicates=CONFIG["resamples"],
                seed=CONFIG["seed"],
                sample_fragment_count_p025=float(
                    np.quantile(sims["sample_local"], 0.025)
                ),
                sample_fragment_count_median=float(np.median(sims["sample_local"])),
                sample_fragment_count_p975=float(
                    np.quantile(sims["sample_local"], 0.975)
                ),
                fraction_resamples_above_all_controls=float(
                    np.mean(sims["sample_local"] > max_control)
                ),
                interpretation="hypergeometric sampling of observed read pairs only; no biological/batch uncertainty or clinical significance",
            )
        )
write_tsv(OUT / "control_depth_sensitivity.tsv", sampling)
(OUT / "control_comparison_complete.json").write_text(
    json.dumps(
        dict(
            controls=len(manifest),
            cohorts={label: len(members) for label, members in cohorts.items()},
            genes=len(references),
            local_targeted_pipeline_identical=True,
            sample_and_controls_max_length=CONFIG["max_read_length"],
            common_nonhost_depth=CONFIG["common_depth"],
            cohort_matching="user predeclared public-control manifest; identical local processing cannot establish demographic, clinical or laboratory matching",
        ),
        indent=2,
    )
    + "\n"
)
print(
    "Completed descriptive comparisons for",
    len(manifest),
    "controls and 124 references",
)
