"""Composition and complexity descriptors."""

from __future__ import annotations

import math
from collections.abc import Mapping

from .regions import AMINO_ACIDS, normalize_sequence


def amino_acid_composition(sequence: str) -> Mapping[str, float]:
    normalized = normalize_sequence(sequence)
    return {residue: normalized.count(residue) / len(normalized) for residue in sorted(AMINO_ACIDS)}


def residue_fraction(sequence: str, residues: str | set[str] | frozenset[str]) -> float:
    normalized = normalize_sequence(sequence)
    selected = set(residues)
    return sum(residue in selected for residue in normalized) / len(normalized)


def sequence_entropy(sequence: str) -> float:
    composition = amino_acid_composition(sequence)
    return float(-sum(p * math.log2(p) for p in composition.values() if p > 0.0))


def pro_gly_fraction(sequence: str) -> float:
    return residue_fraction(sequence, "PG")
