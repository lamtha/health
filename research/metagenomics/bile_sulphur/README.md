# Bile, taurine and sulphide carrier analysis

This optional local research module separates community gene abundance from gene
coverage per carrier for the *Bilophila wadsworthia* species complex and
*Bacteroides thetaiotaomicron*. It tests a mechanistic chain from bile deconjugation
through taurine desulfonation to respiratory sulphite reduction. It also measures
Bt bile-salt hydrolase and selected mucin sulfatases as potential cooperation
context. It is independent of the Health app runtime.

Only reusable code and public reference selections belong here. Reads, human DNA,
alignments, reconstructed sequences, participant information, selected control
cohorts and aggregate personal results stay in the private workspace. No analysis
stage uploads local biological data. The reference-download stages use public
NCBI GET requests; checksums verify each public genome download.

## Running locally

First complete the [parent pipeline](../README.md) and [follow-up module](../followup/README.md),
including common-length host-depleted reads and original-panel quantification for
all predeclared controls. Controls must be selected before examining gene results.
The optional assembly checks require the follow-up's local assembly, BLAST database
and whole-assembly Bowtie2 index. They do not require another assembly.

Use the parent's pinned environment, the official local MetaPhlAn
`mpa_vJun23_CHOCOPhlAnSGB_202403` database, and the Bt ChocoPhlAn
`v201901_v31` pangenome. Never supply an untrusted pickle as the MetaPhlAn database:
loading a pickle can execute code.

```bash
python3 research/metagenomics/bile_sulphur/init_bile_sulphur.py \
  --workspace "$HOME/private-metagenomics/run-demo"
```

Initialization refuses Git checkouts or existing analysis state, verifies the
frozen parent settings and controls, and creates private files with restrictive
permissions. The common read length, subsampling depth, random seed and resample
count are inherited. Installed scripts and settings are hashed and checked before
execution. Mapping defaults to two libraries with six threads each.

From the private workspace root, with the parent environment activated:

```bash
python results/bile_sulphur/scripts/fetch_genome_metadata.py
python results/bile_sulphur/scripts/extract_marker_metadata.py
python results/bile_sulphur/scripts/prepare_references.py
python results/bile_sulphur/scripts/download_genomes.py
python results/bile_sulphur/scripts/extend_curated_panel.py
python results/bile_sulphur/scripts/build_search_databases.py
bash results/bile_sulphur/scripts/search_references.sh
python results/bile_sulphur/scripts/recover_public_dsrB.py
# Rebuild the protein database/search with recovered public ORFs:
bash results/bile_sulphur/scripts/search_references.sh
python results/bile_sulphur/scripts/build_mapping_panel.py
python results/bile_sulphur/scripts/resolve_fragment_aliases.py
bash results/bile_sulphur/scripts/prepare_mapping_index.sh
python results/bile_sulphur/scripts/run_mapping.py
python results/bile_sulphur/scripts/run_quantification.py
python results/bile_sulphur/scripts/audit_quantification.py
python results/bile_sulphur/scripts/build_results.py
python results/bile_sulphur/scripts/summarize_metalloBSH_family.py
python results/bile_sulphur/scripts/audit_critical_sites.py
python results/bile_sulphur/scripts/audit_reference_and_marker_limits.py
python results/bile_sulphur/scripts/plot_results.py
python results/bile_sulphur/scripts/record_versions.py
```

Optional assembly checks, after the follow-up assembly/index exist:

```bash
python results/bile_sulphur/scripts/audit_coverage_and_assembly.py
python results/bile_sulphur/scripts/validate_new_linkage.py
```

The second command recruits candidate pairs locally to multi-gene contigs and then
competitively remaps those pairs against the entire assembly. Candidate recruitment
alone is not treated as evidence. Outputs retain aggregate coverage and junction
counts; extracted reads and BAMs stay under `analysis/`.

## Reference and functional evidence

The fixed public panel includes eight Bilophila-complex assemblies, eight Bt
strains and seven neighboring genomes. Most Bilophila references are drafts, so
marker validation is explicitly limited to this panel. SGB15452 includes the
historically named *Bilophila* sp. 4_1_30; its carrier denominator is labelled a
species complex. SGB1861 likewise does not identify a particular Bt strain.

Candidate markers must have exactly one near-full hit in each tested carrier
reference, no additional substantial loci, no tested off-group read-length match,
and suitable spacing on the anchor genome. Within-group genomic alleles are added.
The selection thresholds and every pass/rejection are exported. A marker-target
sequence overlap check must pass before mapping.

