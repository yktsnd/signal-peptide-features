"""Kyte–Doolittle hydrophobicity and local-window descriptors."""

from __future__ import annotations

import math
from collections.abc import Iterable

import numpy as np

from .regions import normalize_sequence

KYTE_DOOLITTLE = {
    "A": 1.8,
    "C": 2.5,
    "D": -3.5,
    "E": -3.5,
    "F": 2.8,
    "G": -0.4,
    "H": -3.2,
    "I": 4.5,
    "K": -3.9,
    "L": 3.8,
    "M": 1.9,
    "N": -3.5,
    "P": -1.6,
    "Q": -3.5,
    "R": -4.5,
    "S": -0.8,
    "T": -0.7,
    "V": 4.2,
    "W": -0.9,
    "Y": -1.3,
}


def values(sequence: str) -> np.ndarray:
    normalized = normalize_sequence(sequence)
    return np.asarray([KYTE_DOOLITTLE[residue] for residue in normalized], dtype=np.float64)


def mean_hydrophobicity(sequence: str) -> float:
    return float(values(sequence).mean())


def window_means(sequence: str, widths: Iterable[int] = (5,)) -> dict[str, float]:
    normalized = normalize_sequence(sequence)
    result: dict[str, float] = {}
    for requested_width in widths:
        if not isinstance(requested_width, int) or requested_width <= 0:
            raise ValueError("window widths must be positive integers")
        width = min(requested_width, len(normalized))
        result[f"window_{requested_width}_max"] = max(
            mean_hydrophobicity(normalized[index : index + width])
            for index in range(len(normalized) - width + 1)
        )
    return result


def hydrophobic_moment(sequence: str, *, residues_per_turn: float = 3.6) -> float:
    normalized = normalize_sequence(sequence)
    if residues_per_turn <= 0.0 or not math.isfinite(residues_per_turn):
        raise ValueError("residues_per_turn must be positive and finite")
    angles = 2.0 * np.pi * np.arange(len(normalized)) / residues_per_turn
    hydro = values(normalized)
    return float(
        np.hypot(np.sum(hydro * np.cos(angles)), np.sum(hydro * np.sin(angles))) / len(normalized)
    )


def hydrophobicity_gradient(left: str, right: str) -> float:
    return mean_hydrophobicity(right) - mean_hydrophobicity(left)
