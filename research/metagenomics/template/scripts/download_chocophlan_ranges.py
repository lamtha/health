#!/usr/bin/env python3
"""Resume public ChocoPhlAn with checked byte ranges despite Content-Range */size.

Globus gives a valid HEAD Content-Length but uses an unknown total (*) in GET
Content-Range. aria2 rejects that combination. This downloader validates each
requested range and size, concatenates in order, and hashes the complete archive.
Only a fixed public URL is requested; no local sample data is opened or sent.
"""
import concurrent.futures,hashlib,json,re,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
from workspace_config import ROOT, SAMPLE
URL='https://g-227ca.190ebd.75bc.data.globus.org/humann_data/chocophlan/full_chocophlan.v201901_v31.tar.gz'
SIZE=16502062909;CHUNK=64<<20
DEST=ROOT/'analysis/databases/humann/full_chocophlan.v201901_v31.tar.gz'
PARTS=DEST.parent/'chocophlan_chunks';PARTS.mkdir(parents=True,exist_ok=True)
META=ROOT/'results/versions/chocophlan_download.json'

def get(i):
    start=i*CHUNK;end=min(SIZE,start+CHUNK)-1;needed=end-start+1
    p=PARTS/f'{i:04d}.bin'
    if p.exists() and p.stat().st_size==needed:return i,needed
    partial=p.with_suffix('.part')
    for attempt in range(8):
        have=partial.stat().st_size if partial.exists() else 0
        if have>needed:raise ValueError('Oversized partial range')
        if have==needed:partial.replace(p);return i,needed
        req=urllib.request.Request(URL,headers={'Range':f'bytes={start+have}-{end}'})
        try:
            with urllib.request.urlopen(req,timeout=120) as r:
                content_range=r.headers.get('Content-Range','')
                m=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+|\*)',content_range)
                if r.status!=206 or not m or int(m[1])!=start+have or int(m[2])!=end:
                    raise ValueError('Unexpected range response '+content_range)
                if m[3]!='*' and int(m[3])!=SIZE:raise ValueError('Archive changed size')
                with partial.open('ab') as f:
                    remaining=needed-have
                    while remaining:
                        b=r.read(min(1<<20,remaining))
                        if not b:raise IOError('Truncated range')
                        f.write(b);remaining-=len(b)
                    if r.read(1):raise ValueError('Oversized range response')
            if partial.stat().st_size!=needed:raise ValueError('Wrong range size')
            partial.replace(p);return i,needed
        except Exception:
            if attempt==7:raise
            time.sleep(min(30,2**attempt))
    raise RuntimeError('unreachable')

if __name__=='__main__':
    if DEST.exists() and META.exists():print('Already downloaded');raise SystemExit(0)
    with urllib.request.urlopen(urllib.request.Request(URL,method='HEAD'),timeout=60) as r:
        if int(r.headers['Content-Length'])!=SIZE:raise ValueError('Public archive size changed')
    start=time.monotonic();total=0
    count=(SIZE+CHUNK-1)//CHUNK
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        fs=[pool.submit(get,i) for i in range(count)]
        for future in concurrent.futures.as_completed(fs):
            i,n=future.result();total+=n
            progress=dict(completed_bytes=total,total_bytes=SIZE,complete_pct=100*total/SIZE,
                          elapsed_seconds=time.monotonic()-start,updated_utc=datetime.now(timezone.utc).isoformat())
            (ROOT/'results/versions/chocophlan_download_progress.json').write_text(json.dumps(progress,indent=2)+'\n')
            print(f'{total/SIZE:.1%} complete; chunk {i}',flush=True)
    sha=hashlib.sha256();md5=hashlib.md5();assembled=DEST.with_suffix(DEST.suffix+'.assembled')
    with assembled.open('wb') as out:
        for i in range(count):
            with (PARTS/f'{i:04d}.bin').open('rb') as f:
                for b in iter(lambda:f.read(8<<20),b''):out.write(b);sha.update(b);md5.update(b)
    if assembled.stat().st_size!=SIZE:raise ValueError('Final size mismatch')
    assembled.replace(DEST)
    META.write_text(json.dumps(dict(asset='chocophlan',url=URL,relative_path=str(DEST.relative_to(ROOT)),bytes=SIZE,
        sha256=sha.hexdigest(),md5=md5.hexdigest(),retrieved_utc=datetime.now(timezone.utc).isoformat(),
        elapsed_seconds=time.monotonic()-start,download_method='checked HTTP ranges; 16 connections'),indent=2)+'\n')
    print('Download complete; gzip/tar integrity will be checked during extraction.',flush=True)
