"""Combine independent assembly, read-back, taxonomy, residue and junction audits."""
import collections, csv, json, itertools
import pysam
from Bio import SeqIO
from Bio.Seq import Seq
from common import OUT, WORK, write_tsv, fragment

assert (WORK / "ASSEMBLY_READBACK_COMPLETE").exists()
tax = {}
for conf, name in [
    ("0.1", "assembly_target_taxonomy_conf0.1.reads.tsv"),
    ("0.2", "assembly_target_taxonomy.reads.tsv"),
]:
    p = WORK / name
    assert p.exists(), p
    for line in p.open():
        c = line.rstrip().split("\t")
        tax[(c[1], conf)] = dict(classified=c[0] == "C", taxid=c[2])
paf = collections.defaultdict(list)
for line in (WORK / "target_contigs_context_exact.paf").open():
    c = line.rstrip().split("\t")
    tags = {x.split(":", 2)[0]: x.split(":", 2)[2] for x in c[12:]}
    paf[c[0]].append(
        dict(
            reference=c[5],
            query_start=int(c[2]),
            query_end=int(c[3]),
            reference_start=int(c[7]),
            reference_end=int(c[8]),
            strand=c[4],
            identity=100 * int(c[9]) / int(c[10]),
            query_fraction=(int(c[3]) - int(c[2])) / int(c[1]),
            mapq=int(c[11]),
            alignment_type=tags.get("tp", "NA"),
        )
    )
rows = []
for r in csv.DictReader((OUT / "assembly_contig_readback.tsv").open(), delimiter="\t"):
    hits = sorted(paf[r["contig"]], key=lambda x: x["query_fraction"], reverse=True)
    best = hits[0] if hits else {}
    r.update(
        kraken_taxid_conf0_1=tax[(r["contig"], "0.1")]["taxid"],
        kraken_taxid_conf0_2=tax[(r["contig"], "0.2")]["taxid"],
        best_context_reference=best.get("reference", "none"),
        best_context_identity_pct=best.get("identity", "NA"),
        best_context_contig_breadth_pct=best.get("query_fraction", 0) * 100,
        context_alignment_blocks=json.dumps(
            hits, sort_keys=True, separators=(",", ":")
        ),
        carrier_interpretation="limited-reference genomic match plus classification sensitivity; no strain assignment or MAG",
    )
    rows.append(r)
write_tsv(OUT / "assembly_contig_evidence.tsv", rows)
hits = list(csv.DictReader((OUT / "assembly_gene_hits.tsv").open(), delimiter="\t"))
contigs = {r.id: str(r.seq) for r in SeqIO.parse(WORK / "target_contigs.fna", "fasta")}
sites = []
for s in csv.DictReader((OUT / "reference_catalytic_sites.tsv").open(), delimiter="\t"):
    pos = int(s["BwBSH2_position"])
    lo = (pos - 1) * 3 + 1
    hi = lo + 2
    cover = []
    for h in hits:
        if (
            h["reference_id"] != "WP_016360761_1"
            or h["search"] != "nucleotide"
            or int(h["gap_bases"]) != 0
            or h["contig"] not in contigs
        ):
            continue
        if int(h["query_start"]) <= lo and int(h["query_end"]) >= hi:
            seq = contigs[h["contig"]][
                int(h["contig_start"]) - 1 : int(h["contig_end"])
            ]
            if h["strand"] == "-":
                seq = str(Seq(seq).reverse_complement())
            aa = str(
                Seq(
                    seq[lo - int(h["query_start"]) : hi - int(h["query_start"]) + 1]
                ).translate()
            )
            cover.append(
                dict(
                    contig=h["contig"],
                    assembled_residue=aa,
                    expected_residue=s["BwBSH2_residue"],
                )
            )
    sites.append(
        dict(
            BwBSH2_position=pos,
            expected_residue=s["BwBSH2_residue"],
            site_evidence=s["evidence"],
            assembled_site_present=bool(cover),
            assembled_site_details=json.dumps(cover, sort_keys=True),
            interpretation="a partial contig cannot establish the complete gene or all catalytic sites in one molecule",
        )
    )
write_tsv(OUT / "catalytic_site_assembly_evidence.tsv", sites)
links = list(
    csv.DictReader((OUT / "assembly_short_fragment_linkage.tsv").open(), delimiter="\t")
)
target = {r["contig"] for r in links}
align = collections.defaultdict(lambda: collections.defaultdict(list))
with pysam.AlignmentFile(
    str(WORK / "target_contigs_readback.bam"), "rb", check_sq=False
) as bam:
    for a in bam.fetch(until_eof=True):
        if a.reference_name in target:
            align[a.reference_name][fragment(a.query_name)].append(a)
for row in links:
    left, right = sorted(
        [
            (int(row["gene1_start"]) - 1, int(row["gene1_end"])),
            (int(row["gene2_start"]) - 1, int(row["gene2_end"])),
        ]
    )
    bridge_reads = set()
    bridge_pairs = set()
    overlap30 = set()
    for fid, records in align[row["contig"]].items():
        positions = set()
        for a in records:
            pos = {
                r
                for q, r in a.get_aligned_pairs(matches_only=True)
                if q is not None and r is not None
            }
            positions |= pos
            if (
                min(pos, default=10**10) < left[1]
                and max(pos, default=-1) >= right[0]
            ):
                bridge_reads.add(fid)
        if (
            len({a.is_read1 for a in records}) == 2
            and all(a.is_proper_pair for a in records)
            and min(a.reference_start for a in records) < left[1]
            and max(a.reference_end for a in records) > right[0]
        ):
            bridge_pairs.add(fid)
        if (
            sum(left[0] <= p < left[1] for p in positions) >= 30
            and sum(right[0] <= p < right[1] for p in positions) >= 30
        ):
            overlap30.add(fid)
    row.update(
        fragments_with_one_read_spanning_both_gene_edges=len(bridge_reads),
        concordant_fragments_spanning_both_gene_edges=len(bridge_pairs),
        fragments_with_30_aligned_bases_in_each_gene=len(overlap30),
    )
write_tsv(OUT / "assembly_junction_validation.tsv", links)
print("Assembly residue and junction validation completed")
