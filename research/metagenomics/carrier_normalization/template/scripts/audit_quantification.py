"""Independently replay BAM grouping to audit counts and relative-position breadth.
Also adds compound-Poisson weight variance for full-depth technical intervals.
No FASTQ sequences or identifiers are exported.
"""
import collections, csv, itertools, json, sys
from pathlib import Path
import numpy as np
import pysam
from quantify_carriers import (
    ROOT,
    R,
    W,
    OLD,
    classify,
    contribution,
    fragment,
    write_tsv,
)

refs = {
    r["reference_id"]: r
    for r in csv.DictReader(open(R / "mapping_panel_manifest.tsv"), delimiter="\t")
}
groups = collections.defaultdict(list)
for r in refs.values():
    if r["kind"] in ["marker", "target", "diagnostic_marker"]:
        groups[r["group"]].append(int(r["length"]))
sys.path.insert(0, str(ROOT / "results/followup/scripts"))
from common import groups as original_groups

original_manifest = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader(
        open(ROOT / "results/followup/references/reference_manifest_v2.tsv"),
        delimiter="\t",
    )
}


def one(d):
    rows = list(csv.DictReader(open(d / "group_quantification.tsv"), delimiter="\t"))
    data = {}
    occ = {}
    for r in rows:
        if r["sensitivity"] == "full":
            key = (r["mode"], r["group"])
            data[key] = collections.defaultdict(lambda: np.zeros(2))
            occ[key] = np.zeros(min(500, min(groups[r["group"]])), dtype=bool)
    with pysam.AlignmentFile(str(d / "panel.bam"), "rb") as bam:
        for qn, aa in itertools.groupby(
            bam.fetch(until_eof=True), key=lambda a: a.query_name
        ):
            aa = list(aa)
            for mode, ident in [("strict", 0.95), ("relaxed90", 0.90)]:
                a, decision = classify(aa, refs, ident)
                if decision != "accepted":
                    continue
                r = refs[a.reference_name]
                key = (mode, r["group"])
                if key not in data:
                    continue
                n = int(r["length"])
                data[key][fragment(qn)] += contribution(a, n)
                bins = len(occ[key])
                for start, end in a.get_blocks():
                    occ[key][
                        np.minimum(bins - 1, np.arange(start, end) * bins // n)
                    ] = True
    for mate in [1, 2]:
        for a, decision, metrics in original_groups(
            OLD / d.name / f"panel_mate{mate}.bam"
        ):
            key = ("exact", a.reference_name)
            if decision == "accepted" and key in data:
                data[key][fragment(a.query_name)] += contribution(
                    a, int(original_manifest[a.reference_name]["reference_nt_length"])
                )
    old = {
        r["reference_id"]: r
        for r in csv.DictReader(
            open(OLD / d.name / "gene_quantification.tsv"), delimiter="\t"
        )
    }
    for r in rows:
        r.setdefault("core_supporting_fragments", "NA")
        r.setdefault("core_weight_sum_squares", "NA")
        if r["sensitivity"] != "full":
            continue
        key = (r["mode"], r["group"])
        vs = list(data[key].values())
        summed = np.sum(vs, axis=0) if vs else np.zeros(2)
        assert len(vs) == int(r["fragments"]), (d.name, key, "counts")
        assert np.allclose(
            summed,
            [float(r["read_depth"]), float(r["interior_read_depth"])],
            rtol=1e-10,
        ), (d.name, key, "depth")
        r["core_supporting_fragments"] = sum(v[1] > 0 for v in vs)
        r["core_weight_sum_squares"] = sum(v[1] ** 2 for v in vs)
        if key[0] != "exact":
            r["relative_position_breadth_pct"] = 100 * occ[key].mean()
        else:
            assert len(vs) == int(old[key[1]]["unique_fragments"])
            assert np.isclose(float(r["FPKM"]), float(old[key[1]]["FPKM"]))
            assert np.isclose(
                float(r["read_depth"]), float(old[key[1]]["mean_read_depth"])
            )
    write_tsv(d / "group_quantification.tsv", rows)
    print(d.name, "full-depth BAM replay passed", flush=True)
    return dict(
        sample=d.name,
        groups_verified=len(data),
        counts_depth_exact_original_checked=True,
        relative_position_bins="min(500, shortest allele length)",
    )


if __name__ == "__main__":
    out = [
        one(d) for d in sorted(W.iterdir()) if (d / "QUANTIFICATION_COMPLETE").exists()
    ]
    json.dump(
        out,
        open(ROOT / "results/carrier_normalization/quantification_audit.json", "w"),
        indent=2,
    )
