"""Static scientific figures; sample-derived sequence strings are not plotted."""
import csv, json, collections, os
import numpy as np
from common import OUT, WORK

os.environ.setdefault("MPLCONFIGDIR", str(WORK / "matplotlib_cache"))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update(
    {
        "font.size": 10,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.dpi": 140,
        "savefig.dpi": 180,
    }
)
base = list(
    csv.DictReader((WORK / "recovered/base_evidence.tsv").open(), delimiter="\t")
)
sites = [
    r
    for r in csv.DictReader(
        (OUT / "catalytic_site_evidence.tsv").open(), delimiter="\t"
    )
    if r["gene"] == "BwBSH2"
]
fig, ax = plt.subplots(
    2,
    1,
    figsize=(10.5, 6.5),
    gridspec_kw={"height_ratios": [1, 1.3]},
    layout="constrained",
)
x = np.arange(len(sites))
colors = [
    "#26788a"
    if "metal" in r["site_evidence"] or "lysine" in r["site_evidence"]
    else "#bd6e2a"
    if "mutagenesis" in r["site_evidence"]
    else "#777777"
    for r in sites
]
ax[0].bar(
    x - 0.15,
    [int(r["BQ20_complete_codon_fragments"]) for r in sites],
    0.3,
    color=colors,
    label="Base quality ≥20",
)
ax[0].bar(
    x + 0.15,
    [int(r["BQ30_complete_codon_fragments"]) for r in sites],
    0.3,
    color="white",
    edgecolor=colors,
    hatch="//",
    label="Base quality ≥30",
)
ax[0].set_xticks(
    x, [r["reference_residue"] + r["sample_reference_position"] for r in sites]
)
ax[0].set_ylabel("Distinct read pairs\ncovering complete codon")
ax[0].legend(frameon=False, loc="upper right", ncols=2)
ax[0].set_title(
    "BwBSH2: complete-codon support at transferred catalytic sites",
    loc="left",
    fontsize=12,
)
ax[0].text(
    0.01,
    0.95,
    "Metal/cofactor sites (blue)   Catalytic site (orange)   Predicted binding sites (gray)",
    transform=ax[0].transAxes,
    va="top",
    fontsize=8,
)
r = [v for v in base if v["reference_id"] == "WP_016360761_1"]
positions = [int(v["position_1based"]) for v in r]
depth = [int(v["fragment_depth_bq20"]) for v in r]
ax[1].fill_between(positions, depth, step="mid", color="#26788a", alpha=0.7)
for s in sites:
    p = (int(s["sample_reference_position"]) - 1) * 3 + 1
    ax[1].axvline(p, color="#343434", lw=0.6, alpha=0.4)
ax[1].set_xlim(1, 2832)
ax[1].set_ylim(bottom=0)
ax[1].set_xlabel("BwBSH2 reference coding nucleotide position")
ax[1].set_ylabel("BQ20 fragment depth")
ax[1].set_title(
    "Reference coverage: DNA support does not establish activity",
    loc="left",
    fontsize=11,
)
fig.savefig(OUT / "figures/BwBSH2_catalytic_coverage.png")
fig.savefig(OUT / "figures/BwBSH2_catalytic_coverage.pdf")
plt.close(fig)

tpa = [r for r in base if r["reference_id"] == "WP_005028753_1"]
context = list(
    csv.DictReader((OUT / "tpa_genome_mapping_per_base.tsv").open(), delimiter="\t")
)
intervals = [
    r
    for r in csv.DictReader(
        (WORK / "recovered/accepted_alignment_intervals.tsv").open(), delimiter="\t"
    )
    if r["reference_id"] == "WP_005028753_1"
]
ids = sorted(
    {r["fragment_local_id"] for r in intervals},
    key=lambda fid: min(
        int(r["start"]) for r in intervals if r["fragment_local_id"] == fid
    ),
)
fig, ax = plt.subplots(2, 1, figsize=(10.5, 6.5), sharex=True, layout="constrained")
ax[0].fill_between(
    [int(r["position_1based"]) for r in tpa],
    [int(r["read_depth"]) for r in tpa],
    step="mid",
    alpha=0.65,
    color="#26788a",
    label="Strict competitive panel",
)
ax[0].plot(
    [int(r["reference_position_1based"]) for r in context],
    [int(r["accepted_context_read_depth"]) for r in context],
    color="#bd6e2a",
    lw=0.8,
    label="Paired genomic-context mapping",
)
ax[0].set_ylabel("Read depth")
ax[0].legend(frameon=False)
ax[0].set_title(
    "tpa: competitive panel and genomic-context coverage", loc="left", fontsize=12
)
for i, fid in enumerate(ids):
    for r in intervals:
        if r["fragment_local_id"] == fid:
            offset = -0.11 if r["mate"] == "1" else 0.11
            ax[1].plot(
                [int(r["start"]), int(r["end"])],
                [i + offset] * 2,
                lw=5,
                color="#26788a" if r["mate"] == "1" else "#bd6e2a",
                solid_capstyle="butt",
            )
