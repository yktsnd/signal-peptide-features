"""Transparent helix-propensity proxies."""

from __future__ import annotations

from .composition import residue_fraction
from .regions import normalize_sequence

HELIX_PROPENSITY = {
    "A": 1.42,
    "C": 0.70,
    "D": 1.01,
    "E": 1.51,
    "F": 1.13,
    "G": 0.57,
    "H": 1.00,
    "I": 1.08,
    "K": 1.16,
    "L": 1.21,
    "M": 1.45,
    "N": 0.67,
    "P": 0.57,
    "Q": 1.11,
    "R": 0.98,
    "S": 0.77,
    "T": 0.83,
    "V": 1.06,
    "W": 1.08,
    "Y": 0.69,
}


def mean_helix_propensity(sequence: str) -> float:
    normalized = normalize_sequence(sequence)
    return sum(HELIX_PROPENSITY[residue] for residue in normalized) / len(normalized)


def helix_breaker_fraction(sequence: str) -> float:
    return residue_fraction(sequence, "PG")
