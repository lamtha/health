# Gene recovery, linkage and public-control comparison

This optional extension of the [parent workflow](../README.md) adds catalytic-site
audits, local assembly and exact-reference abundance comparisons. It runs in the
same **private workspace outside Git**, separately from the Health app. The source
contains algorithms, synthetic tests, two public microbial reference additions
and public tool pins. It contains no case report, measurements, sample identifiers,
input hashes, personal metadata or preselected patient-matched cohort.

## Layout and prerequisites

`init_followup.py` installs `template/` into the private workspace's
`results/followup/`. Intermediate alignments, reconstructed sequences and public
control reads go under `analysis/followup/`. `tests/` creates synthetic fixtures
at runtime. The original taxonomy/HUMAnN workflow stays in the parent directory;
this extension does not rerun HUMAnN on controls or modify the application database.

Start with a parent workspace whose pairing/QC/host-removal stages completed and
whose public references were fetched with `results/scripts/fetch_public_references.py`.
The original nonhost reads must use the parent's `sample_1.fastq.gz` and
`sample_2.fastq.gz` aliases. Original input files are read-only.

The parent analysis environment supplies Bowtie2, samtools, fastp, seqkit, Kraken2
and DIAMOND. Additional tools used by this extension are BLAST+ 2.17.0, minimap2
2.30, MAFFT 7.526 and MEGAHIT 1.2.9. Shell scripts expect the first three in
`analysis/envs/assembly/bin`; Python dependencies are listed in `requirements.txt`.
Resolve platform-appropriate environments and save their explicit package lists
and actual versions in the private run. The parent's macOS locks are not Linux
locks. `record_versions.py` records the executables used by this extension.

On ARM macOS, `build_native_megahit.sh` builds the generic CPU implementation from
the SHA-256-pinned upstream source and applies the included x86-intrinsic guards.
It requires CMake and Homebrew GCC 15 (override `CC`/`CXX` if needed), then runs the
upstream synthetic test. No patched binary is distributed. Other platforms can
provide MEGAHIT on PATH; preserve `--no-hw-accel` for the declared generic path.

Public controls require aria2 from the parent's downloads environment and SRA
Toolkit. The supplied macOS ARM archive is pinned to 3.4.1. Set `SRA_TOOLKIT_BIN`
for another installation. Only normalized SRA with full qualities is downloaded,
never SRA Lite. Verify size, NCBI MD5, local SHA-256 and `vdb-validate` before local
conversion. ENA compressed-FASTQ hashes do not apply to newly converted files.

## Initialize and predeclare controls

Create a new follow-up in an existing private parent workspace:

```bash
python3 research/metagenomics/followup/init_followup.py \
  --workspace "$HOME/private-metagenomics/run-demo" \
  --controls /path/to/preselected-public-controls.tsv \
  --common-depth 2000000 --max-read-length 146 --workers 2 --seed 42
```

Omit `--controls` for recovery/assembly only. The TSV columns are `run_accession`,
`donor`, `cohorts`, and `read_count`. Use a public SRR/ERR/DRR accession, one run per
independent donor, optional semicolon-separated cohort slugs, and an optional
expected **paired-fragment count** from archive metadata. `all_controls` is
implicit. The optional label `subset` receives a separate color in the plot;
it has no built-in age, location or clinical meaning. No personal attributes
belong in the source repository or in network requests.

