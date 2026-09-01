"""Sequence validation and explicit or heuristic region handling."""

from __future__ import annotations

from collections.abc import Mapping

AMINO_ACIDS = frozenset("ACDEFGHIKLMNPQRSTVWY")


def normalize_sequence(sequence: str) -> str:
    """Normalize whitespace and case, rejecting non-canonical residues."""

    if not isinstance(sequence, str):
        raise ValueError("sequence must be a string")
    normalized = "".join(sequence.split()).upper()
    if not normalized:
        raise ValueError("sequence must not be empty")
    invalid = sorted(set(normalized) - AMINO_ACIDS)
    if invalid:
        raise ValueError(f"sequence contains non-canonical residues: {invalid}")
    return normalized


def _check_bound(name: str, bound: tuple[int, int], length: int) -> None:
    if len(bound) != 2 or bound[0] < 0 or bound[1] <= bound[0] or bound[1] > length:
        raise ValueError(f"{name} must be a non-empty half-open interval inside the sequence")


def split_by_boundaries(
    sequence: str,
    *,
    n_region: tuple[int, int],
    h_region: tuple[int, int],
    c_region: tuple[int, int],
) -> Mapping[str, str | tuple[int, int]]:
    """Split a sequence using externally supplied half-open boundaries.

    Boundaries are coordinates, not cleavage predictions. Regions must be
    non-overlapping; unassigned residues between regions are allowed.
    """

    normalized = normalize_sequence(sequence)
    bounds = {"n": n_region, "h": h_region, "c": c_region}
    for name, bound in bounds.items():
        _check_bound(name, bound, len(normalized))
    ordered = sorted(bounds.items(), key=lambda item: item[1][0])
    if any(left[1][1] > right[1][0] for left, right in zip(ordered, ordered[1:], strict=False)):
        raise ValueError("regions must not overlap")
    return {
        "n": normalized[n_region[0] : n_region[1]],
        "h": normalized[h_region[0] : h_region[1]],
        "c": normalized[c_region[0] : c_region[1]],
        "n_bounds": n_region,
        "h_bounds": h_region,
        "c_bounds": c_region,
    }


def split_fractional_regions(
    sequence: str,
    *,
    n_fraction: float = 0.25,
    c_fraction: float = 0.20,
) -> Mapping[str, str | tuple[int, int]]:
    """Return deterministic heuristic N/H/C regions.

    The N and C regions are fractions of the sequence and the H region is the
    remaining middle. These are heuristic regions, not biological cleavage
    predictions.
    """

    normalized = normalize_sequence(sequence)
    if not 0.0 < n_fraction < 1.0 or not 0.0 < c_fraction < 1.0:
        raise ValueError("region fractions must be between zero and one")
    length = len(normalized)
    if length < 3:
        raise ValueError("sequence must contain at least three residues for N/H/C regions")
    n_length = max(1, round(length * n_fraction))
    c_length = max(1, round(length * c_fraction))
    while n_length + c_length > length - 1:
        if c_length > 1:
            c_length -= 1
        elif n_length > 1:
            n_length -= 1
        else:
            raise ValueError("sequence is too short for non-empty N/H/C regions")
    return split_by_boundaries(
        normalized,
        n_region=(0, n_length),
        h_region=(n_length, length - c_length),
        c_region=(length - c_length, length),
    )
