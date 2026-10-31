"""Synthetic alignments exercise evidence thresholds; no biological sample data."""
import csv
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pysam

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('init_workspace', SOURCE / 'init_workspace.py')
initializer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(initializer)


class TargetEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        inputs = [root / 'unused1', root / 'unused2']
        for path in inputs:
            path.touch()
        self.root = initializer.initialize(root / 'run', 'synthetic_mapping', *inputs)
        self.out = self.root / 'results'
        self.work = self.root / 'analysis/work/targeted'
        self.work.mkdir(parents=True)
        refs = [dict(mapping_reference_id=name, target_id=name, gene=name,
                     protein_accession='SYNTHETIC_' + name, reference_source_organism='synthetic',
                     reference_nt_length=300, reference_partial=partial)
                for name, partial in [('full', 'false'), ('partial', 'true')]]
        with (self.out / 'references/reference_manifest.tsv').open('w') as stream:
            writer = csv.DictWriter(stream, delimiter='\t', fieldnames=list(refs[0]))
            writer.writeheader()
            writer.writerows(refs)
        (self.out / 'nonhost_read_stats.tsv').write_text('num_seqs\n100\n100\n')
        self.header = {'HD': {'VN': '1.6'}, 'SQ': [{'SN': r['mapping_reference_id'], 'LN': 300} for r in refs]}

    def alignment(self, name, mate=1, ref=0, start=0, length=100, nm=0, mapq=255, second=180, cigar=None):
        read = pysam.AlignedSegment()
        read.query_name = f'{name}/{mate}'
        read.query_sequence = 'A' * length
        read.flag = 0
        read.reference_id = ref
        read.reference_start = start
        read.mapping_quality = mapq
        read.cigarstring = cigar or f'{length}M'
        read.query_qualities = pysam.qualitystring_to_array('I' * length)
        read.set_tags([('AS', 200), ('XS', second), ('NM', nm)])
        return read

    def summarize(self, mates):
        for mate, reads in enumerate(mates, 1):
            with pysam.AlignmentFile(self.work / f'mate{mate}.bam', 'wb', header=self.header) as bam:
                for read in reads:
                    bam.write(read)
        result = subprocess.run([sys.executable, str(self.out / 'scripts/summarize_targets.py')],
                                cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with (self.out / 'gene_hits.tsv').open() as stream:
            rows = {r['target_id']: r for r in csv.DictReader(stream, delimiter='\t')}
        metrics = json.loads((self.out / 'versions/target_mapping_metrics.json').read_text())
        return rows, metrics

    def test_identity_coverage_length_score_gap_and_unavailable_mapq(self):
        mate1 = [self.alignment('accepted'), self.alignment('ambiguous', second=195),
                 self.alignment('low_identity', nm=10), self.alignment('short', length=70),
                 self.alignment('clipped', cigar='80M20S'), self.alignment('low_mapq', mapq=10)]
        rows, metrics = self.summarize([mate1, [self.alignment('accepted', mate=2)]])
        row = rows['full']
        self.assertEqual(metrics['accepted_reads'], 2)
        self.assertEqual(metrics['rejected_identity_length_or_query_coverage'], 3)
        self.assertEqual(metrics['ambiguous_or_low_mapq_reads'], 2)
        self.assertEqual(int(row['unique_mapped_fragments']), 1)
        self.assertEqual(int(row['reads_with_mapq_unavailable_255']), 2)
        self.assertEqual(row['median_available_mapq'], 'NA')
        self.assertAlmostEqual(float(row['breadth_1x_pct']), 100 / 3, places=3)
        self.assertAlmostEqual(float(row['mean_read_depth']), 2 / 3, places=5)
        self.assertAlmostEqual(float(row['fragments_per_kb_per_million_nonhost_fragments']), 1e9 / 300 / 100, places=5)
        self.assertEqual(row['intact_gene_demonstrated'], 'no')

    def test_depth_limited_label_remains_supported_in_module_export(self):
        path = self.out / 'references/reference_manifest.tsv'
        with path.open() as stream:
            refs = list(csv.DictReader(stream, delimiter='\t'))
        for row in refs:
            row['reference_source_organism'] = 'Bilophila wadsworthia'
            row['reference_role'] = 'target'
            row['gene'] = 'BwBSH2' if row['mapping_reference_id'] == 'full' else 'unused'
        with path.open('w') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(refs[0]), delimiter='\t')
            writer.writeheader(); writer.writerows(refs)
        rows, _ = self.summarize([[self.alignment(f'fragment{i}', start=i*20) for i in range(5)], []])
        self.assertEqual(rows['full']['detection_call'], 'depth_limited_reference_evidence')
        (self.work / 'TARGETED_COMPLETE').touch()
        result = subprocess.run([sys.executable, str(self.out / 'scripts/summarize_target_modules.py')], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with (self.out / 'targeted_modules.tsv').open() as stream:
            module = next(r for r in csv.DictReader(stream, delimiter='\t') if r['module']=='Bilophila_bile_taurine_to_sulfide_surveyed_core')
        self.assertEqual(module['steps_with_partial_or_better_evidence'], '1')
        self.assertEqual(module['complete_intact_pathway_demonstrated'], 'no')

    def test_partial_reference_cannot_become_complete_pathway(self):
        alignments = [self.alignment(f'ref{ref}_read{i}', ref=ref, start=i * 10)
                      for ref in (0, 1) for i in range(20)]
        rows, _ = self.summarize([alignments, []])
        self.assertEqual(rows['full']['detection_call'], 'broad_reference_coverage')
        self.assertEqual(rows['partial']['detection_call'], 'partial_reference_only')
        self.assertEqual(rows['full']['organism_assignment_confidence'], 'unresolved')
        self.assertTrue(all(r['active_pathway_demonstrated'] == 'no' for r in rows.values()))


if __name__ == '__main__':
    unittest.main()
