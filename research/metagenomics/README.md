# Local shotgun metagenomics research

A standalone, single-sample workflow for paired gzip FASTQs. It combines FastQC /
fastp / MultiQC, human-reference depletion, Kraken2 / Bracken, MetaPhlAn / HUMAnN,
and competitive mapping to publication-curated microbial references. It does not
call the Health app, an LLM, a cloud aligner or a remote sample-analysis service.

The repository contains **code and public references only**. There are no example
patient results, clinical histories, sample identifiers, original input hashes
or reconstructed sample sequences. Tests generate synthetic inputs in temporary
directories. Analysis outputs, including aggregate tables and ZIPs, remain
personal information and must not be committed.

For catalytic-site inspection, local assembly/linkage checks and exact-reference
comparisons against preselected public controls, use the optional
[gene-recovery and comparison extension](followup/README.md). It reuses the private
workspace and adds no application or cloud-analysis dependency.

For validated single-copy markers, expanded target homologues and within-carrier
DNA abundance ratios, continue with [carrier normalization](carrier_normalization/README.md).

## Start a private run

The supplied environment locks target macOS ARM with Rosetta: the analysis tools
run in an x86-64 Conda environment and aria2 uses a native ARM environment. Install
Conda and Rosetta first. Python 3.11+ is needed for the initializer and tests.
Other operating systems need a separately resolved and validated environment;
the macOS locks are not portable. The workflow uses eight compute threads, large
reference databases and hundreds of GB of scratch storage. Plan for substantial
RAM/disk use and hours of execution; downloads are not small dependencies.

Use a pseudonymous label and a **new directory outside every Git checkout**:

```bash
python3 research/metagenomics/init_workspace.py \
  --workspace "$HOME/private-metagenomics/run-demo" \
  --sample-id demo \
  --read1 /path/to/read_1.fastq.gz \
  --read2 /path/to/read_2.fastq.gz

cd "$HOME/private-metagenomics/run-demo"
bash results/scripts/run_all.sh
```

The initializer uses mode 0700, links the two original files without modifying
them, and copies generic scripts/public assets into the private workspace. The
stable internal names `sample_1.fastq.gz` and `sample_2.fastq.gz` are aliases;
aggregate exports use the configured sample ID. Full-record inventory checks
pairing and gzip integrity before processing. Changed input hashes or sample IDs
refuse reuse of old completion state. Run scripts also refuse execution inside Git.
Do not move a live workspace into a checkout or reuse it after changing parameters,
references or code; initialize a fresh run instead.

Downloads fetch fixed public assets using GET/HEAD. No sample reads, derived
sequences, identifiers or human genetic data are transmitted. The pinned host
reference is used only for local depletion, with no host variant analysis.
Reference filtering cannot guarantee that every host fragment is removed.

## What is produced

| Output | Meaning |
|---|---|
| `qc_summary.tsv`, local FastQC/MultiQC reports | Depth, pairing, retention and QC flags |
| `species_abundance.tsv`, `taxonomy/` | Full species estimates, fragment counts, threshold sensitivity and independent marker profile |
| `functional/` | Species-stratified and community gene-family RPK/CPM, pathway abundance and inferred coverage |
| `gene_hits.tsv` | Curated accession, reference evidence, breadth/depth/identity, fragment-normalized abundance and carrier support |
| `gene_taxonomic_support.tsv` | Classifications of gene-supporting fragments, retaining unresolved fragments in denominators |
| `curated_reference_humann_matches.tsv` | Exact curated UniProt-to-UniRef90 representative links, without using gene-name guesses |
| `targeted_modules.tsv`, `pathways.tsv` | Surveyed core-step support and standard versus gap-fill-off reconstruction |
| `mechanism_*catalog.tsv`, `mechanism_gene_families.tsv` | Annotation/model scope, omissions and measured candidate-family strata |
| `figures/`, `versions/`, `references/` | Aggregate coverage plots, actual run provenance, public reference sequences and citations |

The compute runner stops after exports. Review the measurements and replace the
private `summary.md` and `methods.md` placeholders; then run:

