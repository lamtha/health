#!/usr/bin/env python3
"""Initialize a private, local metagenomics workspace without copying input reads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

SOURCE = Path(__file__).resolve().parent


def inside_git(path):
    return any((parent / '.git').exists() for parent in (path, *path.parents))


def initialize(workspace, sample_id, read1, read2):
    workspace = Path(workspace).expanduser().resolve()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', sample_id):
        raise ValueError('Use a pseudonymous sample ID: 1–64 letters, digits, underscores or hyphens')
    if inside_git(workspace) or workspace == SOURCE or SOURCE in workspace.parents:
        raise ValueError('The analysis workspace must be outside every Git checkout')
    if workspace.exists():
        raise FileExistsError('Choose a new workspace; existing directories are never overwritten')
    reads = [Path(p).expanduser().resolve(strict=True) for p in (read1, read2)]
    if reads[0] == reads[1] or not all(p.is_file() for p in reads):
        raise ValueError('Provide two distinct paired-end gzip FASTQ files')
    old_umask = os.umask(0o077)
    try:
        workspace.mkdir(parents=True, mode=0o700)
        shutil.copytree(SOURCE / 'template', workspace / 'results',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        for directory in ['incoming', 'analysis/logs', 'analysis/cache', 'results/qc',
                          'results/taxonomy', 'results/functional', 'results/figures']:
            (workspace / directory).mkdir(parents=True, exist_ok=True)
        for mate, path in enumerate(reads, 1):
            (workspace / f'incoming/sample_{mate}.fastq.gz').symlink_to(path)
        (workspace / 'workspace.json').write_text(json.dumps({
            'schema_version': 1, 'sample_id': sample_id,
            'privacy': 'Private analysis workspace; never commit inputs, outputs or this configuration',
        }, indent=2) + '\n')
        (workspace / '.gitignore').write_text('*\n')
        # Hash only distributed code/reference assets, never input reads here.
        manifest = [{'path': str(p.relative_to(workspace / 'results')),
                     'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                    for p in sorted((workspace / 'results').rglob('*')) if p.is_file()]
        (workspace / 'results/versions/workflow_assets.json').write_text(json.dumps(manifest, indent=2) + '\n')
    finally:
        os.umask(old_umask)
    return workspace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--sample-id', required=True)
    parser.add_argument('--read1', required=True, type=Path)
    parser.add_argument('--read2', required=True, type=Path)
    args = parser.parse_args()
    workspace = initialize(args.workspace, args.sample_id, args.read1, args.read2)
    print('Created private workspace:', workspace)
    print('Run bash results/scripts/run_all.sh from that workspace. Inputs remain at their original locations.')


if __name__ == '__main__':
    main()
