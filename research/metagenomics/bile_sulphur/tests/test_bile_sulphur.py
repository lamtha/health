"""Synthetic algorithm and publication-boundary checks; no biological inputs."""
import contextlib
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import numpy  # import before temporary sys.modules patches; C extensions cannot reload
import pysam

BASE = Path(__file__).resolve().parents[1]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def config(root):
    module = types.ModuleType("bile_sulphur_config")
    module.ROOT = root
    module.CONFIG = dict(
        max_read_length=146, common_depth=4, seed=42, resamples=20, interval_seed=7
    )
    return module


with patch.dict(
    sys.modules, {"bile_sulphur_config": config(Path("/synthetic-not-used"))}
):
    quant = load(BASE / "template/scripts/quantify_carriers.py", "synthetic_quant")
init = load(BASE / "init_bile_sulphur.py", "synthetic_init")
HEADER = pysam.AlignmentHeader.from_references(["a", "b", "c"], [1000] * 3)
REFS = {"a": {"group": "locus1"}, "b": {"group": "locus1"}, "c": {"group": "locus2"}}


def hit(
    rid=0, score=200, nm=0, start=200, cigar="100M", header=HEADER, name="synthetic/1"
):
    a = pysam.AlignedSegment(header)
    a.query_name = name
    a.query_sequence = "A" * 100
    a.flag = 0
    a.reference_id = rid
    a.reference_start = start
    a.mapping_quality = 0
    a.cigarstring = cigar
    a.set_tag("AS", score)
    a.set_tag("NM", nm)
    return a