Target homologues require ≥70% protein identity, ≥90% coverage of both proteins,
the expected reference group, and a ≥10% score margin over other curated queries.
Nonqualifying homologues remain competitors. High-identity split CDS annotations
may be recognized as partial aliases, but every counted read still requires an
acceptable alignment to a full target reference. Partial lengths never become
abundance denominators. Protein annotations may omit genuine loci. The DsrB–D fusion is therefore
also recovered directly from public genomes: a full ≥99%-identity nucleotide
match must translate as a complete, unambiguous ORF with ≥99% protein identity
to the experimentally characterized fusion. Its embedded same-locus annotation
fragments can be aliased when in-frame and identical over ≥180 nt, with genomic
coordinates checked. These aliases still require full-target read alignments.
Recovery is public-reference evidence, not patient gene assembly or new enzyme
validation. Lack of an expanded allele is not proof of biological absence.

The distinct metalloBSHs BwBSH1 and BwBSH2 are anchored to the
[April 2026 primary preprint](https://pmc.ncbi.nlm.nih.gov/articles/PMC13081902/).
Expanded homologues must retain the six metal/cofactor-associated positions and
catalytic histidine. BwBSH2 positions are transferred by alignment from BwBSH1
mutagenesis; conservation is not independent enzyme validation. Read-level codon
support uses quality thresholds and independent fragment votes. It cannot measure
metal occupancy, lysine carboxylation, folding or activity.

The taurine chain follows the [experimental Tpa–SarD–IslAB reconstruction](https://pmc.ncbi.nlm.nih.gov/articles/PMC6386719/).
DsrAB references derive from the [purified Bilophila DsrB–D fusion enzyme](https://pmc.ncbi.nlm.nih.gov/articles/PMC95058/).
DsrC, Ald, AdhE and DsrMKJOP are added as publication-linked pathway/context
references, with evidence weaker than individual purified-enzyme validation where
appropriate. The [DsrC trisulfide mechanism](https://doi.org/10.1126/science.aad3558)
explains why `dsrAB` alone is not a complete terminal reduction claim.

Bt BT2086 has [knockout/complementation evidence](https://elifesciences.org/articles/37182).
BT1259 is retained as an uncertain-function control, not counted as a proven BSH.
Bile-acid specificity varies; a BSH hit does not imply hydrolysis of every substrate.
Mucin sulfatases release sulphate, not taurine. The
[Bt–Bilophila co-culture study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11610557/)
proposed APS-mediated cooperation and measured enhanced sulphide production under
its experimental conditions. This module does not establish APS transfer, nutrient
exchange or active cooperation in a stool sample, and does not comprehensively
assay alternative sulphide pathways.

## Quantification and limitations

Both primary (≥95% nucleotide identity) and target sensitivity (≥90%) assignments
require ≥90% query coverage, ≥80 aligned bases and a ≥10 score gap over other
groups. Within-group allele ties are allowed; reporting-cap hits are rejected.
Specificity is conditional on the finite competitive reference panel.

Community abundance is fragment FPKM. Carrier abundance is the median marker-depth
index per million nonhost fragments, not a cell percentage. For genes ≥600 nt,
within-carrier ratios divide interior target depth by interior marker depth,
trimming each end by the common maximum read length. Short genes use full target
and full marker depth: trimming DsrC or DsrJ can otherwise leave a tiny or empty
interior. The basis is explicit in each row, with full-depth and trimmed-mean
sensitivity estimates. No ratio is an exact integer copy-number measurement. A separate combined
BwBSH1 + BwBSH2 index allows comparison of complementary reference-compatible
forms; its technical interval retains shared-fragment covariance. Summing their
DNA coverage does not assume equal enzyme activity or substrate specificity.

A carrier comparison requires median interior depth ≥1, ≥70% positive loci,
≥100 fragment-locus assignments, median breadth ≥50% and a positive bootstrap
lower denominator. Automated range labels additionally require an eligible sample
and at least three eligible controls. Other ratios are exploratory. Technical
intervals combine marker resampling and weighted fragment-count uncertainty;
they omit reference bias, between-person variation and laboratory differences.
Common-depth subsampling and exact-sequence-pair collapse are separate sensitivities;
the latter is not UMI-based deduplication.

Expanded breadth pools relative-position bins across alleles. It does not prove
one intact gene. Co-detection across reaction steps, local adjacency, intact coding
sequences, complete pathways in one strain and demonstrated metabolic activity are
separate evidence levels. A gene fragment cannot establish all of them. These DNA
measurements do not determine expression, H₂S flux, intestinal location, tissue
injury, IMO diagnosis or symptom causation. Small public cohorts are not clinical
reference intervals.

Outputs include carrier abundance, community abundance, gene-to-marker ratios,
comparison eligibility, allele coverage, critical-site evidence, optional assembly
linkage, public reference provenance and software/database versions. Interpretation
and report packaging remain local; no participant-specific report is distributed
with this module.

```bash
python -m unittest discover -s research/metagenomics/bile_sulphur/tests -v
```

The synthetic tests exercise allele competition, sequence-fragment handling,
alignment thresholds, paired-fragment counting, duplicate denominators, new targets
without invented original-reference evidence, and private initialization boundaries.
