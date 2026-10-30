# Carrier-normalized mucin-gene research

This optional extension asks whether targeted gene abundance reflects more carrier
organisms or different DNA gene content within those organisms. It validates
species-specific single-copy marker candidates, expands selected target homologues,
and reports both community abundance and gene-to-marker coverage ratios. It runs
locally in the private workspace created by the [parent workflow](../README.md)
and [follow-up module](../followup/README.md), independently of the Health app.

Only reusable code and public reference selections belong in this directory.
No patient measurements, control selection matched to a person, identifiers,
input hashes, reads, alignments, assemblies or reports are distributed here.
Generated aggregate results remain private research data.

## Requirements and initialization

Complete the follow-up common-length filtering, host depletion and original-panel
quantification for the sample and every preselected control. Keep the same controls;
do not select them by target-gene results. A control without enough carrier coverage
cannot supply a reliable within-species ratio.

Use the follow-up's pinned Python requirements and installed Bowtie2, samtools and
BLAST+ tools. This extension expects the official local MetaPhlAn
`mpa_vJun23_CHOCOPhlAnSGB_202403` database and the two HUMAnN ChocoPhlAn
`v201901_v31` species pangenomes. Marker metadata extraction reads a Python pickle:
use only the trusted official database installed by the parent workflow, never an
untrusted supplied pickle. Versions and hashes are recorded in the private run.

```bash
python3 research/metagenomics/carrier_normalization/init_carrier_normalization.py \
  --workspace "$HOME/private-metagenomics/run-demo"
```

The initializer refuses Git checkouts and existing carrier-analysis directories.
It inherits the parent's common read length, depth, seed and resample count; a
maximum read length of 80–200 nt is supported by this marker design. Controls and
cohort labels come from the already frozen follow-up manifest. Settings and installed
scripts are hashed; changes require a fresh workspace. Defaults use two concurrent
libraries and six mapping threads per library. Adapt workers to available hardware.

From the private workspace root:

```bash
export PATH="$PWD/analysis/envs/metagenomics/bin:$PWD/analysis/envs/assembly/bin:$PATH"
python results/carrier_normalization/scripts/fetch_genome_metadata.py
python results/carrier_normalization/scripts/extract_marker_metadata.py
python results/carrier_normalization/scripts/prepare_references.py
python results/carrier_normalization/scripts/download_genomes.py
python results/carrier_normalization/scripts/build_search_databases.py
bash results/carrier_normalization/scripts/search_references.sh
python results/carrier_normalization/scripts/build_mapping_panel.py
python results/carrier_normalization/scripts/resolve_fragment_aliases.py
bash results/carrier_normalization/scripts/prepare_mapping_index.sh
python results/carrier_normalization/scripts/run_mapping.py
python results/carrier_normalization/scripts/run_quantification.py
python results/carrier_normalization/scripts/audit_quantification.py
python results/carrier_normalization/scripts/build_results.py
python results/carrier_normalization/scripts/record_versions.py
```

Only the metadata/genome download stages access the network, using public NCBI
GET requests. Every public genome/CDS/protein download is verified against NCBI MD5
and recorded with SHA-256. Read mapping and quantification are local. The optional
assembly audit accepts a target group, local FASTA and existing BLAST database:

```bash
python results/carrier_normalization/scripts/assembly_homolog_audit.py \
  --target rumtor8_02582 \
  --assembly analysis/followup/work/megahit_native/final.contigs.fa \
  --database analysis/followup/work/assembly_blast
```

## Reference validation and assignment

The fixed public validation panel covers multiple complete *M. gnavus* and
*M. torques* genomes plus nearby species. It is a finite, purposive reference panel,
not an exhaustive pangenome. The genome choices and deterministic selection rules
are explicit in the scripts and generated manifests; change them only before a new
analysis. Taxonomic names follow reference metadata, retaining familiar older
*Ruminococcus* names in source accessions.

