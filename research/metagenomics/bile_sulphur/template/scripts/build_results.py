"""Report robust carrier-normalized DNA abundance and technical uncertainty.
No RNA/expression, enzyme activity, clinical reference intervals or causal claims.
"""
from bile_sulphur_config import ROOT, CONFIG
import collections, csv, hashlib, json, math
from pathlib import Path
import numpy as np
from quantify_carriers import ROOT, R, W, OLD, write_tsv

O = ROOT / "results/bile_sulphur"
NBOOT = CONFIG["resamples"]
SEED = CONFIG["interval_seed"]
control = list(
    csv.DictReader(open(ROOT / "results/followup/control_manifest.tsv"), delimiter="\t")
)
cohorts = {r["run_accession"]: r.get("cohorts", "") for r in control}
cohort_names = ["all_controls"] + sorted(
    {c for r in control for c in r.get("cohorts", "").split(";") if c}
)
names = ["sample_local"] + [r["run_accession"] for r in control]
assert all(
    (W / n / "QUANTIFICATION_COMPLETE").exists() for n in names
), "All preselected libraries must finish"
rows = []
for name in names:
    rows += list(
        csv.DictReader(open(W / name / "group_quantification.tsv"), delimiter="\t")
    )
# Uniform columns across earlier full-depth replay and current quantification.
fields = list(dict.fromkeys(k for r in rows for k in r))
rows = [{k: r.get(k, "NA") for k in fields} for r in rows]
write_tsv(O / "group_abundances.tsv", rows)
carriers = []
boot = {}
fullboot = {}
lookup = {}
for name in names:
    stats = list(csv.DictReader(open(OLD / name / "nonhost_stats.tsv"), delimiter="\t"))
    total_bases = sum(int(r["sum_len"]) for r in stats)
    for sensitivity in ["full", "common_depth", "exact_pair_collapsed"]:
        for species in ["bilophila", "bt"]:
            rr = [
                r
                for r in rows
                if r["sample"] == name
                and r["mode"] == "strict"
                and r["sensitivity"] == sensitivity
                and r["species"] == species
                and r["kind"] in ["marker", "diagnostic_marker"]
            ]
            dd = np.array([float(r["interior_read_depth"]) for r in rr])
            full = np.array([float(r["read_depth"]) for r in rr])
            frags = sum(int(r["fragments"]) for r in rr)
            total = int(rr[0]["nonhost_fragments"])
            positive = float((dd > 0).mean())
            breadth = (
                float(
                    np.median([float(r["relative_position_breadth_pct"]) for r in rr])
                )
                if sensitivity == "full"
                else None
            )
            seed = SEED + int(
                hashlib.sha256(f"{name}/{sensitivity}/{species}".encode()).hexdigest()[
                    :8
                ],
                16,
            )
            rng = np.random.default_rng(seed)
            bs = np.median(rng.choice(dd, (NBOOT, len(dd)), replace=True), axis=1)
            median = float(np.median(dd))
            lo, hi = np.quantile(bs, [0.025, 0.975])
            boot[(name, sensitivity, species)] = bs
            fullboot[(name, sensitivity, species)] = np.median(
                rng.choice(full, (NBOOT, len(full)), replace=True), axis=1
            )
            eligible = (
                median >= 1
                and positive >= 0.7
                and frags >= 100
                and (breadth is None or breadth >= 50)
                and lo > 0
            )
            full_lo, full_hi = np.quantile(
                fullboot[(name, sensitivity, species)], [0.025, 0.975]
            )
            full_eligible = (
                species != "gnavus_SGB4571"
                and float(np.median(full)) >= 1
                and float((full > 0).mean()) >= 0.7
                and frags >= 100
                and (breadth is None or breadth >= 50)
                and full_lo > 0
            )
            status = (
                "well_covered"
                if eligible and median >= 5
                else "limited_but_eligible"
                if eligible
                else "low_coverage_exploratory"
                if median > 0
                else "no_robust_carrier_denominator"
            )
            row = dict(
                sample=name,
                cohorts=cohorts.get(name, "sample"),
                species=species,
                sensitivity=sensitivity,
                marker_loci=len(dd),
                positive_marker_fraction=positive,
                marker_fragment_locus_assignments=frags,
                median_interior_depth=median,
                depth_bootstrap_low=float(lo),
                depth_bootstrap_high=float(hi),
                median_full_depth=float(np.median(full)),
                full_depth_bootstrap_low=float(full_lo),
                full_depth_bootstrap_high=float(full_hi),
                eligible_full_depth_ratio_comparison=full_eligible,
                full_depth_coverage_status=(
                    "unvalidated_SGB_diagnostic"
                    if species == "gnavus_SGB4571"
                    else "well_covered"
                    if full_eligible and float(np.median(full)) >= 5
                    else "limited_but_eligible"
                    if full_eligible
                    else "low_coverage_exploratory"
                    if float(np.median(full)) > 0
                    else "no_robust_carrier_denominator"
                ),
                trimmed_mean_interior_depth=float(
                    np.mean(np.sort(dd)[len(dd) // 10 : len(dd) - len(dd) // 10])
                ),
                trimmed_mean_full_depth=float(
                    np.mean(
                        np.sort(full)[len(full) // 10 : len(full) - len(full) // 10]
                    )
                ),
                mean_interior_depth=float(np.mean(dd)),
                depth_q25=float(np.quantile(dd, 0.25)),
                depth_q75=float(np.quantile(dd, 0.75)),
                median_relative_position_breadth_pct=breadth
                if breadth is not None
                else "NA",
                nonhost_fragments=total,
                carrier_depth_per_million_fragments=median * 1e6 / total,
                carrier_depth_per_gigabase=median * 1e9 / total_bases
                if sensitivity == "full"
                else "NA",
                eligible_primary_ratio_comparison=eligible,
                coverage_status=status,
            )
            carriers.append(row)
            lookup[(name, sensitivity, species)] = row
write_tsv(O / "carrier_abundance.tsv", carriers)
manifest = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader(
        open(ROOT / "results/bile_sulphur/references/curated_reference_manifest.tsv"),
        delimiter="\t",
    )
}
ratios = []
for r in rows:
    if r["kind"] != "target":
        continue
    name = r["sample"]
    sensitivity = r["sensitivity"]
    sp = r["species"]
    g = r["group"]
    c = lookup[(name, sensitivity, sp)]
    short = float(r["median_reference_length"]) < max(
        600, 2 * CONFIG["max_read_length"] + 1
    )
    den = c["median_full_depth"] if short else c["median_interior_depth"]
    value = float(r["read_depth"] if short else r["interior_read_depth"])
    ratio = value / den if den > 0 else None
    low = high = None
    ci_method = "not_calculated_for_sensitivity"
    if (
        sensitivity == "full"
        and den > 0
        and c["full_depth_bootstrap_low" if short else "depth_bootstrap_low"] > 0
    ):
        db = (fullboot if short else boot)[(name, sensitivity, sp)]
        seed = SEED + int(
            hashlib.sha256(f'{name}/{r["mode"]}/{g}'.encode()).hexdigest()[:8], 16
        )
        rng = np.random.default_rng(seed)
        if value > 0:
            variance = float(
                r["full_weight_sum_squares"] if short else r["core_weight_sum_squares"]
            )
            effective_count = value * value / variance
            scale = variance / value
            draws = rng.gamma(effective_count + 0.5, scale, size=NBOOT)
            valid = db > 0
            low, high = np.quantile(draws[valid] / db[valid], [0.025, 0.975])
            ci_method = "weighted_fragment_gamma_plus_marker_locus_bootstrap"
        else:
            length = float(r["median_reference_length"])
            low = 0.0
            high = (
                -math.log(0.025)
                * (2 * CONFIG["max_read_length"])
                / (length if short else length - (2 * CONFIG["max_read_length"]))
                / float(np.quantile(db, 0.025))
            )
            ci_method = "zero_count_conservative_fragment_upper_bound"
    out = dict(
        sample=name,
        cohorts=cohorts.get(name, "sample"),
        species=sp,
        reference_id=g,
        gene=manifest[g]["gene"],
        reference_protein_accession=manifest[g]["protein_accession"],
        reference_function_evidence=manifest[g]["reference_evidence"],
        reference_role=manifest[g]["reference_role"],
        mode=r["mode"],
        sensitivity=sensitivity,
        community_FPKM=float(r["FPKM"]),
        gene_fragments=int(r["fragments"]),
        gene_interior_depth=float(r["interior_read_depth"]),
        carrier_median_interior_depth=c["median_interior_depth"],
        normalization_gene_depth=value,
        normalization_marker_depth=den,
        normalization_basis="full_gene_and_marker_depth_short_gene"
        if short
        else "interior_gene_and_marker_depth",
        gene_to_marker_ratio=ratio if ratio is not None else "NA",
        gene_full_depth=float(r["read_depth"]),
        carrier_median_full_depth=c["median_full_depth"],
        full_depth_gene_to_marker_ratio=float(r["read_depth"]) / c["median_full_depth"]
        if c["median_full_depth"] > 0
        else "NA",
        short_interior_warning=short,
        trimmed_mean_gene_to_marker_ratio=value
        / c["trimmed_mean_full_depth" if short else "trimmed_mean_interior_depth"]
        if c["trimmed_mean_full_depth" if short else "trimmed_mean_interior_depth"] > 0
        else "NA",
        technical_interval_low=float(low) if low is not None else "NA",
        technical_interval_high=float(high) if high is not None else "NA",
        technical_interval_method=ci_method,
        eligible_primary_ratio_comparison=c[
            "eligible_full_depth_ratio_comparison"
            if short
            else "eligible_primary_ratio_comparison"
        ],
        carrier_coverage_status=c[
            "full_depth_coverage_status" if short else "coverage_status"
        ],
        reference_breadth_pct=r["exact_breadth_pct"]
        if r["mode"] == "exact"
        else r["relative_position_breadth_pct"],
        breadth_definition="exact_reference_bases"
        if r["mode"] == "exact"
        else "pooled_relative_position_bins",
        interpretation="DNA coverage ratio; not gene expression, measured enzyme activity or an integer copy-number call",
    )
    ratios.append(out)
write_tsv(O / "gene_to_marker_ratios.tsv", ratios)
comparisons = []
for r in ratios:
    if r["sample"] != "sample_local":
        continue
    allcontrols = [
        x
        for x in ratios
        if x["sample"] != "sample_local"
        and x["reference_id"] == r["reference_id"]
        and x["mode"] == r["mode"]
        and x["sensitivity"] == r["sensitivity"]
    ]
    for cohort in cohort_names:
        controls = (
            allcontrols
            if cohort == "all_controls"
            else [x for x in allcontrols if cohort in x["cohorts"].split(";")]
        )
        eligible = [
            x
            for x in controls
            if x["eligible_primary_ratio_comparison"]
            and x["gene_to_marker_ratio"] != "NA"
        ]
        vals = [x["gene_to_marker_ratio"] for x in eligible]
        community = [x["community_FPKM"] for x in controls]
        sample_ratio = r["gene_to_marker_ratio"]
        ratio_position = "insufficient_eligible_controls"
        if not r["eligible_primary_ratio_comparison"]:
            ratio_position = "sample_carrier_low_coverage"
        elif len(vals) >= 3 and sample_ratio != "NA":
            ratio_position = (
                "above_observed_carrier_range"
                if sample_ratio > max(vals)
                else "below_observed_carrier_range"
                if sample_ratio < min(vals)
                else "within_observed_carrier_range"
            )
        comparisons.append(
            dict(
                reference_id=r["reference_id"],
                gene=r["gene"],
                species=r["species"],
                reference_role=r["reference_role"],
                mode=r["mode"],
                sensitivity=r["sensitivity"],
                cohort=cohort,
                community_controls=len(controls),
                eligible_carrier_controls=len(vals),
                sample_FPKM=r["community_FPKM"],
                control_FPKM_min=min(community),
                control_FPKM_max=max(community),
                community_position="above_observed_range"
                if r["community_FPKM"] > max(community)
                else "below_observed_range"
                if r["community_FPKM"] < min(community)
                else "within_observed_range",
                sample_gene_to_marker_ratio=sample_ratio,
                sample_technical_low=r["technical_interval_low"],
                sample_technical_high=r["technical_interval_high"],
                eligible_control_ratio_median=float(np.median(vals)) if vals else "NA",
                eligible_control_ratio_min=min(vals) if vals else "NA",
                eligible_control_ratio_max=max(vals) if vals else "NA",
                eligible_control_ids=";".join(x["sample"] for x in eligible),
                ratio_position=ratio_position,
                comparison_scope="descriptive observed range; not a healthy population reference interval",
            )
        )
write_tsv(O / "sample_control_comparison.tsv", comparisons)
json.dump(
    dict(
        bootstrap_draws=NBOOT,
        seed=SEED,
        carrier_min_median_interior_depth=1,
        carrier_min_positive_marker_fraction=0.7,
        carrier_min_fragment_locus_assignments=100,
        carrier_min_median_relative_position_breadth_pct=50,
        carrier_bootstrap_lower_must_be_positive=True,
        minimum_eligible_controls_for_descriptive_rank=3,
        marker_depth_aggregation="median across all selected loci including zeros",
        gene_ratio_denominator="matched sensitivity and carrier group; strict marker median interior depth, or full depth below the configured trim-aware short-gene threshold",
        interior_trim_nt=CONFIG["max_read_length"],
        short_gene_full_depth_threshold_nt=max(600, 2 * CONFIG["max_read_length"] + 1),
        short_gene_eligibility_basis="full marker depth and full-depth bootstrap",
        interval_scope="technical uncertainty only; no between-person, batch, reference-panel or ecological uncertainty",
    ),
    open(O / "analysis_parameters.json", "w"),
    indent=2,
)
print(
    "carriers",
    len(carriers),
    "ratios",
    len(ratios),
    "comparisons",
    len(comparisons),
    flush=True,
)
