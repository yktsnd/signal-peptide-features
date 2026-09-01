"""Cleavage-proximal sequence descriptors, not cleavage predictions."""

from __future__ import annotations

from .composition import residue_fraction
from .regions import normalize_sequence

SMALL_NEUTRAL = frozenset("AGSC")
POLAR = frozenset("STNQ")


def cleavage_features(sequence: str) -> dict[str, float | str]:
    normalized = normalize_sequence(sequence)
    if len(normalized) < 3:
        raise ValueError("at least three residues are required for -3/-1 descriptors")
    minus_three = normalized[-3]
    minus_one = normalized[-1]
    return {
        "minus_three_residue": minus_three,
        "minus_one_residue": minus_one,
        "minus_three_small": float(minus_three in SMALL_NEUTRAL),
        "minus_one_small": float(minus_one in SMALL_NEUTRAL),
        "small_neutral_minus_three_minus_one": float(
            minus_three in SMALL_NEUTRAL and minus_one in SMALL_NEUTRAL
        ),
        "c_region_polarity": residue_fraction(normalized[-max(3, len(normalized) // 5) :], POLAR),
    }
