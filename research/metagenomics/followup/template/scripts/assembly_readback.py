"""Filter whole-assembly competitive paired alignments, retaining target contigs locally."""
import collections, csv, itertools, json, sys
import numpy as np
import pysam
from Bio import SeqIO
from common import OUT, WORK, classify, fragment, write_tsv

contigs = {r.id: len(r) for r in SeqIO.parse(WORK / "target_contigs.fna", "fasta")}
depth = {r: np.zeros(n, dtype=np.int32) for r, n in contigs.items()}
fids = collections.defaultdict(set)
proper = collections.defaultdict(set)
accepted = 0
with pysam.AlignmentFile(sys.stdin, "r") as sam, pysam.AlignmentFile(
    str(WORK / "target_contigs_readback.bam"), "wb", header=sam.header
) as out:
    for name, g in itertools.groupby(
        sam.fetch(until_eof=True), key=lambda a: a.query_name
    ):
        records = list(g)
        for mate in [1, 2]:
            sub = [a for a in records if (a.is_read1 if mate == 1 else a.is_read2)]
            if not sub:
                continue
            a, decision, m = classify(sub)
            if decision != "accepted" or a.reference_name not in contigs:
                continue
            ref = a.reference_name
            fid = fragment(a.query_name)
            fids[ref].add(fid)
            accepted += 1
            out.write(a)
            if a.is_proper_pair and 0 < abs(a.template_length) <= 1000:
                proper[ref].add(fid)
            for q, r in a.get_aligned_pairs(matches_only=True):
                if q is not None and r is not None:
                    depth[ref][r] += 1
write_tsv(
    OUT / "assembly_contig_readback.tsv",
    [
        dict(
            contig=ref,
            length=n,
            accepted_fragments=len(fids[ref]),
            proper_pair_fragments=len(proper[ref]),
            mean_depth=float(depth[ref].mean()),
            breadth_1x_pct=float((depth[ref] > 0).mean() * 100),
            breadth_3x_pct=float((depth[ref] >= 3).mean() * 100),
            interpretation="strict competitive mapping against all assembled contigs; read depth includes mate overlap; no strain binning",
        )
        for ref, n in contigs.items()
    ],
)
rows = []
for hit in csv.DictReader((OUT / "assembly_gene_hits.tsv").open(), delimiter="\t"):
    if hit["search"] != "nucleotide" or hit["contig"] not in contigs:
        continue
    d = depth[hit["contig"]][int(hit["contig_start"]) - 1 : int(hit["contig_end"])]
    rows.append(
        dict(
            reference_id=hit["reference_id"],
            gene=hit["gene"],
            contig=hit["contig"],
            query_coverage_pct=hit["query_coverage_pct"],
            identity_pct=hit["identity_pct"],
            full_ORF_candidate=hit["full_ORF_candidate"],
            aligned_region_mean_depth=float(d.mean()),
            aligned_region_breadth_1x_pct=float((d > 0).mean() * 100),
            aligned_region_breadth_3x_pct=float((d >= 3).mean() * 100),
            minimum_depth=int(d.min()),
            interpretation="read-back support for aligned assembled region; does not validate missing gene sequence or expression",
        )
    )
write_tsv(OUT / "assembly_gene_readback.tsv", rows)
(WORK / "ASSEMBLY_READBACK_COMPLETE").touch()
print("Accepted target-contig reads:", accepted, file=sys.stderr)
