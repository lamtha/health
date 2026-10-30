#!/usr/bin/env python3
"""Validate complete paired FASTQ streams locally; never emit read sequences/IDs."""
import csv, gzip, hashlib, itertools, json, platform, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from workspace_config import ROOT, SAMPLE
OUT = ROOT / 'results'
FILES = [ROOT / 'incoming' / f'sample_{i}.fastq.gz' for i in (1, 2)]

def records(path):
    with gzip.open(path, 'rb') as f:
        n = 0
        while True:
            h = f.readline()
            if not h:
                break
            n += 1
            s, p, q = (f.readline().rstrip(b'\r\n') for _ in range(3))
            if not h.startswith(b'@') or not p.startswith(b'+') or not s or len(s) != len(q):
                raise ValueError(f'Invalid FASTQ structure: {path.name}, record {n}')
            if min(q) < 33 or max(q) > 126:
                raise ValueError(f'Invalid printable quality: {path.name}, record {n}')
            ident = h.split()[0][1:]
            mate = None
            if ident.endswith((b'/1', b'/2')):
                mate, ident = int(ident[-1:]), ident[:-2]
            elif len(h.split()) > 1 and h.split()[1].startswith((b'1:', b'2:')):
                mate = int(h.split()[1][:1])
            yield ident, mate, s, q

def main():
    OUT.mkdir(exist_ok=True)
    metrics = [dict(reads=0, bases=0, n_bases=0, q20_bases=0, q30_bases=0,
                    min_quality_ascii=127, max_quality_ascii=0) for _ in FILES]
    lengths = [Counter(), Counter()]
    tables = {t: bytes(int(i >= t + 33) for i in range(256)) for t in (20, 30)}
    pairs = 0
    for pair in itertools.zip_longest(*(records(p) for p in FILES)):
        if any(x is None for x in pair):
            raise ValueError('Mate files have different numbers of records')
        if pair[0][0] != pair[1][0]:
            raise ValueError(f'Pair identifiers disagree at pair {pairs + 1}')
        pairs += 1
        for i, (_, mate, s, q) in enumerate(pair):
            if mate is not None and mate != i + 1:
                raise ValueError(f'Incorrect mate designation at pair {pairs}')
            m = metrics[i]
            m['reads'] += 1
            m['bases'] += len(s)
            m['n_bases'] += s.upper().count(b'N')
            for t in (20, 30):
                m[f'q{t}_bases'] += q.translate(tables[t]).count(b'\x01')
            m['min_quality_ascii'] = min(m['min_quality_ascii'], min(q))
            m['max_quality_ascii'] = max(m['max_quality_ascii'], max(q))
            lengths[i][len(s)] += 1
        if pairs % 1000000 == 0:
            print(f'Validated {pairs:,} pairs', flush=True)
    if pairs == 0:
        raise ValueError('Paired FASTQ inputs are empty')
    inventory = []
    for i, path in enumerate(FILES):
        sha = hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda: f.read(8 << 20), b''):
                sha.update(chunk)
        inventory.append(dict(sample=SAMPLE, mate=i + 1, path=str(path.relative_to(ROOT)),
                              compressed_bytes=path.stat().st_size, sha256=sha.hexdigest(),
                              **metrics[i], length_counts=dict(lengths[i])))
    report = dict(sample=SAMPLE, validation_utc=datetime.now(timezone.utc).isoformat(),
                  paired_records=pairs, pairing='all_identifiers_matched_in_order',
                  gzip_integrity='both_streams_read_to_eof_crc_checked',
                  quality_encoding='Phred+33 assumed; inspect FastQC and ASCII range',
                  python_version=sys.version, platform=platform.platform(), files=inventory)
    existing=OUT/'input_inventory.json'
    if existing.exists():
        previous=json.loads(existing.read_text())
        signature=lambda rows:[(r['path'],r['sha256'],r['reads'],r['bases']) for r in rows]
        if previous['sample']!=SAMPLE or signature(previous['files'])!=signature(inventory):
            raise ValueError('Inputs differ from the recorded sample; refusing to reuse old completion markers. Use a fresh workspace for changed inputs.')
    (OUT / 'input_inventory.json').write_text(json.dumps(report, indent=2) + '\n')
    with (OUT / 'input_inventory.tsv').open('w') as f:
        fields = [k for k in inventory[0] if k != 'length_counts']
        w = csv.DictWriter(f, fieldnames=fields, delimiter='\t', extrasaction='ignore')
        w.writeheader(); w.writerows(inventory)
    print(json.dumps(dict(paired_records=pairs, files=metrics)), flush=True)

if __name__ == '__main__':
    main()
