#!/usr/bin/env python3
"""Download public reference/software assets with GET only. Never opens sample reads."""
import argparse, concurrent.futures, hashlib, json, subprocess, time
from datetime import datetime, timezone
from pathlib import Path

from workspace_config import ROOT, SAMPLE
JOBS = {
    'host': ('https://genome-idx.s3.amazonaws.com/bt/GRCh38_noalt_decoy_as.zip', 'analysis/databases/host/GRCh38_noalt_decoy_as.zip'),
    'host_md5': ('https://genome-idx.s3.amazonaws.com/bt/GRCh38_noalt_decoy_as.md5', 'analysis/databases/host/GRCh38_noalt_decoy_as.md5'),
    'host_manifest': ('https://genome-idx.s3.amazonaws.com/bt/GRCh38_noalt_decoy_as.manifest.json', 'analysis/databases/host/GRCh38_noalt_decoy_as.manifest.json'),
    'kraken': ('https://genome-idx.s3.amazonaws.com/kraken/k2_pluspf_16_GB_20260626.tar.gz', 'analysis/databases/kraken/k2_pluspf_16_GB_20260626.tar.gz'),
    'kraken_md5': ('https://genome-idx.s3.amazonaws.com/kraken/pluspf_16_GB_20260626/pluspf_16_GB.md5', 'analysis/databases/kraken/pluspf_16_GB.md5'),
    'chocophlan': ('https://g-227ca.190ebd.75bc.data.globus.org/humann_data/chocophlan/full_chocophlan.v201901_v31.tar.gz', 'analysis/databases/humann/full_chocophlan.v201901_v31.tar.gz'),
    'uniref90': ('https://cmprod1.cibio.unitn.it/databases/HUMAnN/uniref90_annotated_v201901b_full.tar.gz', 'analysis/databases/humann/uniref90_annotated_v201901b_full.tar.gz'),
    'metaphlan': ('https://cmprod1.cibio.unitn.it/biobakery4/metaphlan_databases/mpa_vJun23_CHOCOPhlAnSGB_202403.tar', 'analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.tar'),
    'metaphlan_md5': ('https://cmprod1.cibio.unitn.it/biobakery4/metaphlan_databases/mpa_vJun23_CHOCOPhlAnSGB_202403.md5', 'analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.md5'),
}

def download(name):
    url, relative = JOBS[name]
    dest = ROOT / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    record_path = ROOT / 'results/versions' / (name + '_download.json')
    if dest.exists() and record_path.exists():
        print(name + ': already downloaded', flush=True)
        return
    part = Path(str(dest) + '.part')
    start = time.monotonic()
    print(name + ': downloading ' + url, flush=True)
    aria = ROOT / 'analysis/envs/downloads/bin/aria2c'
    if Path(str(part)+'.aria2').exists() and not aria.exists():
        raise RuntimeError('An aria2 sparse partial exists; restore aria2 before resuming. curl cannot safely resume it.')
    if aria.exists() and name not in ('host_md5', 'host_manifest', 'kraken_md5', 'metaphlan_md5'):
        connections=16
        subprocess.run([str(aria), '--use-head=true', '--continue=true', '--max-connection-per-server='+str(connections), '--split='+str(connections),
                        '--min-split-size=4M', '--file-allocation=none', '--auto-file-renaming=false',
                        '--summary-interval=60', '--console-log-level=warn', '--max-tries=5',
                        '--retry-wait=5', '--dir='+str(part.parent), '--out='+part.name, url], check=True)
    else:
        subprocess.run(['curl', '-fL', '--retry', '4', '--retry-delay', '5', '--connect-timeout', '30',
                        '--speed-time', '120', '--speed-limit', '1024', '-C', '-', '-o', str(part), url], check=True)
    sha, md5 = hashlib.sha256(), hashlib.md5()
    with part.open('rb') as f:
        for chunk in iter(lambda: f.read(8 << 20), b''):
            sha.update(chunk); md5.update(chunk)
    part.replace(dest)
    record = dict(asset=name, url=url, relative_path=relative, bytes=dest.stat().st_size,
                  sha256=sha.hexdigest(), md5=md5.hexdigest(),
                  retrieved_utc=datetime.now(timezone.utc).isoformat(), elapsed_seconds=time.monotonic()-start)
    record_path.write_text(json.dumps(record, indent=2)+'\n')
    print(name + ': complete', flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('assets', nargs='+', choices=JOBS)
    p.add_argument('--workers', type=int, default=2)
    args = p.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for result in pool.map(download, args.assets):
            pass
