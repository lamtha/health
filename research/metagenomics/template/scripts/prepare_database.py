#!/usr/bin/env python3
"""Verify and extract downloaded public databases. No sample reads are accessed."""
import argparse, gzip, hashlib, json, os, subprocess, tarfile, zipfile
from pathlib import Path
from workspace_config import ROOT, SAMPLE
DB=ROOT/'analysis/databases'

def digest(p, algo='md5'):
    h=hashlib.new(algo)
    with p.open('rb') as f:
        for b in iter(lambda:f.read(8<<20),b''):h.update(b)
    return h.hexdigest()

def checks(path):
    return {Path(line.split()[-1]).name:line.split()[0] for line in path.read_text().splitlines() if line.strip()}

def verify(p, expected):
    actual=digest(p)
    if actual!=expected:raise RuntimeError(f'Checksum mismatch: {p.name}: {actual} != {expected}')
    print('MD5 verified:',p.name,flush=True)

def extract(p,dest):
    dest.mkdir(parents=True,exist_ok=True)
    if p.suffix=='.zip':
        with zipfile.ZipFile(p) as z:
            for n in z.namelist():
                if Path(n).is_absolute() or '..' in Path(n).parts:raise ValueError(n)
            z.extractall(dest)
    else:
        # tar readers may stop at the tar end marker before consuming the gzip
        # trailer. Explicitly reach EOF to check CRC/length for every gzip member.
        if p.name.endswith(('.tar.gz','.tgz')):
            expanded=0
            with gzip.open(p,'rb') as stream:
                for block in iter(lambda:stream.read(8<<20),b''):expanded+=len(block)
            print('Full gzip EOF/CRC verified:',p.name,'expanded bytes:',expanded,flush=True)
        with tarfile.open(p) as t:
            for m in t.getmembers():
                if Path(m.name).is_absolute() or '..' in Path(m.name).parts or m.issym() or m.islnk():raise ValueError(m.name)
            t.extractall(dest)

def main(asset):
    meta=json.loads((ROOT/f'results/versions/{asset}_download.json').read_text())
    archive=ROOT/meta['relative_path']
    targets={'host':DB/'host','kraken':DB/'kraken/pluspf_16_GB_20260626',
             'metaphlan':DB/'metaphlan','chocophlan':DB/'humann/chocophlan','uniref90':DB/'humann/uniref90'}
    out=targets[asset]
    marker=out.with_name(out.name+'.VERIFIED') if asset in ('chocophlan','uniref90') else out/'VERIFIED'
    if marker.exists():print(asset,'already verified');return
    if archive.stat().st_size!=meta['bytes']:raise RuntimeError('Archive size changed')
    pin=json.loads((ROOT/'results/versions/database_pins.json').read_text())[asset]
    if meta['url']!=pin['url'] or archive.stat().st_size!=pin['bytes'] or digest(archive,'sha256')!=pin['sha256']:
        raise RuntimeError('Public database differs from the pinned release; review before changing pins')
    verify(archive,meta['md5'])
    checksum_file={'host':DB/'host/GRCh38_noalt_decoy_as.md5',
                   'kraken':DB/'kraken/pluspf_16_GB.md5',
                   'metaphlan':DB/'metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.md5'}.get(asset)
    expected=checks(checksum_file) if checksum_file else {}
    if archive.name in expected:verify(archive,expected[archive.name])
    extract(archive,out)
    if asset=='host':
        for name,md5 in expected.items():
            if name.endswith('.bt2'):verify(out/name,md5)
    if asset=='kraken':
        for name,md5 in expected.items():
            if name!=archive.name:verify(out/name,md5)
    if asset=='metaphlan':
        base='mpa_vJun23_CHOCOPhlAnSGB_202403'
        fa=out/(base+'.fna')
        if not fa.exists():
            import bz2,shutil
            compressed=out/(base+'.fna.bz2')
            if compressed.exists():
                with bz2.open(compressed,'rb') as src,fa.with_suffix('.partial').open('wb') as dst:
                    shutil.copyfileobj(src,dst,8<<20)
            else:
                # MetaPhlAn distributes separate SGB and viral marker FASTAs.
                # Follow its installer by combining both into the main index.
                parts=[]
                for kind in ['SGB','VSG']:
                    source=out/(base+'_'+kind+'.fna.bz2')
                    if not source.exists():raise RuntimeError('Required public marker component missing: '+source.name)
                    component=out/(base+'_'+kind+'.fna')
                    with bz2.open(source,'rb') as src,component.with_suffix('.partial').open('wb') as dst:
                        shutil.copyfileobj(src,dst,8<<20)
                    component.with_suffix('.partial').replace(component);parts.append(component)
                with fa.with_suffix('.partial').open('wb') as dst:
                    for component in parts:
                        with component.open('rb') as src:shutil.copyfileobj(src,dst,8<<20)
            fa.with_suffix('.partial').replace(fa)
        if not fa.exists():raise RuntimeError('Inspect archive: expected marker FASTA missing')
        env=os.environ.copy();env['PATH']=str(ROOT/'analysis/envs/metagenomics/bin')+':'+env['PATH']
        # MetaPhlAn 4.2 checks for the six .bt2l files even for smaller DBs.
        subprocess.run(['bowtie2-build','--large-index','--threads','8',str(fa),str(out/base)],check=True,env=env)
    report=dict(asset=asset,archive_md5=meta['md5'],archive_sha256=meta['sha256'],
                publisher_checksum_verified=bool(expected),directory=str(out.relative_to(ROOT)),
                gzip_eof_crc_verified=archive.name.endswith(('.tar.gz','.tgz')),
                note='HUMAnN archives: transport/archive integrity and local digest recorded; no independent publisher checksum supplied' if not expected else 'Publisher MD5 verified')
    (ROOT/f'results/versions/{asset}_verification.json').write_text(json.dumps(report,indent=2)+'\n')
    marker.write_text(json.dumps(report)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('asset',choices=['host','kraken','metaphlan','chocophlan','uniref90']);main(p.parse_args().asset)
