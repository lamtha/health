"""Audit the reference-recruited, min-count-one assembly as a sensitivity check.

No assembled sequence is exported. These fragments are not independent evidence
from the source reads and must not be presented as phased complete genes.
"""
import collections, csv, json
from Bio import SeqIO
from Bio.Seq import Seq
from common import OUT, WORK, REF, write_tsv

assert (WORK / "LOW_DEPTH_ASSEMBLY_COMPLETE").exists()
manifest = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
}
contigs = {
    r.id: str(r.seq)
    for r in SeqIO.parse(WORK / "bilophila_low_depth/final.contigs.fa", "fasta")
}
hits = []
coverage = collections.defaultdict(set)
for line in (WORK / "low_depth_gene_hits.tsv").open():
    c = line.rstrip().split("\t")
    ref, contig = c[:2]
    identity = float(c[2])
    length, qlen, slen, qs, qe, ss, se = map(int, c[3:10])
    gaps = int(c[12])
    if identity < 95 or length < 50:
        continue
    strong = length >= 100
    if strong:
        coverage[ref].update(range(qs, qe + 1))
    hits.append(
        dict(
            reference_id=ref,
            gene=manifest[ref]["gene"],
            contig=contig,
            contig_length=slen,
            identity_pct=identity,
            aligned_length=length,
            reference_length=qlen,
            reference_start=qs,
            reference_end=qe,
            contig_start=min(ss, se),
            contig_end=max(ss, se),
            strand="+" if ss < se else "-",
            gap_bases=gaps,
            meets_100nt_sensitivity_rule=strong,
            interpretation="reference-recruited min-count-one assembly; not independent validation, complete-gene recovery or strain phasing",
        )
    )
write_tsv(OUT / "low_depth_assembly_gene_hits.tsv", hits)
summary = []
for ref, positions in coverage.items():
    n = int(manifest[ref]["reference_nt_length"])
    summary.append(
        dict(
            reference_id=ref,
            gene=manifest[ref]["gene"],
            covered_reference_bases=len(positions),
            reference_length=n,
            union_breadth_pct=100 * len(positions) / n,
            separate_contigs=len(
                {
                    r["contig"]
                    for r in hits
                    if r["reference_id"] == ref and r["meets_100nt_sensitivity_rule"]
                }
            ),
            full_length_single_contig=any(
                r["reference_start"] == 1 and r["reference_end"] == n
                for r in hits
                if r["reference_id"] == ref
            ),
            interpretation="union across separate, unphased fragments; minimum count one permits single-read evidence",
        )
    )
write_tsv(OUT / "low_depth_assembly_gene_summary.tsv", summary)
sites = []
for s in csv.DictReader((OUT / "reference_catalytic_sites.tsv").open(), delimiter="\t"):
    pos = int(s["BwBSH2_position"])
    lo = (pos - 1) * 3 + 1
    hi = lo + 2
    matching = []
    for h in hits:
        if (
            h["reference_id"] != "WP_016360761_1"
            or h["gap_bases"]
            or not h["meets_100nt_sensitivity_rule"]
        ):
            continue
        if not h["reference_start"] <= lo <= hi <= h["reference_end"]:
            continue
        sequence = Seq(contigs[h["contig"]][h["contig_start"] - 1 : h["contig_end"]])
        if h["strand"] == "-":
            sequence = sequence.reverse_complement()
        residue = str(
            sequence[
                lo - h["reference_start"] : hi - h["reference_start"] + 1
            ].translate()
        )
        matching.append(dict(contig=h["contig"], assembled_residue=residue))
    sites.append(
        dict(
            BwBSH2_position=pos,
            expected_residue=s["BwBSH2_residue"],
            site_evidence=s["evidence"],
            assembled_site_present=bool(matching),
            assembled_site_details=json.dumps(matching, sort_keys=True),
            interpretation="relaxed assembly from the same reads; minimum count one; residues across contigs are not phased",
        )
    )
write_tsv(OUT / "low_depth_catalytic_sites.tsv", sites)
print(
    "Audited",
    len(hits),
    "low-depth assembly matches without exporting sample sequences",
)
