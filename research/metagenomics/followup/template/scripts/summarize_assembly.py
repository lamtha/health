"""Report local assembly evidence without filling missing sequence from references."""
import csv, itertools, json, collections
from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from common import OUT, WORK, REF, write_tsv

manifest = {
    r["mapping_reference_id"]: r
    for r in csv.DictReader((REF / "reference_manifest_v2.tsv").open(), delimiter="\t")
}
contigs = {
    r.id: r for r in SeqIO.parse(WORK / "megahit_native/final.contigs.fa", "fasta")
}
rows = []
wanted = set()
candidate = collections.defaultdict(list)
edge_candidates = collections.defaultdict(list)
recover = []
for kind, path in [
    ("nucleotide", WORK / "assembly_nucleotide_hits.tsv"),
    ("protein", WORK / "assembly_protein_hits.tsv"),
]:
    for line in path.open():
        c = line.rstrip().split("\t")
        ref, contig = c[:2]
        pid = float(c[2])
        length, qlen, slen, qs, qe, ss, se = map(int, c[3:10])
        e = float(c[10])
        score = float(c[11])
        gaps, mismatch = map(int, c[12:14])
        span = qe - qs + 1
        breadth = 100 * span / qlen
        if (kind == "nucleotide" and (pid < 90 or length < 100)) or (
            kind == "protein" and (pid < 80 or length < 35)
        ):
            continue
        strong_fragment = kind == "nucleotide" and pid >= 95 and span >= 300
        if strong_fragment:
            wanted.add(contig)
        complete = "no"
        stop_count = "NA"
        ntlen = "NA"
        if kind == "nucleotide" and pid >= 95 and qs == 1 and qe == qlen:
            dna = contigs[contig].seq[min(ss, se) - 1 : max(ss, se)]
            if ss > se:
                dna = dna.reverse_complement()
            ntlen = len(dna)
            prot = str(dna.translate()) if len(dna) % 3 == 0 else ""
            stop_count = prot[:-1].count("*") if prot else "NA"
            if (
                prot
                and prot.endswith("*")
                and "*" not in prot[:-1]
                and str(dna[:3]) in ["ATG", "GTG", "TTG"]
                and "N" not in str(dna)
            ):
                complete = "assembled_reference_compatible_ORF"
                recover.append(
                    SeqRecord(
                        dna,
                        id=ref + "__" + contig,
                        description="sample_assembled_candidate_NOT_expressed_or_active_protein",
                    )
                )
        row = dict(
            reference_id=ref,
            gene=manifest[ref]["gene"],
            reference_organism=manifest[ref]["reference_source_organism"],
            search=kind,
            contig=contig,
            contig_length=slen,
            identity_pct=pid,
            aligned_length=length,
            reference_length=qlen,
            query_start=qs,
            query_end=qe,
            query_coverage_pct=breadth,
            contig_start=min(ss, se),
            contig_end=max(ss, se),
            strand="+" if ss < se else "-",
            evalue=e,
            bitscore=score,
            gap_bases=gaps,
            mismatches=mismatch,
            strong_nucleotide_fragment=strong_fragment,
            full_ORF_candidate=complete,
            assembled_coding_nt_length=ntlen,
            internal_stop_codons=stop_count,
            evidence="assembly DNA/protein homology; read-back coverage and taxonomy evaluated separately; partial matches do not establish function",
        )
        rows.append(row)
        if strong_fragment:
            candidate[contig].append(row)
        if kind == "nucleotide" and pid >= 98 and span >= 100:
            edge_candidates[contig].append(row)
