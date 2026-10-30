# Research workflows

Standalone local research tools live here. They run separately from the Health
application and do not write to its database or send inputs to its extraction API.

- [Shotgun metagenomics](metagenomics/README.md): paired-read QC, host depletion,
  taxonomy, species-stratified functions and curated mechanism-reference evidence.
  Its [follow-up module](metagenomics/followup/README.md) adds gene recovery,
  catalytic-site and assembly/linkage audits, and public-control comparisons.

Only reusable code, synthetic tests, public reference assets and generic protocol
templates belong in this directory. Keep all run workspaces outside Git checkouts.
Reads, personal metadata, input hashes, logs, reports and derived tables remain
private, even when a small result ZIP contains no reads.
