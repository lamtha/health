"""Same strict panel quantification for sample and controls, plus depth matching."""
import argparse, collections, csv, hashlib, json
from pathlib import Path
import numpy as np
import pysam
from common import CONFIG, REF, write_tsv, groups, fragment
from coverage_evidence import coverage_evidence

p = argparse.ArgumentParser()
p.add_argument("directory")
p.add_argument("sample")
p.add_argument("--require-common-depth", action="store_true")
a = p.parse_args()
d = Path(a.directory)
manifest = list(
    csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
)
lengths = {r["mapping_reference_id"]: int(r["reference_nt_length"]) for r in manifest}
counts = collections.Counter()
ident = collections.Counter()
columns = collections.Counter()
ambiguous = collections.Counter()
depth = {r: np.zeros(n, dtype=np.int32) for r, n in lengths.items()}
frags = {r: set() for r in lengths}
footprints = {r: collections.defaultdict(collections.Counter) for r in lengths}
starts = {r: set() for r in lengths}
for mate in [1, 2]:
    for hit, decision, m in groups(d / f"panel_mate{mate}.bam"):
        ref = hit.reference_name
        if decision == "ambiguous_mapq":
            ambiguous[ref] += 1
        if decision != "accepted":
            continue
        fid = fragment(hit.query_name)
        counts[ref] += 1
        frags[ref].add(fid)
        starts[ref].add((hit.reference_start, hit.is_reverse, mate))
        col = sum(n for op, n in hit.cigartuples if op in (0, 1, 2, 7, 8))
        columns[ref] += col
        ident[ref] += col - hit.get_tag("NM")
        for q, r in hit.get_aligned_pairs(matches_only=True):
            if q is not None and r is not None:
                depth[ref][r] += 1
                footprints[ref][fid][r] += 1
stats = list(csv.DictReader((d / "nonhost_stats.tsv").open(), delimiter="\t"))
total = int(stats[0]["num_seqs"])
assert total == int(stats[1]["num_seqs"]) and total > 0
# Exact common-depth sample, not independent thinning of mates.
assert (
    not a.require_common_depth or total >= CONFIG["common_depth"]
), "Sample is below the predeclared common depth"
take = min(CONFIG["common_depth"], total)
selected = np.zeros(total, dtype=bool)
selected[
    np.random.default_rng(CONFIG["seed"]).choice(total, take, replace=False)
] = True
wanted = set().union(*frags.values())
chosen = set()
seen = 0
unique_pairs = set()
target_pair_hash = {}
# A secondary exact-sequence-pair sensitivity analysis addresses large library
# duplication differences. This is not UMI-based molecular deduplication.
with pysam.FastxFile(str(d / "nonhost_1.fastq.gz")) as f1, pysam.FastxFile(
    str(d / "nonhost_2.fastq.gz")
) as f2:
    for i, pair in enumerate(__import__("itertools").zip_longest(f1, f2)):
        r, s = pair
        assert r is not None and s is not None, "unpaired FASTQs"
        fid = fragment(r.name)
        assert fid == fragment(s.name), "mate order mismatch"
        seen += 1
        signature = hashlib.blake2b(
            (r.sequence + "\0" + s.sequence).encode(), digest_size=16
        ).digest()
        unique_pairs.add(signature)
        if fid in wanted:
            target_pair_hash[fid] = signature
            if selected[i]:
                chosen.add(fid)
assert seen == total
rows = []
for row in manifest:
    ref = row["mapping_reference_id"]
    n = lengths[ref]
    dep = depth[ref]
    breadth = float((dep > 0).mean() * 100)
    num = len(frags[ref])
    mean = float(dep.mean())
    rare = np.zeros(n, dtype=np.int32)
    for fid in frags[ref] & chosen:
        for pos, c in footprints[ref][fid].items():
            rare[pos] += c
    label = coverage_evidence(
        counts[ref],
        num,
        breadth / 100,
        mean,
        len(starts[ref]),
        row["reference_partial"] == "true",
        ambiguous[ref],
    )
    rows.append(
        dict(
            sample=a.sample,
            reference_id=ref,
            gene=row["gene"],
            reference_source_organism=row["reference_source_organism"],
            pathway=row["pathway"],
            reference_role=row["reference_role"],
            reference_nt_length=n,
            reference_sha256=row["reference_nt_sha256"],
            nonhost_fragments=total,
            unique_fragments=num,
            accepted_reads=counts[ref],
            mean_read_depth=mean,
            breadth_pct=breadth,
            aligned_identity_pct=100 * ident[ref] / columns[ref]
            if columns[ref]
            else "NA",
            FPKM=num * 1e9 / n / total,
            ambiguous_best_reads=ambiguous[ref],
            **label,
            abundance_scope="Strict CDS-reference index; terminal read rejection can depress short-gene FPKM",
            rarefied_total_fragments=take,
            rarefied_unique_fragments=len(frags[ref] & chosen),
            rarefied_FPKM=len(frags[ref] & chosen) * 1e9 / n / take,
            rarefied_breadth_pct=float((rare > 0).mean() * 100),
            rarefaction_seed=CONFIG["seed"],
            carrier="reference-compatible only; not a strain assignment",
        )
    )
    rows[-1].update(
        exact_unique_nonhost_sequence_pairs=len(unique_pairs),
        exact_sequence_pair_duplicate_fraction=1 - len(unique_pairs) / total,
        exact_unique_target_sequence_pairs=len(
            {target_pair_hash[fid] for fid in frags[ref]}
        ),
        deduplicated_FPKM=len({target_pair_hash[fid] for fid in frags[ref]})
        * 1e9
        / n
        / len(unique_pairs),
    )
write_tsv(d / "gene_quantification.tsv", rows)
bins = []
for ref, dep in depth.items():
    for start in range(0, len(dep), 50):
        values = dep[start : start + 50]
        bins.append(
            dict(
                sample=a.sample,
                reference_id=ref,
                start_1based=start + 1,
                end_1based=start + len(values),
                mean_read_depth=float(values.mean()),
                breadth_pct=float((values > 0).mean() * 100),
            )
        )
write_tsv(d / "gene_coverage_bins.tsv", bins)
(d / "QUANTIFICATION_COMPLETE").touch()
print(
    a.sample,
    total,
    "nonhost fragments",
    sum(counts.values()),
    "accepted reads",
    flush=True,
)
