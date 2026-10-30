"""Local allele-level read coverage, partial gene recovery and physical linkage.
No patient sequences or read IDs leave the private analysis workspace.
"""
from bile_sulphur_config import ROOT, CONFIG
import collections, csv, itertools, json, subprocess
from pathlib import Path
import numpy as np, pysam
from Bio import SeqIO
from quantify_carriers import ROOT, R, W, OLD, classify, fragment, write_tsv, metrics

O = ROOT / "results/bile_sulphur"
A = ROOT / "analysis/bile_sulphur/references"
refs = {
    r["reference_id"]: r
    for r in csv.DictReader(open(R / "mapping_panel_manifest.tsv"), delimiter="\t")
}
provenance = collections.defaultdict(list)
for r in csv.DictReader(open(R / "reference_provenance.tsv"), delimiter="\t"):
    provenance[r["reference_id"]].append(r)
manifest = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader(open(R / "curated_reference_manifest.tsv"), delimiter="\t")
}
targets = {rid for rid, r in refs.items() if r["kind"] == "target"}
coverage = {}
alns_by_fragment = collections.defaultdict(set)
bygroup = collections.defaultdict(list)
counts = collections.Counter()
ids = collections.defaultdict(set)
ident = collections.defaultdict(lambda: np.zeros(2))
with pysam.AlignmentFile(str(W / "sample_local/panel.bam"), "rb") as bam:
    for qn, aa in itertools.groupby(
        bam.fetch(until_eof=True), key=lambda a: a.query_name
    ):
        aa = list(aa)
        for mode, cutoff in [("strict", 0.95), ("relaxed90", 0.9)]:
            a, decision = classify(aa, refs, cutoff)
            if decision != "accepted" or a.reference_name not in targets:
                continue
            rid = a.reference_name
            g = refs[rid]["group"]
            key = (mode, rid)
            n = int(refs[rid]["length"])
            coverage.setdefault(key, np.zeros(n, dtype=np.int32))
            counts[key] += 1
            ids[key].add(fragment(qn))
            identity, qcov, span, cols = metrics(a)
            ident[key] += np.array([identity * cols, cols])
            for start, end in a.get_blocks():
                coverage[key][start:end] += 1
            if mode == "strict":
                alns_by_fragment[fragment(qn)].add(g)
rows = []
bins = []
for key, depth in coverage.items():
    mode, rid = key
    r = refs[rid]
    g = r["group"]
    sources = provenance[rid]
    rows.append(
        dict(
            mode=mode,
            gene=manifest[g]["gene"],
            target=g,
            reference_id=rid,
            reference_length=len(depth),
            accepted_reads=counts[key],
            fragments=len(ids[key]),
            read_depth=float(depth.mean()),
            breadth_pct=100 * float((depth > 0).mean()),
            aligned_identity_pct=100 * ident[key][0] / ident[key][1],
            covered_start_1based=int(np.flatnonzero(depth)[0] + 1),
            covered_end_1based=int(np.flatnonzero(depth)[-1] + 1),
            public_sources=";".join(sorted({p["source"] for p in sources})),
            interpretation="Reads assigned to one allele among within-group ties; individual allele counts are not strain abundances",
        )
    )
    for start in range(0, len(depth), 100):
        end = min(start + 100, len(depth))
        dd = depth[start:end]
        bins.append(
            dict(
                mode=mode,
                gene=manifest[g]["gene"],
                target=g,
                reference_id=rid,
                start_1based=start + 1,
                end_1based=end,
                mean_depth=float(dd.mean()),
                breadth_pct=100 * float((dd > 0).mean()),
            )
        )
if rows:
    write_tsv(O / "sample_allele_coverage.tsv", rows)
else:
    (O / "sample_allele_coverage.tsv").write_text(
        "mode\tgene\ttarget\treference_id\treference_length\taccepted_reads\tfragments\tread_depth\tbreadth_pct\taligned_identity_pct\tcovered_start_1based\tcovered_end_1based\tpublic_sources\tinterpretation\n"
    )
if bins:
    write_tsv(O / "sample_allele_coverage_bins.tsv", bins)
else:
    (O / "sample_allele_coverage_bins.tsv").write_text(
        "mode\tgene\ttarget\treference_id\tstart_1based\tend_1based\tmean_depth\tbreadth_pct\n"
    )
links = collections.Counter()
for gs in alns_by_fragment.values():
    for pair in itertools.combinations(sorted(gs), 2):
        links[pair] += 1
