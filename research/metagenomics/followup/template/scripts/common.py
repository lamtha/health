"""Local-only helpers; identical strict read acceptance to the original panel."""
import csv, itertools, json
from pathlib import Path
import pysam
from followup_config import ROOT, CONFIG, SAMPLE

OUT = ROOT / "results/followup"
WORK = ROOT / "analysis/followup/work"
REF = ROOT / "analysis/followup/references"

SCHEMAS = json.loads(Path(__file__).with_name("output_schemas.json").read_text())


def write_tsv(path, rows, fields=None):
    rows = list(rows)
    with Path(path).open("w") as f:
        schema = fields or (list(rows[0]) if rows else SCHEMAS[Path(path).name])
        w = csv.DictWriter(
            f,
            fieldnames=schema,
            delimiter="\t",
            lineterminator="\n",
            extrasaction="ignore",
        )
        w.writeheader()
        w.writerows(rows)


def fragment(name):
    return name[:-2] if name.endswith(("/1", "/2")) else name


def classify(group):
    ordered = sorted(
        group,
        key=lambda a: a.get_tag("AS") if a.has_tag("AS") else -100000,
        reverse=True,
    )
    a = ordered[0]
    if a.is_unmapped or a.is_supplementary:
        return a, "unmapped", {}
    cols = sum(n for op, n in a.cigartuples if op in (0, 1, 2, 7, 8))
    span = sum(n for op, n in a.cigartuples if op in (0, 1, 7, 8))
    identity = 1 - a.get_tag("NM") / cols if cols else 0
    qcov = span / a.infer_read_length()
    other = [x.get_tag("AS") for x in ordered[1:] if x.has_tag("AS")]
    if a.has_tag("XS"):
        other.append(a.get_tag("XS"))
    gap = a.get_tag("AS") - max(other) if other else 100000
    metrics = dict(
        identity=identity, query_coverage=qcov, aligned_bases=span, score_gap=gap
    )
    if identity < 0.95 or qcov < 0.90 or span < 80:
        return a, "identity_length_coverage", metrics
    if gap < 10 or (a.mapping_quality != 255 and a.mapping_quality < 20):
        return a, "ambiguous_mapq", metrics
    return a, "accepted", metrics


def groups(path):
    with pysam.AlignmentFile(str(path), "rb") as bam:
        for name, group in itertools.groupby(
            bam.fetch(until_eof=True), key=lambda a: a.query_name
        ):
            yield classify(list(group))
