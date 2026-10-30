#!/usr/bin/env python3
"""Record versions from the actual local executables; no sample input is opened."""
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path
from workspace_config import ROOT
import humann.config as config

commands = {
    'fastqc': ['fastqc', '--version'], 'fastp': ['fastp', '--version'],
    'multiqc': ['multiqc', '--version'], 'bowtie2': ['bowtie2', '--version'],
    'samtools': ['samtools', '--version'], 'kraken2': ['kraken2', '--version'],
    'bracken': ['bracken', '-v'], 'metaphlan': ['metaphlan', '--version'],
    'humann': ['humann', '--version'], 'diamond': ['diamond', 'version'],
    'seqkit': ['seqkit', 'version'], 'glpsol': ['glpsol', '--version'],
}
versions = {}
for name, command in commands.items():
    process = subprocess.run(command, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, check=True, timeout=60)
    versions[name] = {'command': command, 'output': process.stdout.replace('\x00', '')}
versions['platform'] = {'system': platform.platform(), 'python': sys.version}
versions['note'] = 'Version capture precedes database installation; MetaPhlAn may report no default database here. The analysis uses an explicit offline database.'
out = ROOT / 'results/versions'
(out / 'software_versions.json').write_text(json.dumps(versions, indent=2) + '\n')
expected = json.loads((out / 'humann_packaged_mappings.json').read_text())
for entry in expected:
    path = Path(getattr(config, entry['component']))
    if path.name != entry['file'] or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        raise RuntimeError('Installed HUMAnN mapping differs from pinned provenance: ' + entry['component'])
print('Recorded executable versions and verified packaged HUMAnN mappings.')
