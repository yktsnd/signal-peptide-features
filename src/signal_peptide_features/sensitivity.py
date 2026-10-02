"""Descriptive boundary sensitivity and paired single-substitution effects.

These are exact enumerations of user-supplied annotation alternatives, not
confidence intervals, experimental validation, or a secretion-design model.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from .feature_sets import interpretable_sp_features
from .regions import AMINO_ACIDS, normalize_sequence


@dataclass(frozen=True)
class RegionAnnotation:
    """Contiguous N/H/C boundaries in zero-based, end-exclusive coordinates."""

    annotation_id: str
    n_end: int
    h_end: int
    source: str

    def __post_init__(self) -> None:
        if not self.annotation_id.strip() or not self.source.strip():
            raise ValueError("annotation_id and source must be non-empty")
        if type(self.n_end) is not int or type(self.h_end) is not int:
            raise ValueError("annotation boundaries must be integers")
        if not 0 < self.n_end < self.h_end:
            raise ValueError("annotation must satisfy 0 < n_end < h_end < sequence length")

    @property
    def boundaries(self) -> tuple[int, int]:
        return self.n_end, self.h_end


def _evaluate(sequence: str, annotations: Iterable[RegionAnnotation]):
    alternatives = tuple(annotations)
    if not alternatives:
        raise ValueError("at least one explicit region annotation is required")
    ids = [annotation.annotation_id for annotation in alternatives]
    if len(set(ids)) != len(ids):
        raise ValueError("annotation IDs must be unique within each sequence")
    features = [
        interpretable_sp_features(sequence, boundaries=annotation.boundaries)
        for annotation in alternatives
    ]
    return alternatives, features


def boundary_sensitivity(
    sequence: str, annotations: Iterable[RegionAnnotation]
) -> dict[str, dict[str, float]]:
    """Return min, max and span of each numeric feature over supplied annotations.

    All supplied annotations are evaluated equally; no probability distribution
    is assigned to them. Annotation choice must be made independently of outcomes.
    """
    normalized = normalize_sequence(sequence)
    _, values = _evaluate(normalized, annotations)
    result = {}
    for name, value in values[0].items():
        if isinstance(value, (int, float)):
            candidates = [float(features[name]) for features in values]
            result[name] = {
                "min": min(candidates),
                "max": max(candidates),
                "span": max(candidates) - min(candidates),
            }
    return result


def mutation_effects(
    sequence: str,
    annotations: Iterable[RegionAnnotation],
    *,
    positions: Iterable[int] | None = None,
    alternatives: str = "ACDEFGHIKLMNPQRSTVWY",
) -> Iterator[dict[str, float | str | int]]:
    """Enumerate candidate-minus-original feature deltas at matched boundaries.

    Positions are one-based; omit them to scan every residue. Each substitution
    is paired with the original at each supplied annotation BEFORE taking extrema.
    Direction describes descriptor changes only. A positive effect is not an
    improvement in secretion. Runtime scales with positions × substitutions ×
    annotations × descriptor calculation cost. Numeric features alone are emitted.
    """
    normalized = normalize_sequence(sequence)
    annotations, baseline = _evaluate(normalized, annotations)
    requested = tuple(range(1, len(normalized) + 1) if positions is None else positions)
    if not requested or any(type(p) is not int or not 1 <= p <= len(normalized) for p in requested):
        raise ValueError("positions must be non-empty one-based integers inside the sequence")
    if len(set(requested)) != len(requested):
        raise ValueError("positions must be unique")
    if not alternatives or len(set(alternatives)) != len(alternatives):
        raise ValueError("alternative residues must be non-empty and unique")
    if set(alternatives) - AMINO_ACIDS:
        raise ValueError("alternative residues must be uppercase canonical amino acids")
    for position in requested:
        original = normalized[position - 1]
        for residue in alternatives:
            if residue == original:
                continue
            mutant = normalized[: position - 1] + residue + normalized[position:]
            mutated = [
                interpretable_sp_features(mutant, boundaries=annotation.boundaries)
                for annotation in annotations
            ]
            for name, value in baseline[0].items():
                if not isinstance(value, (int, float)):
                    continue
                deltas = [
                    float(after[name]) - float(before[name])
                    for before, after in zip(baseline, mutated, strict=True)
                ]
                low, high = min(deltas), max(deltas)
                if low > 0:
                    direction = "increase_all"
                elif high < 0:
                    direction = "decrease_all"
                elif low == high == 0:
                    direction = "unchanged_all"
                else:
                    direction = "annotation_dependent"
                yield {
                    "position": position,
                    "original": original,
                    "alternative": residue,
                    "feature": name,
                    "delta_min": low,
                    "delta_max": high,
                    "direction": direction,
                    "delta_min_annotation": ";".join(
                        annotation.annotation_id
                        for annotation, delta in zip(annotations, deltas, strict=True)
                        if delta == low
                    ),
                    "delta_max_annotation": ";".join(
                        annotation.annotation_id
                        for annotation, delta in zip(annotations, deltas, strict=True)
                        if delta == high
                    ),
                    "annotation_count": len(annotations),
                }
