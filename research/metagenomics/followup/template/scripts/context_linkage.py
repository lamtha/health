"""Audit paired fragments and genomic context; reference co-location is not sample linkage."""
import collections, csv, itertools, json
import numpy as np
import pysam
from Bio import SeqIO
from common import ROOT, OUT, WORK, REF, write_tsv, classify, groups, fragment

manifest = list(
    csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
)
sel = {
    r["mapping_reference_id"]: r
    for r in manifest
    if (
        r["reference_source_organism"].startswith("Bilophila")
        and r["reference_role"] == "target"
    )
    or r["gene"].startswith("BT")
}
locations = {}
for line in (WORK / "context/reference_gene_locations.tsv").read_text().splitlines():
    ref, chrom, pid, length, qlen, qs, qe, ss, se, score, e = line.split("\t")
    identity = float(pid)
    if (
        ref in sel
        and identity >= 95
        and (int(qe) - int(qs) + 1) / int(qlen) >= 0.95
        and (ref not in locations or float(score) > locations[ref]["score"])
    ):
        locations[ref] = dict(
            ref=ref,
            chrom=chrom,
            start=min(int(ss), int(se)) - 1,
            end=max(int(ss), int(se)),
            strand="+" if int(ss) < int(se) else "-",
            identity=identity,
            score=float(score),
        )
write_tsv(
    OUT / "reference_genome_gene_locations.tsv",
    [
        dict(
            gene=sel[k]["gene"],
            **v,
            interpretation="reference coordinates only; not an assembled sample genome",
        )
        for k, v in locations.items()
    ],
)

target_fragments = collections.defaultdict(lambda: collections.defaultdict(set))
target_any = set()
for mate in [1, 2]:
    for a, decision, m in groups(WORK / f"panel_v2/mate{mate}.bam"):
        if decision == "accepted" and a.reference_name in sel:
            fid = fragment(a.query_name)
            target_any.add(fid)
            target_fragments[fid][mate].add(a.reference_name)
pairlinks = collections.Counter()
pairsame = collections.Counter()
examples = []
templates = []
window = 10000
window_depth = {
    r: np.zeros(v["end"] - v["start"] + window * 2, dtype=np.int32)
    for r, v in locations.items()
}
gene_depth = {
    r: np.zeros(v["end"] - v["start"], dtype=np.int32) for r, v in locations.items()
}
gene_frags = collections.defaultdict(set)
mapped_targets = collections.defaultdict(set)
paired_flank = collections.defaultdict(set)
with pysam.AlignmentFile(str(WORK / "context/name_ordered.bam"), "rb") as bam:
    for name, group in itertools.groupby(
        bam.fetch(until_eof=True), key=lambda a: a.query_name
    ):
        fid = fragment(name)
        records = list(group)
        best = {}
        for mate in [1, 2]:
            sub = [a for a in records if (a.is_read1 if mate == 1 else a.is_read2)]
            if not sub:
                continue
            a, decision, m = classify(sub)
            if decision == "accepted":
                best[mate] = a
        for mate, a in best.items():
            for ref, v in locations.items():
                if (
                    a.reference_name != v["chrom"]
                    or a.reference_end < v["start"] - window
                    or a.reference_start > v["end"] + window
                ):
                    continue
                for q, r in a.get_aligned_pairs(matches_only=True):
                    if q is not None and r is not None:
                        index = r - (v["start"] - window)
                        if 0 <= index < len(window_depth[ref]):
                            window_depth[ref][index] += 1
                        if v["start"] <= r < v["end"]:
                            gene_depth[ref][r - v["start"]] += 1
                            gene_frags[ref].add(fid)
        if fid not in target_any:
            continue
        for mate, refs in target_fragments[fid].items():
            if mate not in best:
                continue
            a = best[mate]
            for ref in refs:
                if ref not in locations:
                    continue
                v = locations[ref]
                if (
                    a.reference_name == v["chrom"]
                    and a.reference_start < v["end"]
                    and a.reference_end > v["start"]
                ):
                    mapped_targets[ref].add(fid)
                    other = best.get(3 - mate)
                    if (
                        other is not None
                        and a.is_proper_pair
                        and other.is_proper_pair
                        and a.reference_name == other.reference_name
                        and a.is_reverse != other.is_reverse
                        and 0 < abs(a.template_length) <= 1000
                    ):
                        templates.append(abs(a.template_length))
                        if (
                            other.reference_start < v["start"]
                            or other.reference_end > v["end"]
                        ):
                            paired_flank[ref].add(fid)
        if len(best) == 2:
            a, b = best[1], best[2]
            if (
                a.is_proper_pair
                and b.is_proper_pair
                and a.reference_name == b.reference_name
                and a.is_reverse != b.is_reverse
                and 0 < abs(a.template_length) <= 1000
            ):
                for x in target_fragments[fid][1]:
                    for y in target_fragments[fid][2]:
                        if x != y:
                            key = tuple(sorted([x, y]))
                            pairlinks[key] += 1
                            examples.append(
                                dict(
                                    fragment_local_id=fid,
                                    gene1=x,
                                    gene2=y,
                                    template_length=abs(a.template_length),
                                    chromosome=a.reference_name,
                                )
                            )