linkrows = [
    dict(
        target_a=a,
        gene_a=manifest[a]["gene"],
        target_b=b,
        gene_b=manifest[b]["gene"],
        shared_fragments=n,
        interpretation="Mate co-assignment only; inspect genomic geometry before physical linkage claim",
    )
    for (a, b), n in sorted(links.items())
]
if linkrows:
    write_tsv(O / "paired_target_coassignment.tsv", linkrows)
else:
    (O / "paired_target_coassignment.tsv").write_text(
        "target_a\tgene_a\ttarget_b\tgene_b\tshared_fragments\tinterpretation\n"
    )
query = W / "all_target_assembly_queries.fna"
with query.open("w") as out:
    for rec in SeqIO.parse(A / "mapping_panel.fna", "fasta"):
        if rec.id in targets:
            SeqIO.write(rec, out, "fasta")
raw = W / "all_target_assembly_blast.tsv"
cmd = [
    "analysis/envs/assembly/bin/blastn",
    "-query",
    str(query),
    "-db",
    "analysis/followup/work/assembly_blast",
    "-task",
    "blastn",
    "-word_size",
    "11",
    "-evalue",
    "1e-10",
    "-max_target_seqs",
    "100",
    "-num_threads",
    "4",
    "-outfmt",
    "6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore",
    "-out",
    str(raw),
]
subprocess.run(cmd, check=True)
hits = []
union = {}
contiggroups = collections.defaultdict(set)
for line in raw.open():
    v = line.split()
    rid = v[0]
    g = refs[rid]["group"]
    if float(v[2]) < 90 or int(v[3]) < 100:
        continue
    row = dict(
        target=g,
        gene=manifest[g]["gene"],
        reference_id=rid,
        contig=v[1],
        identity_pct=float(v[2]),
        aligned_nt=int(v[3]),
        reference_length=int(v[4]),
        contig_length=int(v[5]),
        query_start=int(v[6]),
        query_end=int(v[7]),
        contig_start=int(v[8]),
        contig_end=int(v[9]),
        bits=float(v[11]),
        query_coverage_pct=100 * (int(v[7]) - int(v[6]) + 1) / int(v[4]),
    )
    hits.append(row)
    union.setdefault(rid, np.zeros(int(v[4]), dtype=bool))[
        int(v[6]) - 1 : int(v[7])
    ] = True
    contiggroups[v[1]].add(g)
if hits:
    write_tsv(O / "expanded_assembly_hits.tsv", hits)
else:
    (O / "expanded_assembly_hits.tsv").write_text(
        "target\tgene\treference_id\tcontig\tidentity_pct\taligned_nt\treference_length\tcontig_length\tquery_start\tquery_end\tcontig_start\tcontig_end\tbits\tquery_coverage_pct\n"
    )
summary = []
for g in sorted({refs[rid]["group"] for rid in targets}):
    gh = [r for r in hits if r["target"] == g]
    best = max(gh, key=lambda r: r["query_coverage_pct"], default=None)
    summary.append(
        dict(
            target=g,
            gene=manifest[g]["gene"],
            best_single_hsp_breadth_pct=best["query_coverage_pct"] if best else 0,
            best_reference_id=best["reference_id"] if best else "NA",
            best_contig=best["contig"] if best else "NA",
            best_nt_identity_pct=best["identity_pct"] if best else "NA",
            max_union_breadth_pct=max(
                [
                    100 * float(u.mean())
                    for rid, u in union.items()
                    if refs[rid]["group"] == g
                ],
                default=0,
            ),
            contigs=len({r["contig"] for r in gh}),
            evidence="Unphased nucleotide homology; full coding integrity requires separate audit",
        )
    )
write_tsv(O / "expanded_assembly_summary.tsv", summary)
linkrows = [
    dict(
        contig=c,
        target_groups=";".join(sorted(gs)),
        genes=";".join(manifest[g]["gene"] for g in sorted(gs)),
    )
    for c, gs in contiggroups.items()
    if len(gs) > 1
]
if linkrows:
    write_tsv(O / "expanded_assembly_colocation.tsv", linkrows)
else:
    (O / "expanded_assembly_colocation.tsv").write_text(
        "contig\ttarget_groups\tgenes\n"
    )
print(
    "coverage rows",
    len(rows),
    "assembly HSPs",
    len(hits),
    "multi-target contigs",
    len(linkrows),
    flush=True,
)
