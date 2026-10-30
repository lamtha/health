#!/usr/bin/env python3
"""Local resumable stage coordinator. Downloads run separately; no network calls.

Each subprocess is logged. Failed stages stop with their error, never generate
biological zeroes. A completed stage is skipped on restart.
"""
import json,subprocess,time
from datetime import datetime,timezone
from pathlib import Path
from workspace_config import ROOT, SAMPLE
PY=str(ROOT/'analysis/envs/metagenomics/bin/python')
prepared={'host':'analysis/databases/host/VERIFIED','kraken':'analysis/databases/kraken/pluspf_16_GB_20260626/VERIFIED',
          'metaphlan':'analysis/databases/metaphlan/VERIFIED','chocophlan':'analysis/databases/humann/chocophlan.VERIFIED',
          'uniref90':'analysis/databases/humann/uniref90.VERIFIED'}
jobs={};finished=set()

def exists(p):return (ROOT/p).exists()
def start(name,command):
    log=(ROOT/f'analysis/logs/coordinator_{name}.log').open('a')
    log.write('\nSTART '+datetime.now(timezone.utc).isoformat()+' '+repr(command)+'\n');log.flush()
    jobs[name]=(subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT),log)
    print('Started',name,flush=True)

while True:
    for name,(proc,log) in list(jobs.items()):
        rc=proc.poll()
        if rc is None:continue
        log.close();del jobs[name]
        if rc:raise SystemExit(f'{name} failed ({rc}); inspect analysis/logs/coordinator_{name}.log')
        finished.add(name);print('Completed',name,flush=True)
        subprocess.run([PY,'results/scripts/update_qc_status.py'],cwd=ROOT,check=True)
    # Large extraction/index builds run one at a time. Compute jobs also run
    # one at a time to bound memory and avoid oversubscribing the configured CPUs.
    if not jobs:
        for asset,marker in prepared.items():
            if exists(f'results/versions/{asset}_download.json') and not exists(marker):
                start('prepare_'+asset,[PY,'results/scripts/prepare_database.py',asset]);break
    if not jobs and exists(prepared['host']) and not exists('analysis/work/nonhost/HOST_COMPLETE'):
        start('host',['bash','results/scripts/03_host_taxonomy.sh','host'])
    if not jobs and exists('analysis/work/nonhost/HOST_COMPLETE'):
        if not exists('analysis/work/targeted/TARGETED_COMPLETE'):
            start('targeted',['bash','results/scripts/04_targeted_mapping.sh'])
        elif exists(prepared['kraken']) and not exists('analysis/work/taxonomy/TAXONOMY_COMPLETE'):
            start('taxonomy',['bash','results/scripts/03_host_taxonomy.sh'])
        elif exists(prepared['metaphlan']) and not exists('analysis/work/metaphlan/METAPHLAN_COMPLETE'):
            start('metaphlan',['bash','results/scripts/05_metaphlan_humann.sh','metaphlan'])
        elif all(exists(prepared[x]) for x in ['chocophlan','uniref90','metaphlan']) and not exists('analysis/work/humann/HUMANN_COMPLETE'):
            start('humann',['bash','results/scripts/05_metaphlan_humann.sh'])
        elif all(exists(prepared[x]) for x in ['chocophlan','metaphlan']) and not exists(prepared['uniref90']) and not exists('analysis/work/humann/NUCLEOTIDE_COMPLETE'):
            start('humann_nucleotide',['bash','results/scripts/05_metaphlan_humann.sh','nucleotide'])
    status=dict(updated_utc=datetime.now(timezone.utc).isoformat(),running=list(jobs),
                databases={a:('ready' if exists(p) else 'waiting') for a,p in prepared.items()})
    (ROOT/'results/versions/coordinator_status.json').write_text(json.dumps(status,indent=2)+'\n')
    if all(exists(x) for x in ['analysis/work/targeted/TARGETED_COMPLETE','analysis/work/taxonomy/TAXONOMY_COMPLETE','analysis/work/humann/HUMANN_COMPLETE']):
        print('All compute stages complete; scientific review/export still required.',flush=True);break
    time.sleep(30)
