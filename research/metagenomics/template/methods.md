# Local shotgun metagenomics methods template

**Status: in progress.** This is a protocol template, not an executed sample report.
After computation, add actual depth/retention, QC findings, stage status and
limitations from the measured tables and logs. Remove this status only after review.

Input reads remain local. Software and reference downloads use public GET/HEAD
requests; no sample sequence is submitted to a service. The source read files
are linked read-only by convention, not copied or modified. All generated data,
including hashes, identifiers and small result tables, are private.

The inventory checks every paired gzip FASTQ record, mate identity/order,
sequence/quality length, printable quality range, full gzip CRC and file SHA-256.
Phred+33 is assumed and must be checked against the provider/FastQC evidence.
FastQC is run before and after fastp; MultiQC retains all four mate/stage reports.
Fastp uses paired adapter detection, tail trimming with a four-base window at
mean Q20, qualified-base Q20, at most 40% unqualified bases, at most five Ns and
a 60-base minimum. No deduplication or overlap correction is performed.

Bowtie2 uses GRCh38 no-alt plus decoys, very-sensitive paired mapping, dovetail
alignments and seed 42. Both mates are retained only when neither maps
(`samtools view -f 12 -F 2304`). Removed pairs can include unmapped mates;
the removed-read count is not a count of independently verified human reads.
Host-reference depletion cannot guarantee complete removal. Host alignments
are streamed, not saved. Record original provider filtering as unknown unless supplied.

Kraken2 PlusPF (16-GB cap, 2026-06-26) is run at confidence 0.0, 0.1 and 0.2.
Paired counts mean fragments. Confidence is a support threshold, not a calibrated
probability; the capped database can lose substantial sensitivity at strict
thresholds. Bracken uses the confidence-0.0 report and both 100/150-base models.
Variable-length reads do not exactly match either model. Preserve weak calls
without treating the complete species list as confirmed richness.

MetaPhlAn 4.2.5 uses mpa_vJun23_CHOCOPhlAnSGB_202403 offline. Preserve original
percentages and any UNCLASSIFIED estimate; do not mix them with Kraken read
fractions or Bracken's estimated nonhuman-species denominator. Database naming
changes, merged representatives and SGBs must remain explicit.

HUMAnN 3.9 uses full ChocoPhlAn v201901_v31 and UniRef90 v201901b with packaged
MetaCyc v24 definitions. Each mate receives a distinct local read ID. Nucleotide
profiling uses Bowtie2 very-sensitive end-to-end scoring, 90% query coverage and
50% aggregate subject coverage, with no separate identity cutoff. Translated
search requires 80% amino-acid identity, 90% query coverage and 50% aggregate
subject coverage; E-value cutoff is 1.0. Prescreen threshold is 0.01%.
Unaligned nucleotide reads are eligible for full translated search. RPK and
community-normalized CPM exports retain strata and special features. MinPath is
on, Xipe off; compare the primary gap-filled reconstruction against gap-fill off.
HUMAnN pathway coverage is inferred support, not nucleotide breadth or proof of
an intact pathway. Inspect the mechanism catalog for omitted/unmodeled reactions.
In particular, packaged METH-ACETATE-PWY omits terminal MCR; a label alone does
not establish methane production. Histamine pathway models are not exhaustive.

The curated public reference panel includes distinct Bilophila metalloBSHs from
the April 2026 preprint, taurine/isethionate/sulfite enzymes, other sulfur routes,
methanogenesis, mucus-glycan enzymes and histamine synthesis/degradation.
Accessions, source publications, nucleotide hashes, translation checks and
candidate-versus-experimental evidence are in references/reference_manifest.tsv.
Public reference controls and partial sequences are labelled explicitly.

Each mate is competitively mapped to the nucleotide panel using Bowtie2
very-sensitive-local, seed 42, `-k 10`. Accept at least 95% aligned-read identity,
90% query coverage, 80 aligned query bases, MAPQ ≥20 when available, and an
alignment-score margin ≥10 over alternatives. MAPQ 255 is unavailable, not high
confidence; those reads still require the margin and are separately counted.
Depth counts overlapping mates separately; abundance counts unique fragments
per kb per million nonhost fragments. Broad DNA support requires ≥95% breadth,
≥5x mean depth and ≥10 distinct start/strand/mate combinations on a full reference.
No intact ORF, expression or activity is inferred. Stringent nucleotide matching
can miss divergent homologues, and the panel is not exhaustive.

Reference-source species are separate from sample carriers. A candidate carrier
requires ≥10 supporting fragments and ≥80% of all gene-supporting fragments at
Kraken confidence 0.2, with concordant 0.1 support. Unresolved fragments remain
in the denominator. HUMAnN exact-UniProt-representative links add separate
pangenome association, not assembled-genome linkage or universal cluster function.

Installed macOS compatibility fixes restore native Bowtie2/DIAMOND binaries,
expose HUMAnN's misplaced Python module and adjust only its MetaPhlAn version
parser line index. Scientific algorithms and measured profiles are unchanged.
The explicit environments are platform-specific; other platforms need separate
resolution and validation. Public database pins and executed software/mapping
provenance are recorded under versions/.

Run validate_result_tables.py after scientific review, then package_results.py
to create a private small-results ZIP. It excludes raw reads, alignments and
private QC HTML. The ZIP still contains personal microbiome information and
must not be committed to the public repository. None of these checks provides
clinical validation or establishes disease, depletion, intestinal location,
metabolite flux, viable cells or symptom causation from stool DNA alone.
