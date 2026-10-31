"""Recruit locally to multi-gene contigs, then validate against the whole assembly.
Candidates are not evidence until a whole-assembly competitive alignment passes.
"""
from bile_sulphur_config import ROOT, CONFIG
import collections, csv, itertools, json, subprocess
from pathlib import Path
import numpy as np, pysam
from Bio import SeqIO
from quantify_carriers import ROOT, W, OLD, fragment, metrics, write_tsv

O = ROOT / "results/bile_sulphur"
B = ROOT / "analysis/envs/metagenomics/bin"
asm = ROOT / "analysis/followup/work/megahit_native/final.contigs.fa"
index = ROOT / "analysis/followup/work/assembly_index"
rows = list(
    csv.DictReader(open(O / "expanded_assembly_colocation.tsv"), delimiter="\t")
)
wanted = {r["contig"] for r in rows}
if not wanted:
    json.dump(
        dict(status="no_multigene_contigs_to_validate", candidate_fragments=0),
        open(O / "new_linkage_validation.json", "w"),
        indent=2,
    )
    print("No multi-gene contigs to validate", flush=True)
    raise SystemExit(0)
seqs = {r.id: r for r in SeqIO.parse(asm, "fasta") if r.id in wanted}
query = W / "linkage_contigs.fna"
SeqIO.write(seqs.values(), query, "fasta")
with (W / "linkage_index.log").open("w") as out:
    subprocess.run(
        [str(B / "bowtie2-build"), str(query), str(W / "linkage_index")],
        stdout=out,
        stderr=subprocess.STDOUT,
        check=True,
    )
cmd = [
    str(B / "bowtie2"),
    "--very-sensitive-local",
    "--reorder",
    "--seed",
    str(CONFIG["seed"]),
    "-k",
    "5",
    "--threads",
    "2",
    "--no-unal",
    "-x",
    str(W / "linkage_index"),
    "-U",
    ",".join(str(OLD / "sample_local" / f"nonhost_{m}.fastq.gz") for m in [1, 2]),
]
with (W / "linkage_recruit.log").open("w") as log:
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log)
    ids = set()
    with pysam.AlignmentFile(p.stdout, "r") as sam:
        for a in sam.fetch(until_eof=True):
            if not a.is_unmapped:
                ids.add(fragment(a.query_name))
    assert p.wait() == 0
with pysam.FastxFile(
    str(OLD / "sample_local/nonhost_1.fastq.gz")
) as f1, pysam.FastxFile(str(OLD / "sample_local/nonhost_2.fastq.gz")) as f2, (
    W / "linkage_reads_1.fastq"
).open(
    "w"
) as o1, (
    W / "linkage_reads_2.fastq"
).open(
    "w"
) as o2:
    for a, b in zip(f1, f2):
        assert fragment(a.name) == fragment(b.name)
        if fragment(a.name) in ids:
            for rec, out in [(a, o1), (b, o2)]:
                out.write(f"@{rec.name}\n{rec.sequence}\n+\n{rec.quality}\n")
cmd = [
    str(B / "bowtie2"),
    "--very-sensitive-local",
    "--reorder",
    "--seed",
    str(CONFIG["seed"]),
    "-k",
    "10",
    "--threads",
    "2",
    "--dovetail",
    "-X",
    "1000",
    "--no-unal",
    "-x",
    str(index),
    "-1",
    str(W / "linkage_reads_1.fastq"),
    "-2",
    str(W / "linkage_reads_2.fastq"),
]
depth = {c: np.zeros(len(s), dtype=int) for c, s in seqs.items()}
pairs = collections.defaultdict(lambda: collections.defaultdict(list))
proper = collections.defaultdict(set)
with (W / "linkage_competition.log").open("w") as log:
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log)
    with pysam.AlignmentFile(p.stdout, "r") as sam, pysam.AlignmentFile(
        str(W / "linkage_readback.bam"), "wb", header=sam.header
    ) as out:
        for qn, aa in itertools.groupby(
            sam.fetch(until_eof=True), key=lambda a: a.query_name
        ):
            aa = list(aa)
            for mate in [1, 2]:
                hits = sorted(
                    [
                        a
                        for a in aa
                        if not a.is_unmapped
                        and not a.is_supplementary
                        and (a.is_read1 if mate == 1 else a.is_read2)
                    ],
                    key=lambda a: -a.get_tag("AS"),
                )
                if not hits or len(hits) >= 10:
                    continue
                # The same mate locus can appear in alternative paired placements.
                # Keep the reporting-cap guard above and compete distinct loci only.
                unique = {}
                for hit in hits:
                    key = (
                        hit.reference_id,
                        hit.reference_start,
                        hit.is_reverse,
                        hit.cigarstring,
                    )
                    unique.setdefault(key, hit)
                hits = list(unique.values())
                a = hits[0]
                identity, qcov, span, cols = metrics(a)
                if (
                    a.reference_name not in wanted
                    or identity < 0.95
                    or qcov < 0.9
                    or span < 80
                ):
                    continue
                if len(hits) > 1 and a.get_tag("AS") - hits[1].get_tag("AS") < 10:
                    continue
                out.write(a)
                pairs[a.reference_name][fragment(qn)].append(
                    (
                        a.get_blocks(),
                        a.is_reverse,
                        a.reference_start,
                        a.reference_end,
                        a.is_proper_pair,
                    )
                )
                if a.is_proper_pair and 0 < abs(a.template_length) <= 1000:
                    proper[a.reference_name].add(fragment(qn))
                for start, end in a.get_blocks():
                    depth[a.reference_name][start:end] += 1
    assert p.wait() == 0