[MetaPhlAn 4](https://www.nature.com/articles/s41587-023-01688-w) markers are candidates,
not automatically universal single-copy genes. Require one near-full nucleotide hit
in every tested same-species genome, reject additional substantial loci and tested
off-species matches, and space selected markers across the anchor genome. Include
qualifying within-species alleles. SGB4584 and SGB4608 supply the validated carrier
sets. The second *gnavus*-labelled group, SGB4571, is diagnostic only; it is not
silently added to a denominator unvalidated against that group.

The target list derives from the parent publication-curated panel. Protein searches
against public genomes and species pangenomes require ≥70% identity, ≥90% coverage
of both proteins, the corresponding source-species label, and a ≥10% score margin
over other curated target groups. These are sequence-supported homologues, not
new biochemical validations or a whole-pangenome orthology proof. Other significant
matches remain competitors. Evidence for the original *gnavus* enzymes comes from
[primary fucosidase experiments](https://pmc.ncbi.nlm.nih.gov/articles/PMC7872956/);
the *torques* set includes [secretome/transcriptome candidates](https://pmc.ncbi.nlm.nih.gov/articles/PMC11323728/).

Strong same-target partial CDS annotations need separate handling: a split public
gene must not falsely compete with its own full allele. Fragment aliases require
≥95% protein identity, ≥90% subject coverage, 10% to under 90% query coverage,
≥100 aligned amino acids and the same group-score margin. Their partial lengths
never enter gene depth. A read still needs a qualifying alignment to a full target
allele, and other target groups/paralogues still compete. This does not turn a
partial annotation or sample fragment into a complete functional gene.

Map with up to 50 alignments per read and reject reporting-cap saturation. Same-group
alleles may tie; different groups require a ≥10 alignment-score margin. Primary
nucleotide acceptance requires ≥95% identity, ≥90% query coverage and ≥80 aligned
bases. A 90%-identity target sensitivity retains the same strict marker denominator.
Per-sequence MAPQ cannot resolve within-group allele ties, so group-level score
competition is explicit. Specificity remains conditional on the reference panel.

## Measurements and interpretation

- Community gene abundance is fragment FPKM, with pairs counted once per group.
  Carrier abundance is a marker-depth index per million nonhost fragments (and per
  gigabase), not a cell percentage.
- Within-carrier ratio is target interior read depth divided by the median interior
  depth across all validated marker loci, including zeros. Both mates contribute
  aligned bases; ends are trimmed by the common maximum read length. A 10%-per-tail
  trimmed mean provides a second denominator estimate.
- Expanded-group breadth is pooled relative-position-bin occupancy. It is not a
  phased gene alignment or proof of completeness. Original exact-reference breadth
  remains separately labelled.
- Eligibility requires median marker depth ≥1, ≥70% positive markers, ≥100
  fragment-locus assignments, median breadth ≥50% and a positive bootstrap lower
  denominator. Below-threshold ratios are exploratory; zero denominators produce
  `NA`. Automated observed-range labels require at least three eligible controls.
- Technical intervals combine marker-locus resampling and weighted fragment-count
  uncertainty. Zero-match upper bounds assume reference detectability. They omit
  biological variability, laboratory differences and reference-panel uncertainty;
  they are not clinical confidence intervals.
- Common-depth subsampling and exact-sequence-pair collapse recalculate both gene
  and marker abundance. Collapse also changes the whole-library denominator and
  is not UMI-based deduplication. Do not rank weakly covered carriers as if their
  ratios were precise.

Outputs include `carrier_abundance.tsv`, `gene_to_marker_ratios.tsv`,
`sample_control_comparison.tsv`, all locus/group abundances, public reference
provenance, validation decisions and software/database versions. The BAM replay
checks full-depth group counts/depth and preservation of the original exact-reference
counts. Review these tables and write a private interpretation; there is no
case-specific report text in this source module.

Ratios describe community-averaged DNA copy equivalents. They do not measure gene
expression, RNA, enzyme activity, substrate specificity, metabolite flux, mucus
injury or symptom causation. They do not establish that all genes occupy one strain.
An observed small-cohort maximum is not a healthy reference limit. A divergent
homologue can explain a missing exact-reference match without establishing a
complete pathway or its activity.

Run the synthetic tests with:

```bash
python -m unittest discover -s research/metagenomics/carrier_normalization/tests -v
```

Tests cover allele ties, inter-group ambiguity, fragment aliases, alignment caps,
reference-end trimming, paired-fragment counts, duplicate-aware denominators and
private-workspace initialization. CI runs them with the parent research tests.
