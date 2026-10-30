"""Local scientific figures; plot files contain private aggregate results."""
from bile_sulphur_config import ROOT, CONFIG
import csv, os
from pathlib import Path
import numpy as np

os.environ.setdefault(
    "MPLCONFIGDIR", str(Path("analysis/bile_sulphur/work/matplotlib").resolve())
)
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

O = Path("results/bile_sulphur")
F = O / "figures"
F.mkdir(exist_ok=True)


def read(name):
    return list(csv.DictReader(open(O / name), delimiter="\t"))


car = [r for r in read("carrier_abundance.tsv") if r["sensitivity"] == "full"]
rr = [
    r
    for r in read("gene_to_marker_ratios.tsv")
    if r["sensitivity"] == "full" and r["mode"] == "strict"
]
fig, axes = plt.subplots(1, 2, figsize=(9, 4), layout="constrained")
for ax, sp, label in zip(
    axes, ["bilophila", "bt"], ["Bilophila wadsworthia complex", "B. thetaiotaomicron"]
):
    rows = [r for r in car if r["species"] == sp]
    controls = [r for r in rows if r["sample"] != "sample_local"]
    sample = next(r for r in rows if r["sample"] == "sample_local")
    values = np.array(
        [float(r["carrier_depth_per_million_fragments"]) for r in controls]
    )
    ax.scatter(
        np.linspace(-0.15, 0.15, len(values)),
        values,
        color="#687b8c",
        label="Public controls",
        alpha=0.8,
        s=40,
    )
    ax.scatter(
        [0.7],
        [float(sample["carrier_depth_per_million_fragments"])],
        marker="D",
        color="#af4a2e",
        s=65,
        label="Sample",
    )
    ax.set_xticks([0, 0.7], ["Controls", "Sample"])
    ax.set_title(label, fontsize=11)
    ax.set_ylabel("Median marker depth / million nonhost pairs")
    ax.set_ylim(
        bottom=-max(values.max(), float(sample["carrier_depth_per_million_fragments"]))
        * 0.04
    )
    ax.spines[["top", "right"]].set_visible(False)
fig.suptitle("Community carrier abundance — DNA coverage index", fontsize=14)
fig.savefig(F / "carrier_abundance.png", dpi=180)
fig.savefig(F / "carrier_abundance.pdf")
plt.close(fig)
for sp in ["bilophila", "bt"]:
    sample = [r for r in rr if r["sample"] == "sample_local" and r["species"] == sp]
    labels = [
        r["gene"]
        .replace("_BSHb", "")
        .replace("_BSHa_candidate", " (uncertain)")
        .replace("_3S_Gal_sulfatase", "")
        .replace("_sulfatase", "")
        .replace("BT_", "BT")
        for r in sample
    ]
    fig, ax = plt.subplots(
        figsize=(10, max(4, len(sample) * 0.36)), layout="constrained"
    )
    for i, r in enumerate(sample):
        controls = [
            c
            for c in rr
            if c["sample"] != "sample_local"
            and c["reference_id"] == r["reference_id"]
            and c["eligible_primary_ratio_comparison"] == "True"
            and c["gene_to_marker_ratio"] != "NA"
        ]
        values = [float(c["gene_to_marker_ratio"]) for c in controls]
        ax.scatter(
            values,
            [i] * len(values),
            s=26,
            color="#687b8c",
            alpha=0.8,
            zorder=2,
            label="Eligible controls" if i == 0 else None,
        )
        if r["gene_to_marker_ratio"] == "NA":
            ax.text(
                0.03,
                i - 0.12,
                "insufficient carrier coverage",
                fontsize=7,
                color="#687b8c",
            )
            continue
        v = float(r["gene_to_marker_ratio"])
        if r["technical_interval_low"] != "NA" and r["technical_interval_high"] != "NA":
            lo = float(r["technical_interval_low"])
            hi = float(r["technical_interval_high"])
            ax.plot([lo, hi], [i - 0.12, i - 0.12], color="#af4a2e", linewidth=1.6)
        ax.scatter(
            [v],
            [i - 0.12],
            color="#af4a2e",
            marker="D",
            s=32,
            zorder=3,
            label="Sample + technical interval" if i == 0 else None,
        )
    ax.axvline(1, color="#aab2ba", lw=0.8, ls="--")
    ax.set_yticks(range(len(sample)), labels)
    ax.invert_yaxis()
    ax.set_xlim(left=0)
    ax.set_xlabel("Gene / carrier-marker DNA coverage ratio")
    ax.set_title(
        ("Bilophila complex" if sp == "bilophila" else "B. thetaiotaomicron")
        + " — within-carrier evidence",
        fontsize=13,
    )
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(loc="best", fontsize=8)
    fig.text(
        0.01,
        0.003,
        "Intervals omit biological/batch/reference uncertainty. Short genes use full depths; no expression or integer copy-number claim.",
        fontsize=8,
    )
    fig.savefig(F / f"{sp}_gene_ratios.png", dpi=180, bbox_inches="tight")
    fig.savefig(F / f"{sp}_gene_ratios.pdf", bbox_inches="tight")
    plt.close(fig)
print("Scientific figures exported", flush=True)
