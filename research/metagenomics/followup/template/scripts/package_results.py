"""Make a private small-results archive using an explicit aggregate-file allowlist."""
import csv
import hashlib
import json
from pathlib import Path
import re
import zipfile
from Bio import SeqIO
from common import OUT, write_tsv, SCHEMAS


def package():
    for name in ("summary.md", "methods.md"):
        if "REVIEW_PENDING" in (OUT / name).read_text():
            raise ValueError("Scientific review still pending")
    validation = json.loads((OUT / "versions/output_validation.json").read_text())
    if validation.get("status") != "passed":
        raise ValueError("Run output validation first")
    private = {
        "accepted_alignment_intervals.tsv",
        "base_evidence.tsv",
        "tpa_genome_mapping_per_base.tsv",
        "paired_gene_fragments_private.tsv",
        "translated_target_reads_private.tsv",
    }
    root_tables = set(SCHEMAS) - private | {
        "gene_hits.tsv",
        "control_manifest.tsv",
        "control_gene_abundances.tsv",
        "control_gene_comparison.tsv",
        "comparison_qc_summary.tsv",
        "control_coverage_profiles.tsv",
        "control_depth_sensitivity.tsv",
    }
    root_json = {
        "tpa_coverage_null.json",
        "coding_disruption_audit.json",
        "fragment_geometry.json",
        "assembly_summary.json",
        "bilophila_recruitment.json",
        "control_comparison_complete.json",
    }
    references = {
        "bt_bsh_additions.fna",
        "bt_bsh_additions.faa",
        "bt_bsh_manifest.tsv",
        "tool_sources.json",
        "panel_v2.fna",
        "panel_v2.faa",
        "reference_manifest_v2.tsv",
        "BwBSH_mafft.faa",
    }
    # Only accession-pinned reference sequences may enter the archive.
    for stem, manifest in [
        ("bt_bsh_additions", "bt_bsh_manifest.tsv"),
        ("panel_v2", "reference_manifest_v2.tsv"),
    ]:
        path = OUT / "references" / f"{stem}.fna"
        if not path.exists():
            continue
        rows = {
            r["mapping_reference_id"]: r
            for r in csv.DictReader((path.parent / manifest).open(), delimiter="\t")
        }
        dna = {r.id: str(r.seq) for r in SeqIO.parse(path, "fasta")}
        if set(dna) != set(rows) or any(
            hashlib.sha256(s.encode()).hexdigest() != rows[r]["reference_nt_sha256"]
            for r, s in dna.items()
        ):
            raise ValueError("Unverified public reference sequence")
        from Bio.Seq import Seq

        proteins = {
            r.id: str(r.seq) for r in SeqIO.parse(path.with_suffix(".faa"), "fasta")
        }
        if set(proteins) != set(dna) or any(
            str(Seq(s).translate()).rstrip("*")[1:] != proteins[r][1:]
            for r, s in dna.items()
        ):
            raise ValueError("Public reference protein differs from translation")
    alignment = OUT / "references/BwBSH_mafft.faa"
    if alignment.exists():
        proteins = {
            r.id: str(r.seq)
            for r in SeqIO.parse(OUT / "references/panel_v2.faa", "fasta")
        }
        for row in SeqIO.parse(alignment, "fasta"):
            if str(row.seq).replace("-", "") != proteins[row.id]:
                raise ValueError("Alignment is not the public protein")
    files = []
    for path in sorted(OUT.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(OUT)
        allowed = (
            (
                path.parent == OUT
                and path.name in root_tables | root_json | {"summary.md", "methods.md"}
            )
            or (
                relative.parts[0] == "scripts"
                and path.suffix in {".py", ".sh", ".patch", ".json"}
            )
            or (relative.parts[0] == "references" and path.name in references)
            or (
                relative.parts[0] == "versions"
                and path.suffix in {".json", ".txt", ".sha256"}
            )
            or (
                relative.parts[0] == "figures"
                and path.stem
                in {
                    "BwBSH2_catalytic_coverage",
                    "tpa_coverage",
                    "control_gene_comparison",
                    "tpa_control_coverage",
                }
                and path.suffix in {".png", ".pdf"}
            )
        )
        if not allowed:
            continue
        if path.is_symlink() or path.stat().st_size >= 10_000_000:
            raise ValueError("Unexpected symlink or large result")
        if path.suffix == ".tsv":
            header = path.read_text().splitlines()[0].split("\t")
            if any(
                field in header
                for field in (
                    "fragment_local_id",
                    "qseqid",
                    "query_sequence",
                    "consensus_base",
                    "reference_position_1based",
                    "position_1based",
                )
            ):
                raise ValueError("Private per-read/base fields cannot be packaged")
        files.append(path)
    write_tsv(
        OUT / "FILE_MANIFEST.tsv",
        [
            dict(
                path=str(p.relative_to(OUT)),
                bytes=p.stat().st_size,
                sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
            )
            for p in files
        ],
    )
    files.append(OUT / "FILE_MANIFEST.tsv")
    archive = OUT.parent / "metagenomics_followup_results.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for path in files:
            z.write(path, "followup/" + str(path.relative_to(OUT)))
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError("Archive CRC failure")
    print("Private result ZIP:", archive, "(not anonymized; do not commit or upload)")


if __name__ == "__main__":
    package()
