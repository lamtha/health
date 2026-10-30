#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/envs/metagenomics/bin:$PATH"
python - <<'PY'
from pathlib import Path
root=Path.cwd();d=root/'analysis/followup/work/panel_v2'
for mate in (1,2):
    for link,target in [
        (d/f'panel_mate{mate}.bam',d/f'mate{mate}.bam'),
        (d/f'nonhost_{mate}.fastq.gz',root/f'analysis/work/nonhost/sample_{mate}.fastq.gz')]:
        assert target.exists(),target
        if link.exists():
            assert link.resolve()==target.resolve(),link
        else:
            link.symlink_to(target)
PY
seqkit stats -T analysis/followup/work/panel_v2/nonhost_1.fastq.gz analysis/followup/work/panel_v2/nonhost_2.fastq.gz > analysis/followup/work/panel_v2/nonhost_stats.tsv
python results/followup/scripts/quantify_panel.py analysis/followup/work/panel_v2 sample_original
python results/followup/scripts/annotate_sample_table.py
