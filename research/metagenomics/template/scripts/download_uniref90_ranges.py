#!/usr/bin/env python3
"""Download the fixed public UniRef90 archive with checked, resumable ranges.

Optional migration reuses only fully downloaded aria2 pieces, following its
version-1 control format documented at:
https://aria2.github.io/manual/en/html/technical-notes.html
Bit order is verified against aria2 release-1.37.0 src/bitfield.h.
No sample files are opened. No upload operations are implemented.
"""
import argparse,concurrent.futures,hashlib,json,re,struct,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
from workspace_config import ROOT, SAMPLE
URL='https://cmprod1.cibio.unitn.it/databases/HUMAnN/uniref90_annotated_v201901b_full.tar.gz'
SIZE=20579913329;CHUNK=16<<20
DEST=ROOT/'analysis/databases/humann/uniref90_annotated_v201901b_full.tar.gz'
PARTS=DEST.parent/'uniref90_chunks';META=ROOT/'results/versions/uniref90_download.json'

def seed_completed_aria2_pieces():
    source=Path(str(DEST)+'.part');control=Path(str(source)+'.aria2')
    b=control.read_bytes();version,extension,hlen=struct.unpack_from('!HII',b)
    if (version,extension,hlen)!=(1,0,0):raise ValueError('Unsupported aria2 control format')
    piece,total,uploaded,blen=struct.unpack_from('!IQQI',b,10)
    if total!=SIZE or not piece or CHUNK%piece:raise ValueError('Unexpected aria2 piece/total size')
    n=(total+piece-1)//piece
    if blen!=(n+7)//8 or len(b)<34+blen+4:raise ValueError('Invalid aria2 bitfield')
    bits=b[34:34+blen]
    def done(i):return bool(bits[i//8]&(128>>(i%8)))
    copied=0
    with source.open('rb') as src:
        for i,start in enumerate(range(0,SIZE,CHUNK)):
            end=min(start+CHUNK,SIZE);stop=start
            while stop<end and done(stop//piece):stop=min(stop+piece,end)
            if stop==start:continue
            full=PARTS/f'{i:04d}.bin';partial=full.with_suffix('.part')
            if full.exists() or partial.exists():continue
            src.seek(start);data=src.read(stop-start)
            if len(data)!=stop-start:raise ValueError('Truncated source file')
            (full if stop==end else partial).write_bytes(data);copied+=len(data)
    record=dict(source='Stopped aria2 download of the same public URL',completed_piece_bytes_reused=copied,
        aria2_control_sha256=hashlib.sha256(b).hexdigest(),piece_length=piece,total_length=total,
        incomplete_aria2_pieces_reused=False,format_source='https://aria2.github.io/manual/en/html/technical-notes.html')
    (ROOT/'results/versions/uniref90_download_migration.json').write_text(json.dumps(record,indent=2)+'\n')
    print('Reused',copied,'bytes from complete aria2 pieces.',flush=True)

def get(i):
    start=i*CHUNK;end=min(SIZE,start+CHUNK)-1;needed=end-start+1
    dest=PARTS/f'{i:04d}.bin';partial=dest.with_suffix('.part')
    if dest.exists():
        if dest.stat().st_size!=needed:raise ValueError('Wrong completed range size')
        return i,needed
    for attempt in range(8):
        have=partial.stat().st_size if partial.exists() else 0
        if have>needed:raise ValueError('Oversized partial range')
        if have==needed:partial.replace(dest);return i,needed
        request=urllib.request.Request(URL,headers={'Range':f'bytes={start+have}-{end}'})
        try:
            with urllib.request.urlopen(request,timeout=120) as response:
                cr=response.headers.get('Content-Range','');m=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+|\*)',cr)
                if response.status!=206 or not m or int(m[1])!=start+have or int(m[2])!=end:
                    raise ValueError('Unexpected range response '+cr)
                if m[3]!='*' and int(m[3])!=SIZE:raise ValueError('Archive size changed')
                with partial.open('ab') as out:
                    remaining=needed-have
                    while remaining:
                        data=response.read(min(1<<20,remaining))
                        if not data:raise IOError('Truncated range')
                        out.write(data);remaining-=len(data)
                    if response.read(1):raise ValueError('Oversized response')
            partial.replace(dest);return i,needed
        except Exception as error:
            print('Retry range',i,'attempt',attempt+1,type(error).__name__,str(error),flush=True)
            if attempt==7:raise
            time.sleep(min(30,2**attempt))

def main(workers,seed):
    if DEST.exists() and META.exists():print('Already downloaded');return
    PARTS.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(URL,method='HEAD'),timeout=60) as response:
        if int(response.headers['Content-Length'])!=SIZE:raise ValueError('Public archive size changed')
    if seed:seed_completed_aria2_pieces()
    started=time.monotonic();completed=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        order=list(range((SIZE+CHUNK-1)//CHUNK))
        # Report reused complete chunks promptly before queueing new ranges.
        order.sort(key=lambda i:not (PARTS/f'{i:04d}.bin').exists())
        futures=[pool.submit(get,i) for i in order]
        for future in concurrent.futures.as_completed(futures):
            i,n=future.result();completed+=n
            progress=dict(completed_bytes=completed,total_bytes=SIZE,complete_pct=100*completed/SIZE,
                elapsed_seconds=time.monotonic()-started,updated_utc=datetime.now(timezone.utc).isoformat(),connections=workers)
            (ROOT/'results/versions/uniref90_download_progress.json').write_text(json.dumps(progress,indent=2)+'\n')
            print(f'{100*completed/SIZE:.2f}% complete; range {i}',flush=True)
    assembled=Path(str(DEST)+'.assembled');sha=hashlib.sha256();md5=hashlib.md5()
    with assembled.open('wb') as out:
        for i in range((SIZE+CHUNK-1)//CHUNK):
            with (PARTS/f'{i:04d}.bin').open('rb') as src:
                for data in iter(lambda:src.read(8<<20),b''):out.write(data);sha.update(data);md5.update(data)
    if assembled.stat().st_size!=SIZE:raise ValueError('Final size mismatch')
    assembled.replace(DEST)
    META.write_text(json.dumps(dict(asset='uniref90',url=URL,relative_path=str(DEST.relative_to(ROOT)),bytes=SIZE,
        sha256=sha.hexdigest(),md5=md5.hexdigest(),retrieved_utc=datetime.now(timezone.utc).isoformat(),
        elapsed_seconds=time.monotonic()-started,download_method=f'checked HTTP ranges; {workers} connections'),indent=2)+'\n')
    print('Download complete; gzip/tar integrity remains to be checked during extraction.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=32)
    parser.add_argument('--seed-from-stopped-aria2',action='store_true');args=parser.parse_args()
    if not 1<=args.workers<=32:raise SystemExit('Use 1-32 connections')
    main(args.workers,args.seed_from_stopped_aria2)
