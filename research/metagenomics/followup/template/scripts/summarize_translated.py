"""Exploratory translated-read evidence; never replace strict abundance estimates."""
import collections, csv, itertools, json
from common import ROOT, OUT, WORK, REF, write_tsv, fragment

manifest = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
}
seen = collections.defaultdict(set)
covered = collections.defaultdict(set)
reads = collections.Counter()
private = []
for mate in [1, 2]:
    with (WORK / f"translated_mate{mate}.tsv").open() as f:
        for name, group in itertools.groupby(
            f, key=lambda line: line.split("\t", 1)[0]
        ):
            parsed = [line.rstrip().split("\t") for line in group]
            parsed.sort(key=lambda c: float(c[11]), reverse=True)
            best = parsed[0]
            ref = best[1]
            if ref not in manifest:
                continue
            score = float(best[11])
            gap = score - float(parsed[1][11]) if len(parsed) > 1 else float("inf")
            pid = float(best[2])
            length = int(best[3])
            qc = (abs(int(best[5]) - int(best[4])) + 1) / int(best[6])
            start, end = sorted([int(best[7]), int(best[8])])
            e = float(best[10])
            fid = fragment(name)
            private.append(
                dict(
                    fragment_local_id=fid,
                    mate=mate,
                    reference_id=ref,
                    identity_pct=pid,
                    aligned_aa=length,
                    query_coverage=qc,
                    reference_aa_start=start,
                    reference_aa_end=end,
                    bitscore=score,
                    best_second_bitscore_gap=gap,
                    evalue=e,
                )
            )
            for threshold in [80, 90, 95]:
                if (
                    pid >= threshold
                    and qc >= 0.90
                    and length >= 40
                    and gap >= 10
                    and e <= 1e-10
                ):
                    key = (ref, threshold)
                    seen[key].add(fid)
                    covered[key].update(range(start, end + 1))
                    reads[key] += 1
rows = []
for ref, m in manifest.items():
    for threshold in [80, 90, 95]:
        key = (ref, threshold)
        L = int(m["reference_aa_length"])
        positions = covered[key]
        rows.append(
            dict(
                reference_id=ref,
                gene=m["gene"],
                min_aa_identity_pct=threshold,
                min_query_coverage_pct=90,
                min_aligned_aa=40,
                min_bitscore_gap=10,
                accepted_reads=reads[key],
                unique_fragments=len(seen[key]),
                reference_aa_length=L,
                aa_breadth_pct=100 * len(positions) / L,
                first_covered_aa=min(positions) if positions else "NA",
                last_covered_aa=max(positions) if positions else "NA",
                tpa_nterminal_half_aa_covered=sum(x <= L // 2 for x in positions)
                if m["gene"] == "tpa"
                else "NA",
                interpretation="exploratory homology against context/panel proteins; finite competitor set; not functional validation, carrier proof or comparable to nucleotide FPKM",
            )
        )
write_tsv(OUT / "translated_target_evidence.tsv", rows)
write_tsv(WORK / "translated_target_reads_private.tsv", private)
print(
    [
        (
            r["gene"],
            r["min_aa_identity_pct"],
            r["unique_fragments"],
            r["aa_breadth_pct"],
            r["tpa_nterminal_half_aa_covered"],
        )
        for r in rows
        if r["gene"] in ["BwBSH1", "BwBSH2", "tpa"]
    ]
)
