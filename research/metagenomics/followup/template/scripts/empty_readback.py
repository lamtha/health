"""Produce explicit empty aggregate tables when assembly has no target contigs."""
import pysam
from common import OUT, WORK, write_tsv

if (WORK / "target_contigs.fna").stat().st_size:
    raise ValueError("Empty read-back path requires no target contigs")
write_tsv(OUT / "assembly_contig_readback.tsv", [])
write_tsv(OUT / "assembly_gene_readback.tsv", [])
with pysam.AlignmentFile(
    str(WORK / "target_contigs_readback.bam"), "wb", header={"HD": {"VN": "1.6"}}
):
    pass
(WORK / "ASSEMBLY_READBACK_COMPLETE").touch()