def tsv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        writer = csv.DictWriter(f, rows[0], delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


class AssignmentTests(unittest.TestCase):
    def test_same_group_allele_ties(self):
        self.assertEqual(quant.classify([hit(), hit(1)], REFS)[1], "accepted")

    def test_different_group_ties(self):
        self.assertEqual(
            quant.classify([hit(), hit(2)], REFS)[1], "cross_group_ambiguity"
        )

    def test_gap_boundary(self):
        self.assertEqual(
            quant.classify([hit(), hit(2, score=191)], REFS)[1], "cross_group_ambiguity"
        )
        self.assertEqual(
            quant.classify([hit(), hit(2, score=190)], REFS)[1], "accepted"
        )

    def test_reporting_cap(self):
        self.assertEqual(quant.classify([hit() for _ in range(50)], REFS)[1], "hit_cap")

    def test_identity_sensitivity(self):
        self.assertEqual(
            quant.classify([hit(nm=8)], REFS)[1], "identity_length_coverage"
        )
        self.assertEqual(quant.classify([hit(nm=8)], REFS, 0.90)[1], "accepted")

    def test_query_coverage(self):
        self.assertEqual(
            quant.classify([hit(cigar="80M20S")], REFS)[1], "identity_length_coverage"
        )

    def test_reference_end_effect(self):
        self.assertEqual(quant.contribution(hit(start=0), 1000)[1], 0)
        self.assertAlmostEqual(quant.contribution(hit(start=100), 1000)[1], 54 / 708)
        self.assertAlmostEqual(quant.contribution(hit(), 1000)[1], 100 / 708)

    def test_own_annotation_fragment_does_not_compete(self):
        refs = {
            "a": {"group": "locus1", "kind": "target"},
            "b": {
                "group": "fragment",
                "classification_group": "locus1",
                "kind": "decoy",
            },
        }
        alignment, decision = quant.classify([hit(), hit(1)], refs)
        self.assertEqual(decision, "accepted")
        self.assertEqual(alignment.reference_name, "a")
        self.assertEqual(quant.classify([hit(1)], refs)[1], "partial_reference_only")

    def test_fragment_cannot_rescue_weak_full_alignment(self):
        refs = {
            "a": {"group": "locus1", "kind": "target"},
            "b": {
                "group": "fragment",
                "classification_group": "locus1",
                "kind": "decoy",
            },
        }
        self.assertEqual(
            quant.classify([hit(score=190, nm=8), hit(1)], refs)[1],
            "identity_length_coverage",
        )

    def test_shallow_library_cannot_be_labelled_common_depth(self):
        with self.assertRaisesRegex(ValueError, "below declared common depth"):
            quant.require_common_depth(3, 4)
        self.assertEqual(quant.require_common_depth(4, 4), 4)

    def test_mates_share_fragment(self):
        self.assertEqual(quant.fragment("synthetic/1"), quant.fragment("synthetic/2"))


class IntegrationTests(unittest.TestCase):
    def test_pair_counting_allele_ties_and_duplicate_denominators(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(sys.modules, {"bile_sulphur_config": config(root)}):
                q = load(
                    BASE / "template/scripts/quantify_carriers.py", "fixture_quant"
                )
            refs = [
                dict(
                    reference_id="a",
                    group="geneX",
                    kind="target",
                    species="bilophila",
                    length=1000,
                ),
                dict(
                    reference_id="b",
                    group="geneX",
                    kind="target",
                    species="bilophila",
                    length=1000,
                ),
                dict(
                    reference_id="c",
                    group="markerX",
                    kind="marker",
                    species="bilophila",
                    length=1000,
                ),
            ]
            refs.append(
                dict(
                    reference_id="d",
                    group="new_accessory",
                    kind="target",
                    species="bilophila",
                    length=318,
                )
            )
            tsv(q.R / "mapping_panel_manifest.tsv", refs)
            d = q.W / "sample_local"
            d.mkdir(parents=True)
            old = q.OLD / "sample_local"
            old.mkdir(parents=True)
            with pysam.AlignmentFile(str(d / "panel.bam"), "wb", header=HEADER) as f:
                for mate in [1, 2]:
                    for name in ["pairA", "pairB", "pairC", "pairD"]:
                        ids = [0, 1] if name in ["pairA", "pairB"] else [2]
                        for rid in ids:
                            f.write(hit(rid, name=f"{name}/{mate}"))
            original = pysam.AlignmentHeader.from_references(["geneX"], [1000])
            for mate in [1, 2]:
                with pysam.AlignmentFile(
                    str(old / f"panel_mate{mate}.bam"), "wb", header=original
                ) as f:
                    for name in ["pairA", "pairB"]:
                        f.write(hit(header=original, name=f"{name}/{mate}"))
                with pysam.BGZFile(str(old / f"nonhost_{mate}.fastq.gz"), "wb") as f:
                    for name in ["pairA", "pairB", "pairC", "pairD"]:
                        sequence = ("A" if name in ["pairA", "pairB"] else "C") * 100
                        f.write(
                            f'@{name}/{mate}\n{sequence}\n+\n{"I" * 100}\n'.encode()
                        )
            tsv(
                root / "results/followup/references/reference_manifest_v2.tsv",
                [dict(mapping_reference_id="geneX", reference_nt_length=1000)],
            )
            tsv(old / "nonhost_stats.tsv", [dict(num_seqs=4), dict(num_seqs=4)])
            tsv(
                old / "gene_quantification.tsv",
                [
                    dict(
                        reference_id="geneX",
                        exact_unique_nonhost_sequence_pairs=2,
                        breadth_pct=10,
                    )
                ],
            )
            common = types.ModuleType("common")

            def original_groups(path):
                with pysam.AlignmentFile(str(path), "rb") as f:
                    for a in f.fetch(until_eof=True):
                        yield a, "accepted", {}

            common.groups = original_groups
            with patch.dict(
                sys.modules, {"common": common}
            ), contextlib.redirect_stdout(io.StringIO()):
                q.main("sample_local")
            rows = q.read_tsv(d / "group_quantification.tsv")
            self.assertFalse(
                any(
                    r["group"] == "new_accessory" and r["mode"] == "exact" for r in rows
                )
            )
            self.assertTrue(
                any(
                    r["group"] == "new_accessory" and r["mode"] == "strict"
                    for r in rows
                )
            )
            selected = {
                (r["sensitivity"], r["group"]): r for r in rows if r["mode"] == "strict"
            }
            full = selected["full", "geneX"]
            collapsed = selected["exact_pair_collapsed", "geneX"]
            self.assertEqual(
                int(full["fragments"]), 2
            )  # not four mates or eight tied alignments
            self.assertEqual(int(full["accepted_reads"]), 4)
            self.assertAlmostEqual(float(full["interior_read_depth"]), 400 / 708)
            self.assertEqual(int(collapsed["fragments"]), 1)
            self.assertEqual(int(collapsed["nonhost_fragments"]), 2)
            self.assertEqual(float(full["FPKM"]), float(collapsed["FPKM"]))
            self.assertAlmostEqual(
                float(full["interior_read_depth"]),
                float(selected["full", "markerX"]["interior_read_depth"]),
            )


class InitializerTests(unittest.TestCase):
    def make_parent(self, root):
        manifest = root / "results/followup/control_manifest.tsv"
        tsv(
            manifest,
            [dict(run_accession="SRR1", donor="synthetic", cohorts="", read_count=4)],
        )
        parent = dict(
            common_depth=4,
            max_read_length=146,
            seed=42,
            resamples=20,
            controls_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
        )
        path = root / "followup.json"
        path.write_text(json.dumps(parent))
        versions = root / "results/followup/versions"
        versions.mkdir()
        (versions / "followup_config.sha256").write_text(
            hashlib.sha256(path.read_bytes()).hexdigest()
        )

    def test_private_install_and_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_parent(root)
            output = init.initialize(root)
            self.assertTrue((output / "scripts/quantify_carriers.py").is_file())
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(FileExistsError):
                init.initialize(root)

    def test_git_ancestor_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".git").mkdir()
            child = root / "nested"
            child.mkdir()
            with self.assertRaises(ValueError):
                init.initialize(child)

    def test_changed_cohort_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_parent(root)
            with (root / "results/followup/control_manifest.tsv").open("a") as f:
                f.write("SRR2\tsecond\t\t4\n")
            with self.assertRaisesRegex(ValueError, "manifest changed"):
                init.initialize(root)


class ReferenceRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.module = load(
            BASE / "template/scripts/reference_validation.py",
            "reference_validation_test",
        )
        self.dna = "ATG" + "GCT" * 400 + "TAA"
        self.protein = "M" + "A" * 400

    def test_complete_fusion_and_alternative_initiator(self):
        self.assertEqual(
            self.module.validate_full_orf(self.dna, self.protein), (self.protein, 1.0)
        )
        self.assertEqual(
            self.module.validate_full_orf("GTG" + self.dna[3:], self.protein),
            (self.protein, 1.0),
        )

    def test_internal_stop_rejected_despite_high_identity(self):
        broken = self.dna[:600] + "TGA" + self.dna[603:]
        self.assertIsNone(self.module.validate_full_orf(broken, self.protein))

    def test_incomplete_or_ambiguous_sequence_rejected(self):
        for dna in [
            self.dna[:-3],
            self.dna + "A",
            "NNN" + self.dna[3:],
            "GCT" + self.dna[3:],
        ]:
            self.assertIsNone(self.module.validate_full_orf(dna, self.protein))

    def test_distant_protein_rejected(self):
        self.assertIsNone(
            self.module.validate_full_orf(self.dna, "M" + "G" * 20 + "A" * 380)
        )


class FamilyUncertaintyTests(unittest.TestCase):
    def test_shared_fragment_covariance_is_retained(self):
        with patch.dict(
            sys.modules,
            {
                "quantify_carriers": quant,
                "bile_sulphur_config": config(Path("/synthetic-not-used")),
            },
        ):
            module = load(
                BASE / "template/scripts/summarize_metalloBSH_family.py", "family_test"
            )
        total, variance, count = module.combine_fragment_weights(
            {"geneA": {"pair1": 0.1, "pair2": 0.2}, "geneB": {"pair1": 0.3}}
        )
        self.assertAlmostEqual(total, 0.6)
        self.assertAlmostEqual(variance, 0.2)
        self.assertEqual(count, 2)


if __name__ == "__main__":
    unittest.main()
