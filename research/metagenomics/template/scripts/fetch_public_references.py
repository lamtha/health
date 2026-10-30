#!/usr/bin/env python3
"""Fetch the recorded public panel sources; never opens local sample reads.

Published accessions and source hashes are in public_reference_sources.tsv.
Existing snapshots must match their recorded hash. A newly downloaded accession
can have changed metadata since retrieval: this is reported and must be reviewed
before replacing the supplied, sequence-hashed target_panel.fna.
"""
import csv,gzip,hashlib,shutil,time,urllib.request
from pathlib import Path
from workspace_config import ROOT, SAMPLE;dest=ROOT/'analysis/references';dest.mkdir(parents=True,exist_ok=True)
manifest=ROOT/'results/references/public_reference_sources.tsv'
for r in csv.DictReader(manifest.open(),delimiter='\t'):
    p=dest/r['file']
    if not p.exists():
        time.sleep(.5)
        data=urllib.request.urlopen(r['url'],timeout=180).read()
        if r['transform']=='gunzip':data=gzip.decompress(data)
        p.write_bytes(data)
    actual=hashlib.sha256(p.read_bytes()).hexdigest()
    if actual!=r['sha256']:raise RuntimeError('Public source changed; review before rebuilding: '+r['file'])
    print('Verified public source',r['file'])
shutil.copyfile(ROOT/'results/references/conventional_bsh_specs.json',dest/'conventional_bsh_specs.json')
