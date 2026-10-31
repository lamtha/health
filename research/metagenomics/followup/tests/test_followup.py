"""Synthetic reads only; no network calls, patient fixtures or expected case findings."""
import csv
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

import pysam
from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord

SOURCE = Path(__file__).resolve().parents[1]
PARENT = SOURCE.parent


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


parent_init = module(PARENT / "init_workspace.py", "parent_initializer")
followup_init = module(SOURCE / "init_followup.py", "followup_initializer")


def table(path):
    with path.open() as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def sequences(path):
    with path.open() as stream:
        return {r.id: str(r.seq) for r in SeqIO.parse(stream, "fasta")}


def write_table(path, rows, fields=None):
    with path.open("w") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=fields or list(rows[0]),
            delimiter="\t",
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


class FollowupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-followup-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        reads = []
        for mate in (1, 2):
            path = self.base / f"synthetic_{mate}.fastq.gz"
            with gzip.open(path, "wt") as stream:
                stream.write(
                    f"@synthetic/{mate}\n" + "ACGT" * 25 + "\n+\n" + "I" * 100 + "\n"
                )
            reads.append(path)
        self.root = parent_init.initialize(self.base / "workspace", "synthetic", *reads)

    def initialize(self, controls=None):
        self.out = followup_init.initialize(
            self.root, controls, common_depth=2, resamples=25
        )
        self.ref = self.root / "analysis/followup/references"
        self.work = self.root / "analysis/followup/work"
        # Public reference-only fixture; no source sample sequence is used.
        for ext in ("fna", "faa"):
            (self.ref / f"panel_v2.{ext}").write_text(
                (PARENT / f"template/references/target_panel.{ext}").read_text()
                + (SOURCE / f"template/references/bt_bsh_additions.{ext}").read_text()
            )
        self.manifest = table(
            PARENT / "template/references/reference_manifest.tsv"
        ) + table(SOURCE / "template/references/bt_bsh_manifest.tsv")
        write_table(self.ref / "reference_manifest_v2.tsv", self.manifest)
        for name in ("panel_v2.fna", "panel_v2.faa", "reference_manifest_v2.tsv"):
            shutil.copyfile(self.ref / name, self.out / "references" / name)

    def run_script(self, name, *args, ok=True):
        result = subprocess.run(
            [sys.executable, str(self.out / "scripts" / name), *map(str, args)],
            cwd=self.root,
            text=True,
            capture_output=True,
        )
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def synthetic_alignment(self, directory, n=3, matching=2):
        directory.mkdir(parents=True, exist_ok=True)
        ref = self.manifest[0]["mapping_reference_id"]
        length = int(self.manifest[0]["reference_nt_length"])
        header = pysam.AlignmentHeader.from_references([ref], [length])
        for mate in (1, 2):
            with gzip.open(directory / f"nonhost_{mate}.fastq.gz", "wt") as stream:
                for fid in range(n):
                    sequence = (
                        ("A" if mate == 1 else "C") * 100
                        if fid < 2
                        else ("G" if mate == 1 else "T") * 100
                    )
                    stream.write(
                        f"@synthetic{fid}/{mate}\n{sequence}\n+\n" + "I" * 100 + "\n"
                    )
            with pysam.AlignmentFile(
                directory / f"panel_mate{mate}.bam", "wb", header=header
            ) as bam:
                for fid in range(matching):
                    a = pysam.AlignedSegment(header)
                    a.query_name = f"synthetic{fid}/{mate}"
                    a.query_sequence = ("A" if mate == 1 else "C") * 100
                    a.reference_id = 0
                    a.reference_start = 100 * (mate - 1)
                    a.cigarstring = "100M"
                    a.mapping_quality = 40
                    a.set_tag("AS", 200)
                    a.set_tag("NM", 0)
                    bam.write(a)
        (directory / "nonhost_stats.tsv").write_text(
            f"file\tnum_seqs\nmate1\t{n}\nmate2\t{n}\n"
        )
        return ref, length

    def test_private_initialization_and_frozen_settings(self):
        self.initialize()
        self.assertEqual(self.out.stat().st_mode & 0o777, 0o700)
        self.assertFalse(list(self.out.rglob("*.pyc")))
        self.run_script("followup_config.py")
        settings = json.loads((self.root / "followup.json").read_text())
        settings["common_depth"] = 1
        (self.root / "followup.json").write_text(json.dumps(settings))
        self.assertIn(
            "settings changed", self.run_script("followup_config.py", ok=False).stderr
        )
        with self.assertRaises(FileExistsError):
            followup_init.initialize(self.root)

    def test_git_move_and_runtime_shell_guard(self):
        self.initialize()
        (self.root / ".git").write_text("gitdir: elsewhere\n")
        self.assertIn(
            "outside Git", self.run_script("followup_config.py", ok=False).stderr
        )
        result = subprocess.run(
            ["bash", str(self.out / "scripts/run_assembly.sh")],
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("outside Git", result.stderr)
        with self.assertRaisesRegex(ValueError, "outside every Git"):
            followup_init.initialize(self.root)

    def test_control_manifest_rejects_repeats_and_paths(self):
        controls = self.base / "controls.tsv"
        fields = ["run_accession", "donor", "cohorts", "read_count"]
        for rows in [
            [["SRR1", "donor_a", "", ""], ["SRR2", "donor_a", "", ""]],
            [["../unsafe", "donor_a", "", ""]],
            [["SRR1", "donor_a", "all_controls", ""]],
        ]:
            write_table(controls, [dict(zip(fields, row)) for row in rows])
            with self.assertRaises(ValueError):
                followup_init.read_controls(controls)

    def test_changed_manifest_and_unselected_run_refused(self):
        self.initialize()
        self.assertIn(
            "not preselected",
            self.run_script("followup_config.py", "--run", "SRR1", ok=False).stderr,
        )
        with (self.out / "control_manifest.tsv").open("a") as stream:
            stream.write("SRR1\tdonor_a\t\t\n")
        self.assertIn(
            "manifest changed", self.run_script("followup_config.py", ok=False).stderr
        )

    def test_paired_count_and_duplicate_denominators(self):
        self.initialize()
        d = self.work / "synthetic"
        ref, length = self.synthetic_alignment(d)
        self.run_script("quantify_panel.py", d, "synthetic")
        rows = table(d / "gene_quantification.tsv")
        hit = next(r for r in rows if r["reference_id"] == ref)
        self.assertEqual(len(rows), 124)
        self.assertEqual(int(hit["unique_fragments"]), 2)
        self.assertEqual(int(hit["accepted_reads"]), 4)
        self.assertEqual(int(hit["exact_unique_nonhost_sequence_pairs"]), 2)
        self.assertEqual(int(hit["exact_unique_target_sequence_pairs"]), 1)
        self.assertAlmostEqual(float(hit["FPKM"]), 2e9 / length / 3)
        self.assertAlmostEqual(float(hit["deduplicated_FPKM"]), 1e9 / length / 2)
        self.assertEqual(int(hit["rarefied_total_fragments"]), 2)

    def test_common_depth_failure_and_no_hit_export(self):
        self.initialize()
        d = self.work / "synthetic"
        self.synthetic_alignment(d, n=1, matching=0)
        self.assertIn(
            "below the predeclared",
            self.run_script(
                "quantify_panel.py", d, "synthetic", "--require-common-depth", ok=False
            ).stderr,
        )
        self.run_script("quantify_panel.py", d, "synthetic")
        self.assertTrue(
            all(
                r["detection_call"] == "no_qualifying_reference_match"
                for r in table(d / "gene_quantification.tsv")
            )
        )

    def test_mate_mismatch_is_rejected(self):
        self.initialize()
        d = self.work / "synthetic"
        self.synthetic_alignment(d)
        with gzip.open(d / "nonhost_2.fastq.gz", "wt") as stream:
            stream.write(
                "@not_a_matching_mate\n" + "A" * 100 + "\n+\n" + "I" * 100 + "\n"
            )
        result = self.run_script("quantify_panel.py", d, "synthetic", ok=False)
        self.assertIn("mate order mismatch", result.stderr)
        self.assertNotIn("not_a_matching_mate", result.stderr)

    def test_acceptance_boundaries_and_competitor_margin(self):
        self.initialize()
        code = """
import sys
sys.path.insert(0,sys.argv[1])
import pysam
from common import classify
def hit(n=100,cigar='100M',nm=0,score=200,mapq=30,xs=None):
    h=pysam.AlignmentHeader.from_references(['synthetic'],[1000])
    a=pysam.AlignedSegment(h);a.query_name='synthetic';a.query_sequence='A'*n
    a.reference_id=0;a.reference_start=100;a.cigarstring=cigar;a.mapping_quality=mapq
    a.set_tag('AS',score);a.set_tag('NM',nm)
    if xs is not None:a.set_tag('XS',xs)
    return a
assert classify([hit(nm=5)])[1]=='accepted'
for a in [hit(nm=6),hit(cigar='11S89M'),hit(n=70,cigar='70M')]:
    assert classify([a])[1]=='identity_length_coverage'
for a in [hit(xs=195),hit(mapq=19)]:
    assert classify([a])[1]=='ambiguous_mapq'
assert classify([hit(),hit(nm=40,score=195)])[1]=='ambiguous_mapq'
assert classify([hit(mapq=255)])[1]=='accepted'
"""
        result = subprocess.run(
            [sys.executable, "-c", code, str(self.out / "scripts")],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_reference_alignment_and_overlapping_codon_votes(self):
        self.initialize()
        context = self.root / "analysis/references"
        context.mkdir()
        for name in ("B_theta_VPI5482", "bilophila_complete_assembly"):
            rec = SeqRecord(
                Seq("ACGT" * 100),
                id="synthetic_context",
                annotations={"molecule_type": "DNA"},
            )
            SeqIO.write([rec], context / f"{name}.gb", "genbank")
        self.run_script("prepare_references.py")
        sites = table(self.out / "reference_catalytic_sites.tsv")
        positions = {
            int(r["BwBSH1_position"]): int(r["BwBSH2_position"]) for r in sites
        }
        self.assertEqual(positions[373], 398)
        self.assertEqual(positions[196], 195)
        ref = "WP_016360761_1"
        public_sequences = sequences(self.ref / "panel_v2.fna")
        header = pysam.AlignmentHeader.from_references(
            list(public_sequences), [len(s) for s in public_sequences.values()]
        )
        d = self.work / "panel_v2"
        d.mkdir()
        for mate in (1, 2):
            with pysam.AlignmentFile(d / f"mate{mate}.bam", "wb", header=header) as bam:
                for fid in (1, 2):
                    sequence = public_sequences[ref][300:400]
                    conflict = fid == 2 and mate == 2
                    if conflict:
                        offset = (110 - 1) * 3 - 300
                        sequence = (
                            sequence[:offset]
                            + ("A" if sequence[offset] != "A" else "C")
                            + sequence[offset + 1 :]
                        )
                    a = pysam.AlignedSegment(header)
                    a.query_name = f"synthetic{fid}/{mate}"
                    a.query_sequence = sequence
                    a.query_qualities = pysam.qualitystring_to_array("I" * 100)
                    a.reference_id = list(public_sequences).index(ref)
                    a.reference_start = 300
                    a.cigarstring = "100M"
                    a.mapping_quality = 40
                    a.set_tag("AS", 200)
                    a.set_tag("NM", int(conflict))
                    bam.write(a)
        self.run_script("recover_genes.py")
        measured = {
            int(r["sample_reference_position"]): r
            for r in table(self.out / "catalytic_site_evidence.tsv")
            if r["gene"] == "BwBSH2"
        }
        self.assertEqual(int(measured[110]["BQ20_complete_codon_fragments"]), 1)
        self.assertEqual(int(measured[112]["BQ20_complete_codon_fragments"]), 2)
        self.assertEqual(
            measured[110]["BQ20_call"], "reference_residue_single_fragment"
        )
        self.assertEqual(measured[398]["BQ20_call"], "not_covered")
        recovered = sequences(self.work / "recovered/masked_consensus.fna")
        self.assertEqual(recovered[ref][(110 - 1) * 3], "N")
        write_table(
            self.out / "tpa_genome_mapping_per_base.tsv",
            [
                dict(reference_position_1based=i + 1, accepted_context_read_depth=0)
                for i in range(len(public_sequences["WP_005028753_1"]))
            ],
        )
        self.run_script("plot_followup.py")
        self.assertTrue((self.out / "figures/BwBSH2_catalytic_coverage.png").is_file())

    def test_empty_assembly_exports_and_no_false_recovery(self):
        self.initialize()
        d = self.work / "megahit_native"
        d.mkdir()
        (d / "final.contigs.fa").write_text(">synthetic_contig\n" + "A" * 300 + "\n")
        for name in ("assembly_nucleotide_hits.tsv", "assembly_protein_hits.tsv"):
            (self.work / name).write_text("")
        self.run_script("summarize_assembly.py")
        self.assertEqual(table(self.out / "assembly_gene_hits.tsv"), [])
        self.assertEqual(table(self.out / "assembly_gene_linkage.tsv"), [])
        self.run_script("empty_readback.py")
        for name in (
            "assembly_target_taxonomy_conf0.1.reads.tsv",
            "assembly_target_taxonomy.reads.tsv",
            "target_contigs_context_exact.paf",
        ):
            (self.work / name).write_text("")
        write_table(
            self.out / "reference_catalytic_sites.tsv",
            [
                dict(
                    BwBSH2_position=110,
                    BwBSH2_residue="H",
                    evidence="metal_ligand_mutagenesis",
                )
            ],
        )
        self.run_script("finalize_assembly_evidence.py")
        self.assertEqual(table(self.out / "assembly_junction_validation.tsv"), [])
        self.assertEqual(
            json.loads((self.out / "assembly_summary.json").read_text())[
                "full_ORF_candidates"
            ],
            0,
        )

    def test_dynamic_cohorts_zero_median_and_all_preselected_runs(self):
        controls = self.base / "controls.tsv"
        write_table(
            controls,
            [
                dict(
                    run_accession="SRR1",
                    donor="donor_a",
                    cohorts="subset",
                    read_count=3,
                ),
                dict(run_accession="SRR2", donor="donor_b", cohorts="", read_count=3),
            ],
        )
        self.initialize(controls)
        base = self.root / "analysis/followup/controls"
        for name, k in [("sample_local", 2), ("SRR1", 0), ("SRR2", 1)]:
            d = base / name
            self.synthetic_alignment(d, matching=k)
            self.run_script("quantify_panel.py", d, name, "--require-common-depth")
            metrics = dict(
                total_reads=6,
                total_bases=600,
                q30_rate=1,
                read1_mean_length=100,
                read2_mean_length=100,
            )
            (d / "fastp.json").write_text(
                json.dumps(
                    {
                        "summary": {
                            "before_filtering": metrics,
                            "after_filtering": metrics,
                        }
                    }
                )
            )
        self.run_script("compare_controls.py", ok=False)
        (base / "COMPARISON_COMPLETE").touch()
        self.run_script("compare_controls.py")
        rows = table(self.out / "control_gene_comparison.tsv")
        self.assertEqual(len(rows), 124 * 2 * 3)
        for row in rows:
            n = 1 if row["cohort"] == "subset" else 2
            self.assertEqual(int(row["n_independent_controls"]), n)
            self.assertEqual(
                sum(
                    int(row[k])
                    for k in ("controls_lower", "controls_equal", "controls_higher")
                ),
                n,
            )
        subset = next(
            r for r in rows if r["cohort"] == "subset" and r["measure"] == "FPKM"
        )
        self.assertEqual(subset["fold_over_control_median"], "undefined_zero_median")
        self.assertEqual(subset["range_position"], "above_observed_range")
        original = table(base / "sample_local/gene_quantification.tsv")
        for row in original:
            row["sample"] = "sample_original"
        write_table(self.out / "gene_hits.tsv", original)
        self.run_script("validate_outputs.py")
        original[0]["FPKM"] = "0"
        write_table(self.out / "gene_hits.tsv", original)
        self.assertIn(
            "denominator mismatch",
            self.run_script("validate_outputs.py", ok=False).stderr,
        )

    def test_private_packaging_review_and_exclusions(self):
        self.initialize()
        self.assertIn(
            "review still pending",
            self.run_script("package_results.py", ok=False).stderr,
        )
        (self.out / "summary.md").write_text(
            "Synthetic review; no biological findings.\n"
        )
        (self.out / "methods.md").write_text("Synthetic packaging check.\n")
        (self.out / "versions/output_validation.json").write_text(
            '{"status":"passed"}\n'
        )
        for name in (
            "private.fastq.gz",
            "private.bam",
            "reconstructed.fna",
            "private.tsv",
            "tpa_genome_mapping_per_base.tsv",
        ):
            (self.out / name).write_text("SYNTHETIC_PRIVATE_CONTENT")
        self.run_script("package_results.py")
        with zipfile.ZipFile(
            self.out.parent / "metagenomics_followup_results.zip"
        ) as z:
            self.assertIsNone(z.testzip())
            self.assertFalse(
                any("private." in n or "reconstructed" in n for n in z.namelist())
            )
            self.assertIn("followup/summary.md", z.namelist())
            self.assertNotIn("followup/tpa_genome_mapping_per_base.tsv", z.namelist())


class SourceTests(unittest.TestCase):
    def test_public_addition_hashes_and_schema_only_metadata(self):
        refs = SOURCE / "template/references"
        seqs = sequences(refs / "bt_bsh_additions.fna")
        rows = table(refs / "bt_bsh_manifest.tsv")
        self.assertEqual(set(seqs), {"WP_008761025_1", "WP_008763035_1"})
        for row in rows:
            self.assertEqual(
                hashlib.sha256(seqs[row["mapping_reference_id"]].encode()).hexdigest(),
                row["reference_nt_sha256"],
            )
            self.assertTrue(row["primary_publication"].startswith("https://doi.org/"))
        schemas = json.loads(
            (SOURCE / "template/scripts/output_schemas.json").read_text()
        )
        for fields in schemas.values():
            for field in fields:
                self.assertRegex(field, r"^[A-Za-z][A-Za-z0-9_]*$")


if __name__ == "__main__":
    unittest.main()
