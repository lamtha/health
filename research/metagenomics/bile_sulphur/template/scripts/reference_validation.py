"""Conservative public-reference coding-sequence validation; no data I/O."""
from Bio.Seq import Seq


def validate_full_orf(dna, reference_protein, minimum_identity=0.99):
    dna = str(dna).upper()
    reference = str(reference_protein).rstrip("*")
    if not dna or set(dna) - set("ACGT") or len(dna) % 3:
        return None
    if dna[:3] not in {"ATG", "GTG", "TTG"} or dna[-3:] not in {"TAA", "TAG", "TGA"}:
        return None
    protein = str(Seq(dna).translate(table=11))[:-1]
    if "*" in protein or len(protein) != len(reference) or not reference:
        return None
    # Bacterial alternative initiator codons still introduce methionine.
    protein = "M" + protein[1:]
    identity = sum(a == b for a, b in zip(protein, reference)) / len(reference)
    return (protein, identity) if identity >= minimum_identity else None
