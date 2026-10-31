"""Synthetic regression cases for the scientific review; no patient inputs."""
import csv
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


coverage = load(ROOT / "template/scripts/coverage_evidence.py", "coverage_labels")
models = load(ROOT / "followup/template/scripts/coverage_models.py", "coverage_models")
context = load(
    ROOT / "followup/template/scripts/alignment_evidence.py", "alignment_evidence"
)
proteins = load(
    ROOT / "followup/template/scripts/translated_groups.py", "translated_groups"
)
pairing = load(ROOT / "followup/template/scripts/validate_fastq_pairs.py", "pairing")


def tsv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as stream:
        writer = csv.DictWriter(stream, rows[0], delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def read(path):
    with path.open() as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


class ReviewRegressions(unittest.TestCase):
    def test_shallow_complete_sampling_is_not_a_deletion_label(self):
        row = coverage.coverage_evidence(20, 10, 0.84, 1.9, 10, False)
        self.assertEqual(row["detection_call"], "depth_limited_reference_evidence")
        self.assertAlmostEqual(
            row["expected_breadth_uniform_poisson_pct"], 85.043138, places=5
        )
        self.assertNotIn("intact_gene_demonstrated", row)

    def test_incomplete_reference_does_not_override_trace(self):
        row = coverage.coverage_evidence(1, 1, 0.2, 0.2, 1, True)
        self.assertEqual(row["detection_call"], "trace_fragment_evidence")
        self.assertTrue(row["incomplete_reference"])

    def test_origin_spanning_gap_and_rotation_invariance(self):
        x = [False, False, True, True, False]
        self.assertEqual(models.longest_gap(x), 2)
        self.assertEqual(models.longest_gap(x, circular=True), 3)
        self.assertEqual(
            {models.longest_gap(np.roll(x, k), circular=True) for k in range(5)}, {3}
        )
        self.assertEqual(models.longest_gap([False] * 5, circular=True), 5)
        self.assertEqual(models.longest_gap([True] * 5, circular=True), 0)

    def test_duplicate_paired_placement_is_one_mate_locus(self):
        import pysam

        header = pysam.AlignmentHeader.from_references(["contig"], [1000])

        def alignment(start, score):
            a = pysam.AlignedSegment(header)
            a.query_name = "synthetic"
            a.query_sequence = "A" * 100
            a.reference_id = 0
            a.reference_start = start
            a.cigarstring = "100M"
            a.set_tag("AS", score)
            return a

        unique = context.unique_mate_loci(
            [alignment(10, 200), alignment(10, 200), alignment(20, 190)]
        )
        self.assertEqual(len(unique), 2)
        self.assertEqual([a.reference_start for a in unique], [10, 20])

    def test_null_is_seeded_and_models_are_explicit(self):
        first = models.coverage_null([{0, 1}, {3, 4}], 10, 17, 100)
        self.assertEqual(first, models.coverage_null([{0, 1}, {3, 4}], 10, 17, 100))
        self.assertEqual(set(first["models"]), {"circular", "linear_contained"})

    def test_primary_union_does_not_sum_overlap_or_mix_reference_genomes(self):
        def hit(start, end, ref="genomeA", kind="P"):
            return dict(
                query_start=start,
                query_end=end,
                reference=ref,
                alignment_type=kind,
                identity=99.0,
            )

        row = context.context_summary(
            [
                hit(0, 40),
                hit(30, 60),
                hit(70, 90),
                hit(0, 100, kind="S"),
                hit(0, 70, ref="genomeB"),
            ],
            100,
        )
        self.assertEqual(row["best_context_reference"], "genomeA")
        self.assertEqual(row["best_context_contig_breadth_pct"], 80)
        self.assertEqual(row["best_context_largest_block_pct"], 40)

    def test_identical_proteins_are_shared_but_distinct_competitor_still_rejects(self):
        groups = proteins.protein_groups({"a": "MKL", "b": "MKL", "c": "MKA"})

        def row(ref, score):
            return ["", ref] + [""] * 9 + [str(score)]

        self.assertEqual(
            proteins.competing_score_gap(
                [row("a", 100), row("b", 100), row("c", 80)], groups
            ),
            20,
        )
        self.assertEqual(
            proteins.competing_score_gap(
                [row("a", 100), row("b", 100), row("c", 99)], groups
            ),
            1,
        )
        self.assertEqual(groups["a"], ("a", "b"))

    def test_pair_mismatch_truncation_and_valid_mate_suffixes(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "one.fq", Path(directory) / "two.fq"

            def write(path, names):
                path.write_text("".join(f"@{name}\nACGT\n+\nIIII\n" for name in names))

            write(a, ["one/1", "two/1"])
            write(b, ["one/2", "two/2"])
            self.assertEqual(pairing.validate_pairs(a, b)["paired_records"], 2)
            for names in [["two/2", "one/2"], ["one/2"]]:
                write(b, names)
                with self.assertRaises(ValueError):
                    pairing.validate_pairs(a, b)

    def test_short_targets_and_sample_gate_in_both_result_builders(self):
        for component, config_name, species in [
            (
                "carrier_normalization",
                "carrier_config",
                ["gnavus", "torques", "gnavus_SGB4571"],
            ),
            ("bile_sulphur", "bile_sulphur_config", ["bilophila", "bt"]),
        ]:
            with self.subTest(
                component=component
            ), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                out = root / "results" / component
                work = root / "analysis" / component / "work"
                old = root / "analysis/followup/controls"
                tsv(
                    root / "results/followup/control_manifest.tsv",
                    [
                        dict(run_accession=n, cohorts="")
                        for n in ["SRR1", "SRR2", "SRR3"]
                    ],
                )
                manifest = []
                for g, length in [
                    ("short_zero", 240),
                    ("short_covered", 292),
                    ("long", 900),
                ]:
                    manifest.append(
                        dict(
                            mapping_reference_id=g,
                            gene=g,
                            protein_accession="SYNTHETIC",
                            reference_evidence="synthetic",
                            reference_role="target",
                        )
                    )
                manifest_path = (
                    out / "references/curated_reference_manifest.tsv"
                    if component == "bile_sulphur"
                    else root / "results/followup/references/reference_manifest_v2.tsv"
                )
                tsv(manifest_path, manifest)
                for name in ["sample_local", "SRR1", "SRR2", "SRR3"]:
                    tsv(
                        old / name / "nonhost_stats.tsv",
                        [dict(num_seqs=1000, sum_len=100000)] * 2,
                    )
                    rows = []
                    for sens in ["full", "common_depth", "exact_pair_collapsed"]:
                        for sp in species:
                            for i in range(3):
                                rows.append(
                                    dict(
                                        sample=name,
                                        mode="strict",
                                        sensitivity=sens,
                                        species=sp,
                                        kind="diagnostic_marker"
                                        if sp.endswith("4571")
                                        else "marker",
                                        group=f"m{sp}{i}",
                                        fragments=40,
                                        nonhost_fragments=1000,
                                        relative_position_breadth_pct=90,
                                        read_depth=2.0,
                                        interior_read_depth=0.2
                                        if name == "sample_local"
                                        else 2.0,
                                        FPKM=0,
                                        median_reference_length=900,
                                        core_weight_sum_squares=1,
                                        full_weight_sum_squares=1,
                                        exact_breadth_pct="NA",
                                    )
                                )
                        for g, length in [
                            ("short_zero", 240),
                            ("short_covered", 292),
                            ("long", 900),
                        ]:
                            value = (
                                0
                                if g == "short_zero" and name == "sample_local"
                                else 1.0
                            )
                            rows.append(
                                dict(
                                    sample=name,
                                    mode="strict",
                                    sensitivity=sens,
                                    species=species[0],
                                    kind="target",
                                    group=g,
                                    fragments=0 if value == 0 else 10,
                                    nonhost_fragments=1000,
                                    relative_position_breadth_pct=70,
                                    read_depth=value,
                                    interior_read_depth=0 if length < 600 else 5.0,
                                    FPKM=value,
                                    median_reference_length=length,
                                    core_weight_sum_squares=1,
                                    full_weight_sum_squares=0.1,
                                    exact_breadth_pct="NA",
                                )
                            )
                    tsv(work / name / "group_quantification.tsv", rows)
                    (work / name / "QUANTIFICATION_COMPLETE").touch()
                config = types.ModuleType(config_name)
                config.ROOT = root
                config.CONFIG = dict(
                    resamples=100, interval_seed=7, max_read_length=146
                )
                quant = types.ModuleType("quantify_carriers")
                quant.ROOT = root
                quant.R = out / "references"
                quant.W = work
                quant.OLD = old
                quant.write_tsv = tsv
                with patch.dict(
                    sys.modules, {config_name: config, "quantify_carriers": quant}
                ):
                    load(
                        ROOT / component / "template/scripts/build_results.py",
                        component + "_review_fixture",
                    )
                rows = {
                    r["reference_id"]: r
                    for r in read(out / "gene_to_marker_ratios.tsv")
                    if r["sample"] == "sample_local" and r["sensitivity"] == "full"
                }
                self.assertAlmostEqual(
                    float(rows["short_covered"]["gene_to_marker_ratio"]), 0.5
                )
                self.assertEqual(
                    rows["short_covered"]["eligible_primary_ratio_comparison"], "True"
                )
                self.assertEqual(
                    rows["short_covered"]["carrier_coverage_status"],
                    "limited_but_eligible",
                )
                self.assertEqual(
                    rows["long"]["eligible_primary_ratio_comparison"], "False"
                )
                self.assertGreater(
                    float(rows["short_zero"]["technical_interval_high"]), 0
                )
                comparisons = {
                    r["reference_id"]: r
                    for r in read(out / "sample_control_comparison.tsv")
                    if r["sensitivity"] == "full"
                }
                self.assertEqual(
                    comparisons["short_zero"]["community_position"],
                    "below_observed_range",
                )
                self.assertEqual(
                    comparisons["long"]["ratio_position"], "sample_carrier_low_coverage"
                )


if __name__ == "__main__":
    unittest.main()
