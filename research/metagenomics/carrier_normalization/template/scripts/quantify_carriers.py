"""Group-aware local read quantification, with fragment and duplication sensitivities.
Alleles within a validated group may tie. Different groups must have AS gap >=10.
Breadth is projected to relative-position bins, not an assembled-gene completeness call.
"""
import argparse, collections, csv, hashlib, itertools, json
from pathlib import Path
import numpy as np
import pysam
from carrier_config import ROOT, CONFIG

R = ROOT / "results/carrier_normalization/references"
W = ROOT / "analysis/carrier_normalization/work"
OLD = ROOT / "analysis/followup/controls"


def read_tsv(path):
    with Path(path).open() as f:
        return list(csv.DictReader(f, delimiter="\t"))


def write_tsv(path, rows):
    with Path(path).open("w") as f:
        w = csv.DictWriter(f, rows[0], delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def fragment(name):
    return name[:-2] if name.endswith(("/1", "/2")) else name


def metrics(a):
    cols = sum(n for op, n in a.cigartuples if op in (0, 1, 2, 7, 8))
    span = sum(n for op, n in a.cigartuples if op in (0, 1, 7, 8))
    return (
        1 - a.get_tag("NM") / cols if cols else 0,
        span / a.infer_read_length(),
        span,
        cols,
    )


def classify(alignments, refs, min_identity=0.95):
    ordered = sorted(
        [a for a in alignments if not a.is_unmapped and not a.is_supplementary],
        key=lambda a: (-a.get_tag("AS"), a.reference_name, a.reference_start),
    )
    if not ordered:
        return None, "unmapped"
    if len(ordered) >= 50:
        return None, "hit_cap"
    a = ordered[0]
    ref = refs[a.reference_name]
    group = ref.get("classification_group", ref["group"])
    if group != ref["group"]:
        full = [
            x
            for x in ordered
            if refs[x.reference_name]["group"] == group
            and refs[x.reference_name].get("kind") == "target"
        ]
        if not full:
            return a, "partial_reference_only"
        a = full[0]
    other = [
        x.get_tag("AS")
        for x in ordered
        if refs[x.reference_name].get(
            "classification_group", refs[x.reference_name]["group"]
        )
        != group
    ]
    if other and a.get_tag("AS") - max(other) < 10:
        return a, "cross_group_ambiguity"
    identity, qcov, span, cols = metrics(a)
    if identity < min_identity or qcov < 0.9 or span < 80:
        return a, "identity_length_coverage"
    return a, "accepted"


def contribution(a, length, trim=None):
    trim = CONFIG["max_read_length"] if trim is None else trim
    full = core = 0
    for start, end in a.get_blocks():
        full += end - start
        core += max(0, min(end, length - trim) - max(start, trim))
    return full / length, core / (length - 2 * trim) if length > 2 * trim else 0


def main(name):
    d = W / name
    d.mkdir(exist_ok=True)
    refs = {r["reference_id"]: r for r in read_tsv(R / "mapping_panel_manifest.tsv")}
    groups = {}
    for rid, r in refs.items():
        if r["kind"] not in ["marker", "diagnostic_marker", "target"]:
            continue
        g = r["group"]
        if g not in groups:
            groups[g] = dict(kind=r["kind"], species=r["species"], lengths=[])
        groups[g]["lengths"].append(int(r["length"]))
    # strict includes targets/markers; relaxed target-only uses the same strict denominator.
    data = {
        mode: {
            g: {} for g in groups if mode == "strict" or groups[g]["kind"] == "target"
        }
        for mode in ["strict", "relaxed90"]
    }
    breadth = {
        mode: {
            g: np.zeros(min(500, min(groups[g]["lengths"])), dtype=bool)
            for g in data[mode]
        }
        for mode in data
    }
    decisions = collections.Counter()
    read_metrics = collections.defaultdict(lambda: np.zeros(3))
    with pysam.AlignmentFile(str(d / "panel.bam"), "rb") as bam:
        for qn, aa in itertools.groupby(
            bam.fetch(until_eof=True), key=lambda a: a.query_name
        ):
            alns = list(aa)
            for mode, minimum in [("strict", 0.95), ("relaxed90", 0.90)]:
                a, decision = classify(alns, refs, minimum)
                decisions[mode + ":" + decision] += 1
                if decision != "accepted":
                    continue
                ref = refs[a.reference_name]
                g = ref["group"]
                if g not in data[mode]:
                    continue
                n = int(ref["length"])
                fid = fragment(qn)
                v = data[mode][g].setdefault(fid, np.zeros(4))
                full, core = contribution(a, n)
                v += np.array([full, core, 1 / n, 1])
                ident, qcov, span, cols = metrics(a)
                read_metrics[(mode, g)] += np.array([1, cols * ident, cols])
                for start, end in a.get_blocks():
                    # Pooled relative-position occupancy for allele groups; indels are not phased.
                    nbins = len(breadth[mode][g])
                    inds = np.minimum(nbins - 1, np.arange(start, end) * nbins // n)
                    breadth[mode][g][inds] = True
    # Reuse original exact-reference acceptance, recomputing interior depth consistently.
    orig_manifest = read_tsv(
        ROOT / "results/followup/references/reference_manifest_v2.tsv"
    )
    orig_lengths = {
        r["mapping_reference_id"]: int(r["reference_nt_length"]) for r in orig_manifest
    }
    exact = {g: {} for g, v in groups.items() if v["kind"] == "target"}
    import sys

    sys.path.insert(0, str(ROOT / "results/followup/scripts"))
    from common import groups as old_groups

    for mate in [1, 2]:
        for a, decision, md in old_groups(OLD / name / f"panel_mate{mate}.bam"):
            if decision != "accepted" or a.reference_name not in exact:
                continue
            g = a.reference_name
            v = exact[g].setdefault(fragment(a.query_name), np.zeros(4))
            n = orig_lengths[g]
            full, core = contribution(a, n)
            v += np.array([full, core, 1 / n, 1])
    data["exact"] = exact
    original_rows = {
        r["reference_id"]: r for r in read_tsv(OLD / name / "gene_quantification.tsv")
    }
    stat = read_tsv(OLD / name / "nonhost_stats.tsv")
    total = int(stat[0]["num_seqs"])
    assert total == int(stat[1]["num_seqs"])
    unique_total = int(
        next(iter(original_rows.values()))["exact_unique_nonhost_sequence_pairs"]
    )
    wanted = set()
    for mm in data.values():
        for fs in mm.values():
            wanted.update(fs)
    take = CONFIG["common_depth"]
    assert total >= take, "Library below declared common depth"
    selected = np.zeros(total, dtype=bool)
    selected[
        np.random.default_rng(CONFIG["seed"]).choice(total, take, replace=False)
    ] = True
    chosen = set()
    hashes = {}
    seen = 0
    with pysam.FastxFile(str(OLD / name / "nonhost_1.fastq.gz")) as f1, pysam.FastxFile(
        str(OLD / name / "nonhost_2.fastq.gz")
    ) as f2:
        for i, pair in enumerate(itertools.zip_longest(f1, f2)):
            a, b = pair
            assert a is not None and b is not None, "unpaired input"
            fid = fragment(a.name)
            assert fid == fragment(b.name), "mate order mismatch"
            seen += 1
            if fid in wanted:
                hashes[fid] = hashlib.blake2b(
                    (a.sequence + "\0" + b.sequence).encode(), digest_size=16
                ).digest()
                if selected[i]:
                    chosen.add(fid)
    assert seen == total and len(hashes) == len(wanted), (
        seen,
        total,
        len(hashes),
        len(wanted),
    )
    out = []
    for mode, mm in data.items():
        for g, fs in mm.items():
            collapsed = {}
            for fid, v in fs.items():
                collapsed.setdefault(hashes[fid], v)
            for sensitivity, values, denom in [
                ("full", list(fs.values()), total),
                ("common2M", [v for f, v in fs.items() if f in chosen], take),
                ("exact_pair_collapsed", list(collapsed.values()), unique_total),
            ]:
                v = np.sum(values, axis=0) if values else np.zeros(4)
                count = len(values)
                fpkm = sum(x[2] / x[3] for x in values) * 1e9 / denom
                out.append(
                    dict(
                        sample=name,
                        mode=mode,
                        sensitivity=sensitivity,
                        group=g,
                        kind=groups[g]["kind"],
                        species=groups[g]["species"],
                        reference_alleles=len(groups[g]["lengths"])
                        if mode != "exact"
                        else 1,
                        median_reference_length=float(np.median(groups[g]["lengths"]))
                        if mode != "exact"
                        else orig_lengths[g],
                        nonhost_fragments=denom,
                        fragments=count,
                        core_supporting_fragments=sum(x[1] > 0 for x in values),
                        core_weight_sum_squares=sum(x[1] ** 2 for x in values),
                        accepted_reads=int(v[3]),
                        read_depth=v[0],
                        interior_read_depth=v[1],
                        FPKM=fpkm,
                        relative_position_breadth_pct=float(
                            breadth[mode][g].mean() * 100
                        )
                        if mode != "exact" and sensitivity == "full"
                        else "NA",
                        exact_breadth_pct=original_rows[g]["breadth_pct"]
                        if mode == "exact" and sensitivity == "full"
                        else "NA",
                        aligned_identity_pct=100
                        * read_metrics[(mode, g)][1]
                        / read_metrics[(mode, g)][2]
                        if mode != "exact" and read_metrics[(mode, g)][2]
                        else "NA",
                    )
                )
    write_tsv(d / "group_quantification.tsv", out)
    (d / "quantification_metrics.json").write_text(
        json.dumps(
            dict(
                sample=name,
                nonhost_fragments=total,
                exact_unique_nonhost_pairs=unique_total,
                mapped_fragment_ids=len(wanted),
                read_decisions=dict(decisions),
                read_identity_thresholds=[0.95, 0.90],
                minimum_query_coverage=0.9,
                minimum_aligned_nt=80,
                min_between_group_score_gap=10,
                maximum_reported_hits=50,
                interior_trim_nt=CONFIG["max_read_length"],
                rarefaction_seed=CONFIG["seed"],
            ),
            indent=2,
        )
        + "\n"
    )
    (d / "QUANTIFICATION_COMPLETE").touch()
    print(name, "quantified", len(wanted), "fragment IDs", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("sample")
    main(p.parse_args().sample)
