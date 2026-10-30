"""Validate single-copy markers and expand protein-supported target allele groups.
Selection uses public reference genomes only, never sample read abundance.
"""
from bile_sulphur_config import ROOT, CONFIG
import csv, json, collections, hashlib
from pathlib import Path
from Bio import SeqIO
from Bio.Seq import Seq
from Bio import Align
from Bio.Align import substitution_matrices

R = Path("analysis/bile_sulphur/references")
O = Path("results/bile_sulphur/references")


def table(path, rows):
    with Path(path).open("w") as f:
        w = csv.DictWriter(f, rows[0], delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def blast(path):
    for line in open(path):
        v = line.rstrip().split("\t")
        yield dict(
            q=v[0],
            s=v[1],
            identity=float(v[2]),
            length=int(v[3]),
            qlen=int(v[4]),
            slen=int(v[5]),
            qs=int(v[6]),
            qe=int(v[7]),
            ss=int(v[8]),
            se=int(v[9]),
            evalue=float(v[10]),
            bits=float(v[11]),
            qcov=(int(v[7]) - int(v[6]) + 1) / int(v[4]),
            scov=abs(int(v[9]) - int(v[8]) + 1) / int(v[5]),
        )


meta = json.load(open(R / "candidate_markers.json"))
cm = json.load(open(R / "contig_metadata.json"))
cdm = json.load(open(R / "cds_metadata.json"))
genomes = SeqIO.to_dict(SeqIO.parse(R / "genomes.fna", "fasta"))
candidates = SeqIO.to_dict(SeqIO.parse(R / "candidate_markers.fna", "fasta"))
cds = SeqIO.to_dict(SeqIO.parse(R / "cds.fna", "fasta"))
grows = list(csv.DictReader(open(O / "genome_panel.tsv"), delimiter="\t"))
hits = collections.defaultdict(list)
for h in blast(R / "marker_genome_blast.tsv"):
    hits[h["q"]].append(h)
validated = []
selected = []
validation = []
for sgb, species, anchor in [
    ("t__SGB15452", "bilophila", "GCF_050780155.1"),
    ("t__SGB1861", "bt", "GCF_000011065.1"),
]:
    acs = {r["accession"] for r in grows if r["group"] == species}
    passed = []
    for q, v in meta.items():
        if v["clade"] != sgb:
            continue
        hs = hits[q]
        on = [
            h
            for h in hs
            if cm[h["s"]]["accession"] in acs
            and h["identity"] >= 85
            and h["qcov"] >= 0.98
        ]
        off = [
            h
            for h in hs
            if cm[h["s"]]["accession"] not in acs
            and h["identity"] >= 90
            and h["length"] >= 80
        ]
        # Secondary substantial hits outside the best locus reject candidate markers.
        extra = []
        for h in hs:
            if (
                cm[h["s"]]["accession"] not in acs
                or h["identity"] < 80
                or h["qcov"] < 0.5
            ):
                continue
            matches = [
                x
                for x in on
                if x["s"] == h["s"]
                and max(min(x["ss"], x["se"]), min(h["ss"], h["se"]))
                <= min(max(x["ss"], x["se"]), max(h["ss"], h["se"]))
            ]
            if not matches:
                extra.append(h)
        passed_flag = (
            not v["ext"]
            and v["len"] >= 600
            and len(on) == len(acs)
            and {cm[h["s"]]["accession"] for h in on} == acs
            and not off
            and not extra
        )
        validation.append(
            dict(
                marker=q,
                species=species,
                sgb=sgb,
                length=v["len"],
                external_clades=";".join(v["ext"]),
                single_copy_full_hits=len(on),
                required_genomes=len(acs),
                off_species_read_length_hits=len(off),
                additional_loci=len(extra),
                passed_validation=passed_flag,
                selected=False,
            )
        )
        if passed_flag:
            ah = next(h for h in on if cm[h["s"]]["accession"] == anchor)
            passed.append((q, on, ah))
    # At least 5 kb between centers on the anchor chromosome, up to 100 loci.
    taken = []
    for q, on, ah in sorted(passed, key=lambda x: (-meta[x[0]]["len"], x[0])):
        center = (ah["ss"] + ah["se"]) / 2
        if any(ah["s"] == s and abs(center - c) < 5000 for s, c in taken):
            continue
        taken.append((ah["s"], center))
        selected.append((q, species, sgb, on))
        validated.append(q)
        if len(taken) == 100:
            break
    for row in validation:
        if row["marker"] in validated:
            row["selected"] = True
    print(species, len(passed), "pass", len(taken), "selected", flush=True)
table(O / "marker_validation.tsv", validation)
records = []
provenance = []
used = {}


def add(seq, group, kind, species, source, details):
    seq = str(seq).upper()
    key = (group, seq)
    if key in used:
        rid = used[key]
    else:
        rid = f"ref{len(records)+1:05d}"
        used[key] = rid
        records.append(
            dict(
                reference_id=rid,
                group=group,
                kind=kind,
                species=species,
                length=len(seq),
                sha256=hashlib.sha256(seq.encode()).hexdigest(),
                sequence=seq,
            )
        )
    provenance.append(
        dict(
            reference_id=rid,
            group=group,
            kind=kind,
            species=species,
            source=source,
            details=json.dumps(details, sort_keys=True),
        )
    )


for q, species, sgb, on in selected:
    add(candidates[q].seq, q, "marker", species, "MetaPhlAn_Jun23_202403", meta[q])
    for h in on:
        lo = min(h["ss"], h["se"]) - 1
        hi = max(h["ss"], h["se"])
        reverse = h["ss"] > h["se"]
        left = (h["qlen"] - h["qe"]) if reverse else h["qs"] - 1
        right = (h["qs"] - 1) if reverse else h["qlen"] - h["qe"]
        lo -= left
        hi += right
        if lo < 0 or hi > len(genomes[h["s"]]):
            continue
        seq = genomes[h["s"]].seq[lo:hi]
        if reverse:
            seq = seq.reverse_complement()
        add(
            seq,
            q,
            "marker",
            species,
            h["s"],
            dict(blast=h, extract_start=lo, extract_end=hi, reverse=reverse),
        )
manifest = list(
    csv.DictReader(
        open("results/bile_sulphur/references/curated_reference_manifest.tsv"),
        delimiter="\t",
    )
)
targets = {
    r["mapping_reference_id"]: r
    for r in manifest
    if any(
        s in r["reference_source_organism"].lower()
        for s in ["bilophila", "thetaiotaomicron"]
    )
}
base = SeqIO.to_dict(
    SeqIO.parse("analysis/bile_sulphur/references/curated_panel.fna", "fasta")
)
# All original mechanistic references remain competitors.
for r in manifest:
    q = r["mapping_reference_id"]
    sp = (
        ("bilophila" if "bilophila" in r["reference_source_organism"].lower() else "bt")
        if q in targets
        else "other"
    )
    add(
        base[q].seq,
        q,
        "target"
        if q in targets and r["reference_role"] != "competitive_decoy"
        else "decoy",
        sp,
        "curated_panel_v2",
        dict(protein_accession=r["protein_accession"], gene=r["gene"]),
    )
ph = collections.defaultdict(list)
for h in blast(R / "target_protein_blast.tsv"):
    ph[h["s"]].append(h)
proteins = SeqIO.to_dict(SeqIO.parse(R / "proteins.faa", "fasta"))
query_proteins = SeqIO.to_dict(SeqIO.parse(R / "target_proteins.faa", "fasta"))
metal_sites = {
    "WP_005025869_1": {
        110: "H",
        112: "H",
        373: "K",
        441: "H",
        474: "H",
        583: "D",
        196: "H",
    },
    "WP_016360761_1": {
        110: "H",
        112: "H",
        398: "K",
        460: "H",
        493: "H",
        593: "D",
        195: "H",
    },
}
aligner = Align.PairwiseAligner()
aligner.substitution_matrix = substitution_matrices.load("BLOSUM62")
aligner.open_gap_score = -10
aligner.extend_gap_score = -0.5
site_rows = []


def catalytic_check(q, sid):
    if q not in metal_sites:
        return "not_applicable"
    ref = str(query_proteins[q].seq)
    subject = str(proteins[sid].seq)
    aln = aligner.align(ref, subject)[0]
    mapping = {}
    for (qa, qb), (sa, sb) in zip(*aln.aligned):
        for pos in range(qa, qb):
            mapping[pos] = sa + pos - qa
    passed = True
    for position, expected in metal_sites[q].items():
        assert ref[position - 1] == expected
        sp = mapping.get(position - 1)
        observed = subject[sp] if sp is not None else "-"
        passed &= observed == expected
        site_rows.append(
            dict(
                target=q,
                source_cds=sid,
                reference_position=position,
                expected=expected,
                homolog_position=sp + 1 if sp is not None else "NA",
                observed=observed,
                conserved=observed == expected,
                scope="public homolog sequence; not patient residue coverage or enzyme validation",
            )
        )
    return "all_seven_conserved" if passed else "mismatch_or_gap"


homologs = []
for sid, hs in ph.items():
    hs = sorted(hs, key=lambda h: h["bits"], reverse=True)
    h = hs[0]
    q = h["q"]
    sp = (
        "bilophila"
        if "bilophila" in targets[q]["reference_source_organism"].lower()
        else "bt"
    )
    md = cdm[sid]
    competitor = max([x["bits"] for x in hs if x["q"] != q], default=0)
    site_status = (
        catalytic_check(q, sid)
        if h["identity"] >= 70 and h["qcov"] >= 0.9 and h["scov"] >= 0.9
        else "not_full_close_homolog"
    )
    eligible = (
        site_status != "mismatch_or_gap"
        and targets[q]["reference_role"] != "competitive_decoy"
        and md["group"] == sp
        and h["identity"] >= 70
        and h["qcov"] >= 0.9
        and h["scov"] >= 0.9
        and h["bits"] >= 1.1 * competitor
    )
    # Search includes all reference target paralogs, including GH73 context control.
    group = q if eligible else "decoy_" + sid
    kind = "target" if eligible else "decoy"
    add(
        cds[sid].seq,
        group,
        kind,
        sp if eligible else md["group"],
        sid,
        dict(metadata=md, blast=h, second_query_bits=competitor),
    )
    homologs.append(
        dict(
            cds_id=sid,
            target=q,
            species=md["group"],
            source=md["source"],
            accession=md["accession"],
            protein_id=md["protein_id"],
            identity_pct=h["identity"],
            query_coverage=h["qcov"],
            subject_coverage=h["scov"],
            bits=h["bits"],
            next_target_bits=competitor,
            retained_target_homolog=eligible,
            catalytic_site_status=site_status,
        )
    )
table(O / "target_homolog_validation.tsv", homologs)
if site_rows:
    table(O / "metalloBSH_public_homolog_sites.tsv", site_rows)
with (R / "mapping_panel.fna").open("w") as f:
    for r in records:
        f.write(f">{r['reference_id']}\n{r['sequence']}\n")
table(
    O / "mapping_panel_manifest.tsv",
    [{k: v for k, v in r.items() if k != "sequence"} for r in records],
)
table(O / "reference_provenance.tsv", provenance)
json.dump(
    dict(
        marker_min_identity=85,
        marker_min_coverage=0.98,
        marker_min_length=600,
        marker_max_count=100,
        marker_min_spacing=5000,
        off_species_min_identity=90,
        off_species_min_aligned_nt=80,
        homolog_min_aa_identity=70,
        homolog_min_bidirectional_coverage=0.9,
        homolog_min_best_target_score_ratio=1.1,
    ),
    open(O / "selection_parameters.json", "w"),
    indent=2,
)
print(
    "panel",
    len(records),
    "records",
    sum(len(r["sequence"]) for r in records),
    "nt",
    collections.Counter(r["kind"] for r in records),
    flush=True,
)