write_tsv(OUT / "assembly_gene_hits.tsv", rows)
SeqIO.write([contigs[c] for c in sorted(wanted)], WORK / "target_contigs.fna", "fasta")
SeqIO.write(recover, WORK / "recovered/assembled_candidate_ORFs.fna", "fasta")
SeqIO.write(
    [SeqRecord(r.seq.translate(), id=r.id, description=r.description) for r in recover],
    WORK / "recovered/assembled_candidate_ORFs.faa",
    "fasta",
)
links = []
for contig, hits in candidate.items():
    for a, b in itertools.combinations(hits, 2):
        if a["reference_id"] == b["reference_id"]:
            continue
        overlap = max(
            0,
            min(a["contig_end"], b["contig_end"])
            - max(a["contig_start"], b["contig_start"])
            + 1,
        )
        if overlap:
            continue  # Alternate homologous annotations of one region are not gene linkage.
        links.append(
            dict(
                contig=contig,
                contig_length=a["contig_length"],
                gene1=a["gene"],
                gene2=b["gene"],
                reference1=a["reference_id"],
                reference2=b["reference_id"],
                gene1_coverage_pct=a["query_coverage_pct"],
                gene2_coverage_pct=b["query_coverage_pct"],
                intervening_nt=max(a["contig_start"], b["contig_start"])
                - min(a["contig_end"], b["contig_end"])
                - 1,
                evidence="same assembled DNA contig; requires read-back validation; no whole-strain or pathway activity inference",
            )
        )
write_tsv(
    OUT / "assembly_gene_linkage.tsv",
    links,
    [
        "contig",
        "contig_length",
        "gene1",
        "gene2",
        "reference1",
        "reference2",
        "gene1_coverage_pct",
        "gene2_coverage_pct",
        "intervening_nt",
        "evidence",
    ],
)
edge_links = []
for contig, hits in edge_candidates.items():
    for a, b in itertools.combinations(hits, 2):
        if a["reference_id"] == b["reference_id"]:
            continue
        if max(
            0,
            min(a["contig_end"], b["contig_end"])
            - max(a["contig_start"], b["contig_start"])
            + 1,
        ):
            continue
        edge_links.append(
            dict(
                contig=contig,
                contig_length=a["contig_length"],
                gene1=a["gene"],
                gene2=b["gene"],
                reference1=a["reference_id"],
                reference2=b["reference_id"],
                gene1_aligned_nt=a["aligned_length"],
                gene2_aligned_nt=b["aligned_length"],
                gene1_coverage_pct=a["query_coverage_pct"],
                gene2_coverage_pct=b["query_coverage_pct"],
                gene1_start=a["contig_start"],
                gene1_end=a["contig_end"],
                gene2_start=b["contig_start"],
                gene2_end=b["contig_end"],
                intervening_nt=max(a["contig_start"], b["contig_start"])
                - min(a["contig_end"], b["contig_end"])
                - 1,
                evidence="exploratory short-edge link: >=98% identity and >=100 nt in each gene; partial regions only; verify local read-back and genomic context",
            )
        )
write_tsv(
    OUT / "assembly_short_fragment_linkage.tsv",
    edge_links,
    [
        "contig",
        "contig_length",
        "gene1",
        "gene2",
        "reference1",
        "reference2",
        "gene1_aligned_nt",
        "gene2_aligned_nt",
        "gene1_coverage_pct",
        "gene2_coverage_pct",
        "gene1_start",
        "gene1_end",
        "gene2_start",
        "gene2_end",
        "intervening_nt",
        "evidence",
    ],
)
lengths = sorted((len(r) for r in contigs.values()), reverse=True)
total = sum(lengths)
cum = 0
n50 = 0
for n in lengths:
    cum += n
    if cum >= total / 2:
        n50 = n
        break
summary = dict(
    contigs=len(lengths),
    total_bp=total,
    N50=n50,
    longest=max(lengths),
    target_contigs=len(wanted),
    full_ORF_candidates=len(recover),
    nonoverlapping_gene_links=len(links),
    exploratory_short_fragment_links=len(edge_links),
    assembler="MEGAHIT 1.2.9 native arm64 generic CPU path; source patch and validation logs retained",
)
(OUT / "assembly_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(summary)