Select controls from metadata **before examining gene abundance**, save the
selection rationale privately, and document specimen type, collection methods,
extraction/library protocol, read length, age, geography, diet, medication history
and missing matching information. Repeated stools are not independent controls.
For example, [Shalon et al., PRJNA822660](https://doi.org/10.1038/s41586-023-05989-7)
provides public adult stool shotgun data; not every sample in that study is stool
or an eligible independent control. See its supplement and
[ENA project metadata](https://www.ebi.ac.uk/ena/browser/view/PRJNA822660).
This is a source example, not a universally appropriate matched cohort.

The initializer freezes settings and manifest hashes. Changing either refuses
reuse. Changed reads, parameters, references or code require a fresh workspace;
completion markers are not a general dependency-aware workflow engine.

## Run the analyses

From the private workspace root, use the analysis Python and added tool paths:

```bash
export PATH="$PWD/analysis/envs/metagenomics/bin:$PWD/analysis/envs/assembly/bin:$PATH"
python results/scripts/01_inventory_paircheck.py
python results/followup/scripts/prepare_references.py
python results/followup/scripts/check_residue_alignment.py
python results/followup/scripts/record_versions.py
bash results/followup/scripts/run_sample_mapping.sh
bash results/followup/scripts/quantify_original_panel.sh
python results/followup/scripts/recover_genes.py
python results/followup/scripts/context_linkage.py
python results/followup/scripts/audit_coding_gaps.py
```

For a native ARM MEGAHIT build, first run `fetch_tools.py megahit-v1.2.9.tar.gz`
then `bash results/followup/scripts/build_native_megahit.sh`. The downloader uses
fixed public GET URLs and verifies pins; the build is local. For the pinned SRA
Toolkit, run `fetch_tools.py sratoolkit.3.4.1-mac-arm64.tar.gz`, then extract that
verified archive into `analysis/tools/` before downloading controls.

```bash
bash results/followup/scripts/run_assembly.sh
bash results/followup/scripts/analyze_assembly.sh
bash results/followup/scripts/assembly_readback.sh
python results/followup/scripts/finalize_assembly_evidence.py
bash results/followup/scripts/low_depth_assembly.sh
python results/followup/scripts/summarize_low_depth.py
bash results/followup/scripts/translated_search.sh
python results/followup/scripts/summarize_translated.py
```

Whole-sample assembly uses all nonhost reads. The low-depth stage is a separate
reference-recruited sensitivity analysis with minimum count one; it is not
independent validation or strain phasing. If no reads can be recruited, that
optional assembler stage cannot run: report it as unavailable, not a recovered
gene. Assembly outputs can require substantial additional disk and RAM.

With controls selected:

```bash
python results/followup/scripts/download_sra_controls.py
python results/followup/scripts/run_comparison.py
python results/followup/scripts/compare_controls.py
```

The local sample and each control receive identical fastp filtering, the declared
maximum read length, the parent's pinned host index and the same 124-reference
competitive mapping. A run below the declared common depth fails explicitly;
do not silently reduce depth for just that run. Every selected donor must finish
before final comparison. Three measures are exported: full-depth fragment FPKM,
seeded common-depth FPKM, and exact-sequence-pair collapse with **both** numerator
and denominator recalculated. Exact duplicate collapse is not UMI-based molecular
deduplication. Hypergeometric resamples describe technical sampling only.

The mapped gene and original-length sample tables use different input lengths
from the common-length comparison. Do not substitute one for the other.

```bash
python results/followup/scripts/plot_followup.py
python results/followup/scripts/validate_outputs.py
# Inspect tables/figures and replace REVIEW_PENDING in summary.md and methods.md.
python results/followup/scripts/package_results.py
```

The local ZIP contains aggregate evidence, public references, scripts and run
provenance. It excludes reads, BAMs, assemblies, reconstructed sample sequences
and per-read/base tables. **It remains personal research data**, not anonymized
data or an open-source artifact. No workflow stage uploads sample data.

## Evidence rules and sources

- Strict nucleotide acceptance: ≥95% identity, ≥90% query coverage, ≥80 aligned
  bases, ≥10 score margin against reported competitors/XS, MAPQ ≥20 if available.
  MAPQ 255 means unavailable. Counts are fragments for abundance, reads for depth.
- Overlapping mates contribute at most one base vote; conflicting mates are
  discarded. Consensus requires ≥2 fragment votes and ≥90% agreement at BQ20;
  missing sequence stays N. Whole codons are counted at BQ20 and BQ30.
- The [metalloBSH preprint](https://doi.org/10.64898/2026.04.05.716592) tested
  catalytic/metal-site mutants in **BwBSH1**. Corresponding BwBSH2 positions are
  transferred by protein alignment and checked independently with MAFFT.
  Substrate-binding predictions remain separate from mutagenesis evidence.
- [BT2086 knockout/complementation](https://doi.org/10.7554/eLife.37182) supports
  bile deconjugation. [BT1259 purified-protein assays](https://doi.org/10.1128/spectrum.03576-23)
  did not establish BSH activity; it remains an uncertain-function control.
  Mucin sulfatases release sulfate from glycan sulfate esters, not taurine.
- Strong assembly fragments require ≥95% identity and ≥300 reference bases.
  Complete ORF candidates additionally require full reference span, a valid start,
  terminal stop, length divisible by three and no internal stop/N. The exploratory
  short-edge linkage audit uses ≥98% identity and ≥100 nt per nonoverlapping gene.
  Read-back mapping competes against the entire assembly, not only selected contigs.
- Circular placement of observed tpa fragment footprints is an exploratory
  coverage model, not a deletion test or clinical p-value. Translated-read searches
  and reference-recruited assemblies do not replace strict abundance estimates.

Reference co-location is not sample strain linkage. DNA homology, full ORFs and
physical linkage do not demonstrate expression, substrate specificity, metal
occupancy, metabolite exchange or flux. A value outside a small control range is
not a validated abnormality; identical local processing cannot remove laboratory,
upstream processing or demographic differences. Exact references miss divergent
enzymes and alternative organisms. The workflow does not diagnose IMO, pathological
mucus degradation, histamine intolerance or causes of food sensitivities.

## Tests

```bash
python3 -m pip install -r research/metagenomics/followup/requirements.txt
python3 -m unittest discover -s research/metagenomics/followup/tests -v
```

Tests create synthetic reads and alignments in private temporary directories.
They exercise workspace isolation, frozen settings, independent donors, reference
hashes, paired counting, duplicate denominators, empty evidence and comparison
cohort arithmetic. No patient data or database-scale run is needed for CI.