write_tsv(
    O / "new_linkage_contig_readback.tsv",
    [
        dict(
            contig=c,
            length=len(d),
            candidate_fragments=len(ids),
            accepted_fragments=len(pairs[c]),
            proper_pair_fragments=len(proper[c]),
            mean_depth=float(d.mean()),
            breadth_1x_pct=100 * float((d > 0).mean()),
            minimum_depth=int(d.min()),
            scope="Whole-assembly competitive read-back after local candidate recruitment",
        )
        for c, d in depth.items()
    ],
)
hits = list(csv.DictReader(open(O / "expanded_assembly_hits.tsv"), delimiter="\t"))
regions = {}
for r in hits:
    if r["contig"] not in wanted:
        continue
    k = (r["contig"], r["target"])
    old = regions.get(k)
    if old is None or float(r["bits"]) > float(old["bits"]):
        regions[k] = r
out = []
junc = []
for (c, g), r in regions.items():
    lo = min(int(r["contig_start"]), int(r["contig_end"])) - 1
    hi = max(int(r["contig_start"]), int(r["contig_end"]))
    dd = depth[c][lo:hi]
    seq = seqs[c].seq[lo:hi]
    if int(r["contig_start"]) > int(r["contig_end"]):
        seq = seq.reverse_complement()
    full = int(r["query_start"]) == 1 and int(r["query_end"]) == int(
        r["reference_length"]
    )
    frame = len(seq) % 3 == 0
    stops = str(seq.translate(table=11)).rstrip("*").count("*") if frame else "NA"
    out.append(
        dict(
            contig=c,
            target=g,
            gene=r["gene"],
            aligned_breadth_pct=r["query_coverage_pct"],
            identity_pct=r["identity_pct"],
            readback_depth=float(dd.mean()),
            readback_breadth_pct=100 * float((dd > 0).mean()),
            readback_minimum=int(dd.min()),
            complete_reference_span=full,
            nt_length_mod3=len(seq) % 3,
            internal_stops=stops,
            start_codon=str(seq[:3]) if full else "NA",
            terminal_stop=str(seq[-3:]) if full else "NA",
            evidence="Complete ORF candidate"
            if full
            and frame
            and stops == 0
            and str(seq[:3]) in ["ATG", "GTG", "TTG"]
            and str(seq[-3:]) in ["TAA", "TAG", "TGA"]
            else "Partial coding-region homology",
        )
    )
for c in wanted:
    rr = sorted(
        [
            (
                min(int(r["contig_start"]), int(r["contig_end"])) - 1,
                max(int(r["contig_start"]), int(r["contig_end"])),
                r,
            )
            for (cc, g), r in regions.items()
            if cc == c
        ]
    )
    for (la, ha, a), (lb, hb, b) in zip(rr, rr[1:]):
        single = pair = 0
        for fid, reads in pairs[c].items():

            def overlaps(blocks, l, h):
                return sum(max(0, min(e, h) - max(s, l)) for s, e in blocks)

            if any(
                overlaps(x[0], la, ha) >= 30 and overlaps(x[0], lb, hb) >= 30
                for x in reads
            ):
                single += 1
            if (
                fid in proper[c]
                and any(overlaps(x[0], la, ha) >= 30 for x in reads)
                and any(overlaps(x[0], lb, hb) >= 30 for x in reads)
            ):
                pair += 1
        junc.append(
            dict(
                contig=c,
                gene_a=a["gene"],
                gene_b=b["gene"],
                gap_nt=lb - ha,
                fragments_with_one_read_30nt_each_gene=single,
                proper_fragments_with_30nt_each_gene=pair,
                evidence="Local adjacency only; no whole-pathway or whole-strain phase",
            )
        )
write_tsv(O / "new_linkage_gene_readback.tsv", out)
write_tsv(O / "new_linkage_junctions.tsv", junc)
json.dump(
    dict(
        candidate_fragments=len(ids),
        contigs=sorted(wanted),
        whole_assembly_index=str(index.relative_to(ROOT)),
        min_identity=0.95,
        min_query_coverage=0.9,
        min_aligned_nt=80,
        score_gap=10,
    ),
    open(O / "new_linkage_validation.json", "w"),
    indent=2,
)
print("linked-contig validation complete", len(ids), "candidate fragments", flush=True)
