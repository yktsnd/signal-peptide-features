"""Composition controls, residue profiles and descriptor double-mutant cycles.

All effects describe mathematical descriptors. Biological epistasis, secretion
performance, structural propensities and inferential p-values are not estimated.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from .feature_sets import interpretable_sp_features
from .helix import HELIX_PROPENSITY
from .hydrophobicity import KYTE_DOOLITTLE
from .insertion import HESSA_SEC61
from .regions import AMINO_ACIDS, normalize_sequence
from .sensitivity import RegionAnnotation, _evaluate


def residue_profiles(
    sequence: str, annotations: Iterable[RegionAnnotation]
) -> Iterator[dict[str, float | str | int]]:
    """Expose per-residue values and annotation membership without smoothing."""
    normalized = normalize_sequence(sequence)
    annotations, _ = _evaluate(normalized, annotations)
    for annotation in annotations:
        for index, residue in enumerate(normalized):
            region = "n" if index < annotation.n_end else "h" if index < annotation.h_end else "c"
            yield {
                "annotation_id": annotation.annotation_id,
                "annotation_source": annotation.source,
                "position": index + 1,
                "residue": residue,
                "region": region,
                "kyte_doolittle": KYTE_DOOLITTLE[residue],
                "hessa_sec61_residue": HESSA_SEC61[residue],
                "helix_propensity": HELIX_PROPENSITY[residue],
                "charge_proxy": int(residue in "KR") - int(residue in "DE"),
            }


def composition_controls(
    sequence: str,
    annotations: Iterable[RegionAnnotation],
    *,
    samples: int,
    seed: int,
) -> Iterator[dict[str, float | str | int]]:
    """Compare sampled composition-preserving permutations with the original.

    Fisher-Yates shuffles use a local Python RNG and retain original region
    coordinates. Sampling is with replacement; repeated or unchanged sequences
    are retained and marked. A shuffle need not be a plausible signal peptide.
    This control tests descriptor dependence on order, not biological specificity.
    """
    normalized = normalize_sequence(sequence)
    annotations, baseline = _evaluate(normalized, annotations)
    if type(samples) is not int or samples <= 0:
        raise ValueError("samples must be a positive integer")
    if type(seed) is not int:
        raise ValueError("seed must be an integer")
    generator = random.Random(seed)
    seen: set[str] = set()
    for sample in range(1, samples + 1):
        residues = list(normalized)
        generator.shuffle(residues)
        shuffled = "".join(residues)
        duplicate = shuffled in seen
        seen.add(shuffled)
        for annotation, original in zip(annotations, baseline, strict=True):
            control = interpretable_sp_features(shuffled, boundaries=annotation.boundaries)
            for name, value in original.items():
                if isinstance(value, (int, float)):
                    yield {
                        "sample": sample,
                        "seed": seed,
                        "shuffled_sequence": shuffled,
                        "same_as_original": int(shuffled == normalized),
                        "duplicate_sample": int(duplicate),
                        "annotation_id": annotation.annotation_id,
                        "annotation_source": annotation.source,
                        "feature": name,
                        "original_value": float(value),
                        "control_value": float(control[name]),
                        "delta": float(control[name]) - float(value),
                    }


@dataclass(frozen=True)
class Substitution:
    """One-based replacement position and uppercase canonical residue."""

    position: int
    residue: str

    def __post_init__(self) -> None:
        if type(self.position) is not int or self.position < 1:
            raise ValueError("substitution position must be a positive one-based integer")
        if self.residue not in AMINO_ACIDS:
            raise ValueError("substitution residue must be one uppercase canonical amino acid")


def interaction_effects(
    sequence: str,
    annotations: Iterable[RegionAnnotation],
    pairs: Iterable[tuple[Substitution, Substitution]],
) -> Iterator[dict[str, float | str | int]]:
    """Report f(AB)-f(A)-f(B)+f(WT) per annotation and numeric descriptor.

    Enumerate caller-selected pairs only, preventing an implicit quadratic search
    across all variants. Additive descriptors have zero interaction up to numeric
    roundoff. Nonzero values can arise from descriptor nonlinearity alone.
    """
    normalized = normalize_sequence(sequence)
    annotations, baseline = _evaluate(normalized, annotations)
    seen: set[tuple[tuple[int, str], ...]] = set()
    found = False
    for first, second in pairs:
        found = True
        if first.position == second.position:
            raise ValueError("double-mutant positions must differ")
        for substitution in (first, second):
            if substitution.position > len(normalized):
                raise ValueError("substitution lies outside the sequence")
            if normalized[substitution.position - 1] == substitution.residue:
                raise ValueError("substitution must change the original residue")
        key = tuple(sorted(((first.position, first.residue), (second.position, second.residue))))
        if key in seen:
            raise ValueError("duplicate substitution pair")
        seen.add(key)

        def replace(*substitutions: Substitution) -> str:
            residues = list(normalized)
            for substitution in substitutions:
                residues[substitution.position - 1] = substitution.residue
            return "".join(residues)

        for annotation, original in zip(annotations, baseline, strict=True):
            single_a = interpretable_sp_features(replace(first), boundaries=annotation.boundaries)
            single_b = interpretable_sp_features(replace(second), boundaries=annotation.boundaries)
            double = interpretable_sp_features(
                replace(first, second), boundaries=annotation.boundaries
            )
            for name, value in original.items():
                if not isinstance(value, (int, float)):
                    continue
                delta_a = float(single_a[name]) - float(value)
                delta_b = float(single_b[name]) - float(value)
                delta_ab = float(double[name]) - float(value)
                yield {
                    "position_a": first.position,
                    "original_a": normalized[first.position - 1],
                    "alternative_a": first.residue,
                    "position_b": second.position,
                    "original_b": normalized[second.position - 1],
                    "alternative_b": second.residue,
                    "annotation_id": annotation.annotation_id,
                    "annotation_source": annotation.source,
                    "feature": name,
                    "delta_a": delta_a,
                    "delta_b": delta_b,
                    "delta_ab": delta_ab,
                    "interaction": delta_ab - delta_a - delta_b,
                }
    if not found:
        raise ValueError("at least one substitution pair is required")
