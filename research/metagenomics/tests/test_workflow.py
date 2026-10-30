"""Synthetic inputs only: no patient fixtures, downloaded reads or network calls."""
import csv
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('init_workspace', SOURCE / 'init_workspace.py')
initializer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(initializer)


def fastq(path, names, mate):
    with gzip.open(path, 'wt') as stream:
        for name in names:
            stream.write(f'@{name}/{mate}\nACGTACGT\n+\nIIIIIIII\n')


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.reads = [self.root / f'read{i}.fastq.gz' for i in (1, 2)]
        for mate, path in enumerate(self.reads, 1):
            fastq(path, ['synthetic_a', 'synthetic_b'], mate)

    def workspace(self):
        return initializer.initialize(self.root / 'private-run', 'synthetic_demo', *self.reads)

    def run_script(self, workspace, name):
        return subprocess.run([sys.executable, str(workspace / 'results/scripts' / name)],
                              cwd=workspace, text=True, capture_output=True)

    def test_initializer_links_inputs_and_keeps_outputs_outside_git(self):
        before = [p.read_bytes() for p in self.reads]
        workspace = self.workspace()
        for mate, original in enumerate(self.reads, 1):
            link = workspace / f'incoming/sample_{mate}.fastq.gz'
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.resolve(), original)
        self.assertEqual(before, [p.read_bytes() for p in self.reads])
        self.assertEqual(workspace.stat().st_mode & 0o777, 0o700)
        self.assertFalse(list(workspace.rglob('*.pyc')))
        self.assertEqual((workspace / '.gitignore').read_text(), '*\n')

    def test_rejects_git_directory_and_worktree_git_file(self):
        for name, directory in [('checkout', True), ('worktree', False)]:
            parent = self.root / name
            parent.mkdir()
            if directory:
                (parent / '.git').mkdir()
            else:
                (parent / '.git').write_text('gitdir: elsewhere\n')
            with self.assertRaisesRegex(ValueError, 'outside every Git'):
                initializer.initialize(parent / 'run', 'demo', *self.reads)

    def test_rejects_invalid_id_duplicate_mates_and_existing_workspace(self):
        with self.assertRaises(ValueError):
            initializer.initialize(self.root / 'invalid', '../unsafe', *self.reads)
        with self.assertRaises(ValueError):
            initializer.initialize(self.root / 'duplicate', 'demo', self.reads[0], self.reads[0])
        workspace = self.workspace()
        with self.assertRaises(FileExistsError):
            initializer.initialize(workspace, 'demo', *self.reads)

    def test_full_pair_validation_and_private_aggregate_export(self):
        workspace = self.workspace()
        result = self.run_script(workspace, '01_inventory_paircheck.py')
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((workspace / 'results/input_inventory.json').read_text())
        self.assertEqual(report['sample'], 'synthetic_demo')
        self.assertEqual(report['paired_records'], 2)
        self.assertEqual(report['files'][0]['bases'], 16)
        exported = result.stdout + json.dumps(report)
        self.assertNotIn('synthetic_a', exported)
        self.assertNotIn('ACGTACGT', exported)
        self.assertEqual(self.run_script(workspace, '01_inventory_paircheck.py').returncode, 0)

    def test_pair_mismatch_and_unequal_counts_fail_without_read_identifiers(self):
        workspace = self.workspace()
        fastq(self.reads[1], ['different_identifier', 'synthetic_b'], 2)
        result = self.run_script(workspace, '01_inventory_paircheck.py')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Pair identifiers disagree', result.stderr)
        self.assertNotIn('different_identifier', result.stderr)
        fastq(self.reads[1], ['synthetic_a'], 2)
        result = self.run_script(workspace, '01_inventory_paircheck.py')
        self.assertIn('different numbers', result.stderr)

    def test_empty_and_truncated_gzip_fail(self):
        workspace = self.workspace()
        for mate, path in enumerate(self.reads, 1):
            fastq(path, [], mate)
        self.assertIn('empty', self.run_script(workspace, '01_inventory_paircheck.py').stderr)
        for mate, path in enumerate(self.reads, 1):
            fastq(path, ['synthetic_a'], mate)
        self.reads[1].write_bytes(self.reads[1].read_bytes()[:-4])
        self.assertNotEqual(self.run_script(workspace, '01_inventory_paircheck.py').returncode, 0)

    def test_changed_input_refuses_old_completion_state(self):
        workspace = self.workspace()
        self.assertEqual(self.run_script(workspace, '01_inventory_paircheck.py').returncode, 0)
        for mate, path in enumerate(self.reads, 1):
            fastq(path, ['synthetic_a', 'synthetic_b', 'synthetic_c'], mate)
        result = self.run_script(workspace, '01_inventory_paircheck.py')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Inputs differ', result.stderr)

    def test_runtime_guard_refuses_workspace_moved_into_git(self):
        workspace = self.workspace()
        (workspace / '.git').mkdir()
        result = self.run_script(workspace, '01_inventory_paircheck.py')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('outside Git checkouts', result.stderr)

    def test_packager_blocks_unreviewed_summary_and_excludes_read_files(self):
        workspace = self.workspace()
        out = workspace / 'results'
        (out / 'analysis_status.tsv').write_text('stage\tstatus\nsynthetic\tcomplete\n')
        result = self.run_script(workspace, 'package_results.py')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Scientific review still pending', result.stderr)
        (out / 'summary.md').write_text('Synthetic packaging test. No biological findings.\n')
        (out / 'methods.md').write_text('Synthetic packaging test.\n')
        (out / 'versions/result_validation.json').write_text('{}\n')
        for name in ['qc_summary.tsv', 'species_abundance.tsv', 'gene_hits.tsv', 'pathways.tsv', 'qc/fastqc_checks.tsv']:
            (out / name).write_text('synthetic_header\n')
        for name in ['private.fastq.gz', 'private.bam', 'qc/private.html']:
            (out / name).write_text('SYNTHETIC_PRIVATE_CONTENT')
        result = self.run_script(workspace, 'package_results.py')
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(out / 'synthetic_demo_small_results.zip') as archive:
            self.assertIsNone(archive.testzip())
            self.assertNotIn('private.fastq.gz', archive.namelist())
            self.assertNotIn('private.bam', archive.namelist())
            self.assertNotIn('qc/private.html', archive.namelist())


class PublicReferenceTests(unittest.TestCase):
    def test_panel_hashes_and_unique_identifiers(self):
        references = SOURCE / 'template/references'
        sequences = {}
        current = None
        for line in (references / 'target_panel.fna').read_text().splitlines():
            if line.startswith('>'):
                current = line[1:].split()[0]
                self.assertNotIn(current, sequences)
                sequences[current] = ''
            else:
                sequences[current] += line
        with (references / 'reference_manifest.tsv').open() as stream:
            rows = list(csv.DictReader(stream, delimiter='\t'))
        self.assertEqual(len(rows), 122)
        self.assertEqual(set(sequences), {r['mapping_reference_id'] for r in rows})
        for row in rows:
            sequence = sequences[row['mapping_reference_id']]
            self.assertEqual(hashlib.sha256(sequence.encode()).hexdigest(), row['reference_nt_sha256'])
            self.assertEqual(len(sequence), int(row['reference_nt_length']))
            self.assertTrue(row['primary_publication'].startswith('https://'))


if __name__ == '__main__':
    unittest.main()
