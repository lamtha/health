"""Stream full FASTQs and reject unequal, reordered or malformed paired reads."""
import argparse
import gzip
import hashlib
import itertools
import json
from pathlib import Path


def records(path):
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt") as f:
        while True:
            h = f.readline()
            if not h:
                return
            sequence, plus, quality = f.readline(), f.readline(), f.readline()
            if (
                not h.startswith("@")
                or not plus.startswith("+")
                or not sequence
                or not quality
                or len(sequence.rstrip()) != len(quality.rstrip())
            ):
                raise ValueError("Malformed FASTQ record")
            name = h[1:].split()[0]
            yield name[:-2] if name.endswith(("/1", "/2")) else name


def validate_pairs(first, second):
    count = 0
    digest = hashlib.sha256()
    for a, b in itertools.zip_longest(records(first), records(second)):
        if a is None or b is None or a != b:
            raise ValueError(f"Mate identifiers/counts differ at pair {count + 1}")
        digest.update(a.encode() + b"\n")
        count += 1
    if not count:
        raise ValueError("Empty paired FASTQs")
    return dict(
        status="passed",
        paired_records=count,
        ordered_pair_id_sha256=digest.hexdigest(),
        check="every paired record; no identifiers exported",
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("first")
    p.add_argument("second")
    p.add_argument("--output", required=True)
    args = p.parse_args()
    Path(args.output).write_text(
        json.dumps(validate_pairs(args.first, args.second), indent=2) + "\n"
    )