ax[1].set_yticks(range(len(ids)), [f"Fragment {i+1}" for i in range(len(ids))])
ax[1].set_ylim(-0.6, len(ids) - 0.4)
ax[1].set_xlim(1, 1371)
ax[1].set_xlabel("tpa reference coding nucleotide position")
ax[1].set_title(
    "Paired overlaps are not independent observations", loc="left", fontsize=11
)
fig.savefig(OUT / "figures/tpa_coverage.png")
fig.savefig(OUT / "figures/tpa_coverage.pdf")
plt.close(fig)

if (OUT / "control_gene_abundances.tsv").exists():
    data = list(
        csv.DictReader((OUT / "control_gene_abundances.tsv").open(), delimiter="\t")
    )
    meta = {
        r["run_accession"]: r
        for r in csv.DictReader((OUT / "control_manifest.tsv").open(), delimiter="\t")
    }
    targets = [
        "WP_016360761_1",
        "WP_005028753_1",
        "WP_005028754_1",
        "WP_005024906_1",
        "WP_005024905_1",
        "AAK31309_2",
        "AAK31310_1",
        "WP_008761025_1",
        "AAO76743_1",
        "AAO76729_1",
        "AAO78163_1",
        "AAO78901_1",
        "AAO77025_1",
        "EDN75850_1",
        "EDN78794_1",
    ]
    targets = [ref for ref in targets if any(r["reference_id"] == ref for r in data)]
    fig, axes = plt.subplots(4, 4, figsize=(13, 10), layout="constrained")
    for ax, ref in zip(axes.flat, targets):
        rows = [r for r in data if r["reference_id"] == ref]
        pat = next(r for r in rows if r["sample"] == "sample_local")
        controls = [r for r in rows if r["sample"] != "sample_local"]
        values = [float(r["FPKM"]) for r in controls]
        jitter = np.linspace(-0.15, 0.15, len(controls))
        for j, r in zip(jitter, controls):
            ax.scatter(
                j,
                float(r["FPKM"]),
                c="#26788a"
                if "subset" in meta[r["sample"]]["cohorts"].split(";")
                else "#aab4b8",
                s=28,
                alpha=0.85,
                zorder=2,
                clip_on=False,
            )
        ax.scatter(0.65, float(pat["FPKM"]), marker="D", c="#c45e38", s=44, zorder=3)
        ax.set_xticks([0, 0.65], ["Controls", "Sample"])
        ax.set_xlim(-0.3, 0.95)
        ax.set_title(pat["gene"].replace("_", " "), fontsize=10)
        ax.set_ylabel("Fragments / kb / million")
        ax.set_ylim(bottom=0)
    for ax in list(axes.flat)[len(targets) :]:
        ax.set_axis_off()
    fig.suptitle(
        "Exact reference-compatible DNA abundance: optional subset in blue, other controls in gray\nSmall, incompletely matched cohort; these are not clinical healthy ranges",
        fontsize=11,
    )
    fig.savefig(OUT / "figures/control_gene_comparison.png")
    fig.savefig(OUT / "figures/control_gene_comparison.pdf")
    plt.close(fig)
    profiles = list(
        csv.DictReader((OUT / "control_coverage_profiles.tsv").open(), delimiter="\t")
    )
    names = ["sample_local"] + list(meta)
    target = "WP_005028753_1"
    bins = sorted(
        {int(r["start_1based"]) for r in profiles if r["reference_id"] == target}
    )
    values = {
        (r["sample"], int(r["start_1based"])): float(r["breadth_pct"])
        for r in profiles
        if r["reference_id"] == target
    }
    counts = {
        r["sample"]: int(r["unique_fragments"])
        for r in data
        if r["reference_id"] == target
    }
    matrix = np.array([[values[(name, b)] for b in bins] for name in names])
    labels = ["Sample — " + str(counts["sample_local"]) + " pairs"] + [
        f"Donor {meta[n]['donor']} — {counts[n]} pairs" for n in names[1:]
    ]
    fig, ax = plt.subplots(figsize=(10.5, 6), layout="constrained")
    im = ax.imshow(
        matrix, aspect="auto", interpolation="nearest", vmin=0, vmax=100, cmap="Blues"
    )
    ax.set_yticks(range(len(names)), labels)
    ticks = [0, 7, 14, 21, len(bins) - 1]
    ax.set_xticks(ticks, [str(bins[i]) for i in ticks])
    ax.set_xlabel("tpa reference nucleotide position (50-nt bins; last bin shorter)")
    ax.set_title(
        "tpa spatial coverage across the sample and all preselected controls\nZero means no qualifying match, not confirmed absence",
        loc="left",
        fontsize=11,
    )
    ax.axhline(0.5, color="#c45e38", lw=1.5)
    fig.colorbar(
        im, ax=ax, label="Bases in bin covered by ≥1 accepted read (%)", shrink=0.8
    )
    fig.savefig(OUT / "figures/tpa_control_coverage.png")
    fig.savefig(OUT / "figures/tpa_control_coverage.pdf")
    plt.close(fig)
print("Saved figures")
