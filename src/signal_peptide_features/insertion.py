"""Hessa/Sec61 membrane-transfer sequence proxy."""

from __future__ import annotations

from .regions import normalize_sequence

# Hessa et al. (2007), DOI:10.1038/nature06502. Lower values indicate lower
# transfer free energy; insertion_score exposes the negated mean for convenience.
HESSA_SEC61 = {
    "A": 0.11,
    "C": -0.13,
    "D": 3.49,
    "E": 2.68,
    "F": -0.32,
    "G": 0.74,
    "H": 2.06,
    "I": -0.60,
    "K": 2.71,
    "L": -0.55,
    "M": -0.10,
    "N": 2.05,
    "P": 2.23,
    "Q": 2.06,
    "R": 2.58,
    "S": 0.84,
    "T": 0.52,
    "V": -0.52,
    "W": -0.32,
    "Y": 0.11,
}


def insertion_features(sequence: str) -> dict[str, float]:
    normalized = normalize_sequence(sequence)
    mean_dg = sum(HESSA_SEC61[residue] for residue in normalized) / len(normalized)
    return {"mean_hessa_sec61_dg": mean_dg, "insertion_score": -mean_dg}
