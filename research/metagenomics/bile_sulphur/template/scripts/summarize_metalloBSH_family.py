"""Compare complementary metalloBSH forms without equating copies with activity.
The sum is a reference-compatible DNA coverage index, not a flux measurement.
Fragment covariance across both family members is retained in the uncertainty.
"""
from bile_sulphur_config import ROOT, CONFIG
import collections, csv, hashlib, itertools, math
from pathlib import Path
import numpy as np, pysam
from quantify_carriers import ROOT, R, W, classify, fragment, contribution, write_tsv

O = ROOT / "results/bile_sulphur"
MEMBERS = ["WP_005025869_1", "WP_016360761_1"]
NBOOT = CONFIG["resamples"]
SEED = CONFIG["interval_seed"]


def combine_fragment_weights(per_member):
    combined = collections.defaultdict(float)
    for members in per_member.values():
        for fid, value in members.items():
            combined[fid] += value
    return sum(combined.values()), sum(v * v for v in combined.values()), len(combined)


def main():
    refs = {
        r["reference_id"]: r
        for r in csv.DictReader(open(R / "mapping_panel_manifest.tsv"), delimiter="\t")
    }
    rows = list(csv.DictReader(open(O / "group_abundances.tsv"), delimiter="\t"))
    carriers = {
        (r["sample"], r["sensitivity"]): r
        for r in csv.DictReader(open(O / "carrier_abundance.tsv"), delimiter="\t")
        if r["species"] == "bilophila"
    }
    output = []
    for name in sorted({r["sample"] for r in rows}):
        weights = {g: collections.defaultdict(float) for g in MEMBERS}
        with pysam.AlignmentFile(str(W / name / "panel.bam"), "rb") as bam:
            for qn, aa in itertools.groupby(
                bam.fetch(until_eof=True), key=lambda a: a.query_name
            ):
                a, decision = classify(list(aa), refs)
                if decision != "accepted":
                    continue
                r = refs[a.reference_name]
                if r["kind"] == "target" and r["group"] in MEMBERS:
                    weights[r["group"]][fragment(qn)] += contribution(
                        a, int(r["length"])
                    )[1]
        total, variance, n = combine_fragment_weights(weights)
        for sensitivity in ["full", "common_depth", "exact_pair_collapsed"]:
            rr = {
                r["group"]: r
                for r in rows
                if r["sample"] == name
                and r["mode"] == "strict"
                and r["sensitivity"] == sensitivity
                and r["group"] in MEMBERS
            }
            c = carriers[(name, sensitivity)]
            den = float(c["median_interior_depth"])
            s = sum(float(r["interior_read_depth"]) for r in rr.values())
            ratio = s / den if den else "NA"
            low = high = "NA"
            if sensitivity == "full":
                assert np.isclose(s, total)
                marker = np.array(
                    [
                        float(r["interior_read_depth"])
                        for r in rows
                        if r["sample"] == name
                        and r["mode"] == "strict"
                        and r["sensitivity"] == "full"
                        and r["kind"] == "marker"
                        and r["species"] == "bilophila"
                    ]
                )
                seed = SEED + int(
                    hashlib.sha256(f"{name}/full/bilophila".encode()).hexdigest()[:8],
                    16,
                )
                rng = np.random.default_rng(seed)
                bs = np.median(
                    rng.choice(marker, (NBOOT, len(marker)), replace=True), axis=1
                )
                if den > 0 and np.quantile(bs, 0.025) > 0:
                    if s > 0:
                        draws = rng.gamma(
                            s * s / variance + 0.5, variance / s, size=NBOOT
                        )
                        low, high = np.quantile(draws / bs, [0.025, 0.975])
                    else:
                        low = 0.0
                        high = (
                            -math.log(0.025)
                            * (2 * CONFIG["max_read_length"])
                            / (
                                min(
                                    float(r["median_reference_length"])
                                    for r in rr.values()
                                )
                                - (2 * CONFIG["max_read_length"])
                            )
                            / np.quantile(bs, 0.025)
                        )
            detected = [g for g, r in rr.items() if int(r["fragments"]) > 0]
            output.append(
                dict(
                    sample=name,
                    sensitivity=sensitivity,
                    community_FPKM_sum=sum(float(r["FPKM"]) for r in rr.values()),
                    BwBSH1_fragments=rr[MEMBERS[0]]["fragments"],
                    BwBSH2_fragments=rr[MEMBERS[1]]["fragments"],
                    detected_reference_compatible_forms=";".join(
                        "BwBSH1" if g == MEMBERS[0] else "BwBSH2" for g in detected
                    )
                    or "none",
                    gene_to_marker_ratio_sum=ratio,
                    technical_interval_low=low,
                    technical_interval_high=high,
                    eligible_carrier=c["eligible_primary_ratio_comparison"],
                    carrier_depth=den,
                    fragment_weight_square_sum=variance
                    if sensitivity == "full"
                    else "NA",
                    unique_family_fragments=n if sensitivity == "full" else "NA",
                    interpretation="Combined reference-compatible DNA coverage; alternative enzymes need not have equal substrate specificity or activity; no gene-expression or integer-copy claim",
                )
            )
    write_tsv(O / "metalloBSH_family.tsv", output)
    print("Combined metalloBSH index", len(output), "rows", flush=True)


if __name__ == "__main__":
    main()
