#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
export PATH="$PWD/analysis/envs/metagenomics/bin:$PATH"
sample="$1"
python results/followup/scripts/followup_config.py --run "$sample"
max_length=$(python results/followup/scripts/followup_config.py --value max_read_length)
[[ -f analysis/databases/host/VERIFIED ]] || { echo "Verified host index required" >&2; exit 2; }
dir="analysis/followup/controls/$sample"
mkdir -p "$dir"
if [ "$sample" = sample_local ]; then
  in1="$PWD/incoming/sample_1.fastq.gz"; in2="$PWD/incoming/sample_2.fastq.gz"
else
  [[ -f "$dir/DOWNLOAD_COMPLETE" ]]
  in1="$dir/raw_1.fastq.gz"; in2="$dir/raw_2.fastq.gz"
fi
if [[ ! -f "$dir/FILTER_COMPLETE" ]]; then
  python results/followup/scripts/validate_fastq_pairs.py "$in1" "$in2" --output "$dir/input_pair_validation.json"
  fastp --in1 "$in1" --in2 "$in2" --out1 "$dir/filtered_1.fastq.gz" --out2 "$dir/filtered_2.fastq.gz" \
    --detect_adapter_for_pe --cut_tail --cut_tail_window_size 4 --cut_tail_mean_quality 20 \
    --qualified_quality_phred 20 --unqualified_percent_limit 40 --n_base_limit 5 --length_required 60 \
    --max_len1 "$max_length" --max_len2 "$max_length" --thread 4 --compression 4 --json "$dir/fastp.json" --html "$dir/fastp.html" > "$dir/fastp.log" 2>&1
  touch "$dir/FILTER_COMPLETE"
fi
if [[ ! -f "$dir/HOST_COMPLETE" ]]; then
  bowtie2 --very-sensitive --dovetail --reorder --seed 42 --threads 4 -x analysis/databases/host/GRCh38_noalt_decoy_as \
    -1 "$dir/filtered_1.fastq.gz" -2 "$dir/filtered_2.fastq.gz" 2> "$dir/host.log" \
    | samtools view -u -f 12 -F 2304 - | samtools sort -n -@ 1 -u -T "$dir/host_name_sort" - \
    | samtools fastq -@ 1 -n -1 "$dir/nonhost_1.fastq.gz" -2 "$dir/nonhost_2.fastq.gz" -0 /dev/null -s /dev/null - 2> "$dir/host_fastq.log"
  seqkit stats -T "$dir/nonhost_1.fastq.gz" "$dir/nonhost_2.fastq.gz" > "$dir/nonhost_stats.tsv"
  touch "$dir/HOST_COMPLETE"
fi
if [[ ! -f "$dir/MAPPING_COMPLETE" ]]; then
  for mate in 1 2; do
    bowtie2 --very-sensitive-local --reorder --seed 42 -k 10 --threads 4 --no-unal -x analysis/followup/work/panel_v2/index -U "$dir/nonhost_${mate}.fastq.gz" 2> "$dir/panel_mate${mate}.log" | samtools view -b -o "$dir/panel_mate${mate}.bam"
  done
  touch "$dir/MAPPING_COMPLETE"
fi
if [[ ! -f "$dir/QUANTIFICATION_COMPLETE" ]]; then
  python results/followup/scripts/quantify_panel.py "$dir" "$sample" --require-common-depth > "$dir/quantification.log" 2>&1
fi