```bash
analysis/envs/metagenomics/bin/python results/scripts/validate_result_tables.py
analysis/envs/metagenomics/bin/python results/scripts/package_results.py
```

The ZIP excludes reads, alignments and private QC HTML. It **still contains a
personal microbiome report**, is created locally, and is not an open-source artifact.
The packager is a local handoff tool, not an anonymizer or upload mechanism.

## Evidence and reference scope

The 122-reference panel covers bile/taurine/sulfur metabolism, methanogenesis,
mucin-related glycosidases/sulfatases and histamine synthesis/degradation. Every
sequence has an accession or public GEO locus, source publication, translation
check and evidence grade. Competitive amidohydrolase controls, candidate functions
and a partial reference are kept distinct from experimentally validated enzymes.

- The [April 2026 Bilophila metalloBSH preprint](https://doi.org/10.64898/2026.04.05.716592)
  defines BwBSH1/BwBSH2 sequences, which generic BSH annotation can miss.
- [Taurine/isethionate metabolism](https://doi.org/10.1073/pnas.1815661116) and
  [Bilophila DsrAB](https://doi.org/10.1128/JB.183.5.1727-1733.2001) provide
  independently curated downstream references.
- [R. torques secretome/transcriptome candidates](https://doi.org/10.1128/mbio.00039-24)
  retain candidate-level evidence; GH73 is a context control, not direct mucin-cleavage proof.

All remaining sources are listed in `template/references/reference_manifest.tsv`.
The bundled FASTAs contain only those public microbial references. Rebuilding
uses `fetch_public_references.py` followed by `build_target_panel.py`; changed public
source hashes fail for review rather than silently changing the panel.

Targeted mapping requires ≥95% aligned nucleotide identity, ≥90% query coverage,
≥80 aligned bases, MAPQ ≥20 when available and a ≥10 best/second alignment-score
margin. MAPQ 255 is unavailable, not a confidence score. Broad reference coverage
requires ≥95% breadth, ≥5x mean depth and ≥10 distinct start/strand/mate combinations.
Overlapping mates count separately for depth and once per fragment for abundance.
These are declared research thresholds, not clinical sensitivity/specificity estimates.

HUMAnN homology and species strata remain inference. A UniRef90 representative
link does not establish identical specificity for every cluster member. A
reference-source species is not necessarily the sample carrier. Conserved reads,
horizontal transfer, incomplete databases, low abundance and missing models can
leave organism assignments or functions unresolved.

Always inspect the packaged pathway definitions: METH-ACETATE-PWY omits terminal
MCR, and named histamine pathways may have no model. Gap filling can create
positive pathway scores without observing every required step. Missing evidence
is not confirmed absence. Stool DNA cannot demonstrate expression, metabolite
flux, intestinal location, mucus injury, clinical IMO, food-reaction causation
or protective-commensal depletion without additional evidence.

## Reproducibility and tests

Public archive SHA-256/size pins are in `template/versions/database_pins.json`;
publisher checksums are additionally verified where supplied. Environment locks,
Bracken source hash and packaged HUMAnN mapping hashes are included. Executed
versions and selected pangenome hashes are written locally. The documented macOS
repairs restore executable packaging and adjust HUMAnN's MetaPhlAn version-line
parser; they do not alter alignment/pathway algorithms or fabricate a profile.

Run the synthetic suite with Python 3.11+ and pysam 0.24.1:

```bash
python3 -m pip install pysam==0.24.1
python3 -m unittest discover -s research/metagenomics/tests -v
```

CI exercises workspace isolation, changed-input refusal, FASTQ validation,
competitive-hit thresholds, partial-reference handling, public panel hashes and
ZIP exclusions. It does not download the large databases or run patient data.
The generalized initializer is tested with synthetic inputs; a fresh multi-hour
full metagenomics run is not part of this code-publication check.

The optional [bile–taurine–sulphide module](bile_sulphur/README.md) adds carrier-normalized Bilophila/Bt genes, metalloBSH catalytic-site checks and local pathway-linkage evidence.
