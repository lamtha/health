"""Optional local assembly check for an expanded target group; no sequences exported."""
from carrier_config import ROOT, CONFIG
import argparse, csv, json, subprocess
from pathlib import Path
from Bio import SeqIO

p = argparse.ArgumentParser()
p.add_argument("--target", required=True)
p.add_argument("--assembly", required=True)
p.add_argument("--database", required=True)
a = p.parse_args()
R = Path("analysis/carrier_normalization/references")
W = Path("analysis/carrier_normalization/work")
O = Path("results/carrier_normalization")
manifest = {
    r["reference_id"]: r
    for r in csv.DictReader(
        open(O / "references/mapping_panel_manifest.tsv"), delimiter="\t"
    )
}
ids = {
    rid
    for rid, r in manifest.items()
    if r["kind"] == "target" and r["group"] == a.target
}
assert ids, "Unknown target"
query = W / f"{a.target}_assembly_query.fna"
with query.open("w") as f:
    for r in SeqIO.parse(R / "mapping_panel.fna", "fasta"):
        if r.id in ids:
            SeqIO.write(r, f, "fasta")
raw = W / f"{a.target}_assembly_blast.tsv"
cmd = [
    "analysis/envs/assembly/bin/blastn",
    "-query",
    str(query),
    "-db",
    a.database,
    "-task",
    "blastn",
    "-word_size",
    "11",
    "-evalue",
    "1e-10",
    "-max_target_seqs",
    "100",
    "-num_threads",
    "8",
    "-outfmt",
    "6 qseqid sseqid pident length qlen slen qstart qend sstart send evalue bitscore",
    "-out",
    str(raw),
]
subprocess.run(cmd, check=True)
best = {}
for line in raw.open():
    v = line.split()
    q = v[0]
    if float(v[2]) < 90 or int(v[3]) < 300:
        continue
    if q not in best or float(v[11]) > float(best[q][11]):
        best[q] = v
needed = {v[1] for v in best.values()}
seqs = {r.id: r.seq for r in SeqIO.parse(a.assembly, "fasta") if r.id in needed}
out = []
for q in sorted(ids):
    if q not in best:
        out.append(
            dict(
                target=a.target,
                reference_id=q,
                contig="NA",
                contig_length="NA",
                identity_pct="NA",
                aligned_query_nt=0,
                reference_length=int(manifest[q]["length"]),
                query_coverage_pct=0,
                contig_edge="NA",
                coding_start="NA",
                internal_stops="NA",
                evidence="no assembly HSP meeting 90% identity and 300 nt",
            )
        )
    else:
        v = best[q]
        lo = min(int(v[8]), int(v[9])) - 1
        hi = max(int(v[8]), int(v[9]))
        seq = seqs[v[1]][lo:hi]
        if int(v[8]) > int(v[9]):
            seq = seq.reverse_complement()
        # Frame audit only when reference begins at codon 1 and alignment has no length discrepancy.
        coding_start = "NA"
        stops = "NA"
        if int(v[6]) == 1 and len(seq) == int(v[7]) and len(seq) % 3 == 0:
            coding_start = str(seq[:3])
            stops = str(seq.translate(table=11)).rstrip("*").count("*")
        out.append(
            dict(
                target=a.target,
                reference_id=q,
                contig=v[1],
                contig_length=int(v[5]),
                identity_pct=float(v[2]),
                aligned_query_nt=int(v[7]) - int(v[6]) + 1,
                reference_length=int(v[4]),
                query_coverage_pct=100 * (int(v[7]) - int(v[6]) + 1) / int(v[4]),
                contig_edge=lo < 5 or hi > int(v[5]) - 5,
                coding_start=coding_start,
                internal_stops=stops,
                evidence="partial local assembly homology; not a complete functional gene or phased strain",
            )
        )
with (O / f"{a.target}_assembly_evidence.tsv").open("w") as f:
    w = csv.DictWriter(f, out[0], delimiter="\t", lineterminator="\n")
    w.writeheader()
    w.writerows(out)
print("assembly evidence rows", len(out))