write_tsv(
    WORK / "paired_gene_fragments_private.tsv",
    examples,
    ["fragment_local_id", "gene1", "gene2", "template_length", "chromosome"],
)
rows = []
for x, y in itertools.combinations(sel, 2):
    if x not in locations or y not in locations:
        continue
    vx, vy = locations[x], locations[y]
    same = vx["chrom"] == vy["chrom"]
    gap = (
        max(0, max(vx["start"], vy["start"]) - min(vx["end"], vy["end"]))
        if same
        else "NA"
    )
    rows.append(
        dict(
            gene1=sel[x]["gene"],
            gene2=sel[y]["gene"],
            reference1=x,
            reference2=y,
            same_reference_scaffold=same,
            reference_intergenic_distance_nt=gap,
            sample_concordant_strict_fragment_links=pairlinks[tuple(sorted([x, y]))],
            interpretation="local physical DNA support only; no whole-strain phasing"
            if pairlinks[tuple(sorted([x, y]))]
            else "no physical link observed; distant loci cannot be bridged by these short fragments",
        )
    )
write_tsv(OUT / "paired_gene_linkage.tsv", rows)
write_tsv(
    OUT / "target_context_support.tsv",
    [
        dict(
            reference_id=r,
            gene=sel[r]["gene"],
            original_target_fragments=len(
                {
                    fid
                    for fid, mates in target_fragments.items()
                    if any(r in refs for refs in mates.values())
                }
            ),
            target_fragments_at_expected_genomic_locus=len(mapped_targets[r]),
            target_fragments_with_concordant_flanking_mate=len(paired_flank[r]),
            genomic_mapping_total_fragments=len(gene_frags[r]),
            genomic_mapping_mean_depth=float(gene_depth[r].mean()),
            genomic_mapping_breadth_pct=float((gene_depth[r] > 0).mean() * 100),
            interpretation="alignment against Bilophila 3_1_6 and Bt VPI-5482 context genomes; limited competitor set, not an independent species or strain classifier",
        )
        for r in locations
    ],
)
bins = []
for ref, v in locations.items():
    for start in range(0, len(window_depth[ref]), 100):
        dep = window_depth[ref][start : start + 100]
        bins.append(
            dict(
                reference_id=ref,
                gene=sel[ref]["gene"],
                genomic_start_1based=v["start"] - window + start + 1,
                genomic_end=v["start"] - window + start + len(dep),
                mean_read_depth=float(dep.mean()),
                breadth_pct=float((dep > 0).mean() * 100),
            )
        )
write_tsv(OUT / "genomic_context_coverage.tsv", bins)
ref = "WP_005028753_1"
v = locations[ref]
dep = gene_depth[ref][::-1] if v["strand"] == "-" else gene_depth[ref]
write_tsv(
    OUT / "tpa_genome_mapping_per_base.tsv",
    [
        dict(reference_position_1based=i + 1, accepted_context_read_depth=int(n))
        for i, n in enumerate(dep)
    ],
)
(OUT / "fragment_geometry.json").write_text(
    json.dumps(
        dict(
            number_of_target_pair_entries=len(templates),
            median_insert=float(np.median(templates)) if templates else None,
            insert_5_95_percentiles=np.quantile(templates, [0.05, 0.95]).tolist()
            if templates
            else [],
            unique_gene_pair_links=[
                dict(reference1=a, reference2=b, count=n)
                for (a, b), n in pairlinks.items()
            ],
            limitations="Repeated entries can arise if both mates hit one target; insert summaries describe target-supported alignments only.",
        ),
        indent=2,
    )
    + "\n"
)
print("Physical links", dict(pairlinks))
