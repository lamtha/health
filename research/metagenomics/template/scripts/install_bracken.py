#!/usr/bin/env python3
"""Install pinned Bracken source locally; use supplied precomputed k-mer models.

Abundance estimation is Python. The C++ database-builder is not required and is
not compiled (Apple clang does not support its default -fopenmp invocation).
"""
import hashlib,json,tarfile,urllib.request
from pathlib import Path
from workspace_config import ROOT, SAMPLE
meta=json.loads((ROOT/'results/versions/bracken_source.json').read_text())
cache=ROOT/'analysis/cache/Bracken-v3.1.tar.gz';cache.parent.mkdir(parents=True,exist_ok=True)
if not cache.exists():cache.write_bytes(urllib.request.urlopen(meta['url'],timeout=120).read())
if hashlib.sha256(cache.read_bytes()).hexdigest()!=meta['sha256']:raise ValueError('Bracken source checksum changed')
dest=ROOT/'analysis/tools';dest.mkdir(exist_ok=True)
if not (dest/'Bracken-3.1/bracken').exists():
    with tarfile.open(cache)as t:
        for m in t.getmembers():
            if Path(m.name).is_absolute()or'..'in Path(m.name).parts or m.issym()or m.islnk():raise ValueError(m.name)
        t.extractall(dest)
for name in ['bracken','bracken-build']:
    p=dest/'Bracken-3.1'/name;p.chmod(p.stat().st_mode|0o111)
print('Bracken source v3.1 ready; executable reports upstream banner v3.0.1')
