"""Recruit context-compatible Bilophila reads plus mates for low-depth assembly sensitivity."""
import collections, gzip, itertools, json
import pysam
from common import ROOT, WORK, OUT, classify, fragment

names = set()
with pysam.AlignmentFile(str(WORK / "context/name_ordered.bam"), "rb") as bam:
    for name, g in itertools.groupby(
        bam.fetch(until_eof=True), key=lambda a: a.query_name
    ):
        records = list(g)
        for mate in [1, 2]:
            sub = [a for a in records if (a.is_read1 if mate == 1 else a.is_read2)]
            if not sub:
                continue
            a, decision, m = classify(sub)
            if decision == "accepted" and a.reference_name.startswith("NZ_KE150"):
                names.add(fragment(name))
d = WORK / "bilophila_recruited"
d.mkdir(exist_ok=True)
counts = 0
with pysam.FastxFile(
    str(ROOT / "analysis/work/nonhost/sample_1.fastq.gz")
) as f1, pysam.FastxFile(str(ROOT / "analysis/work/nonhost/sample_2.fastq.gz")) as f2, (
    d / "mate1.fastq"
).open(
    "w"
) as o1, (
    d / "mate2.fastq"
).open(
    "w"
) as o2:
    for a, b in itertools.zip_longest(f1, f2):
        assert a is not None and b is not None and fragment(a.name) == fragment(b.name)
        if fragment(a.name) in names:
            counts += 1
            for r, o in [(a, o1), (b, o2)]:
                o.write(
                    "@"
                    + fragment(r.name)
                    + "\n"
                    + r.sequence
                    + "\n+\n"
                    + r.quality
                    + "\n"
                )
assert counts == len(names)
(OUT / "bilophila_recruitment.json").write_text(
    json.dumps(
        dict(
            recruited_pairs=counts,
            selection="at least one mate accepted at >=95% nt identity, >=90% query coverage, >=80 aligned bases, score gap >=10 and available MAPQ>=20 against Bilophila 3_1_6 context scaffolds; both mates retained",
            limitation="reference-biased recruitment and small competitor set; excludes divergent/unrecruited reads; auxiliary sensitivity assembly, not independent evidence of a strain",
        ),
        indent=2,
    )
    + "\n"
)
print("Recruited", counts, "pairs", flush=True)
