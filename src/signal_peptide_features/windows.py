"""Reusable deterministic sliding-window summaries."""

from __future__ import annotations

from collections.abc import Callable

from .regions import normalize_sequence


def window_values(sequence: str, width: int, function: Callable[[str], float]) -> list[float]:
    normalized = normalize_sequence(sequence)
    if not isinstance(width, int) or width <= 0:
        raise ValueError("width must be a positive integer")
    width = min(width, len(normalized))
    return [
        function(normalized[index : index + width]) for index in range(len(normalized) - width + 1)
    ]


def window_summary(sequence: str, width: int, function: Callable[[str], float]) -> dict[str, float]:
    values = window_values(sequence, width, function)
    return {"mean": sum(values) / len(values), "min": min(values), "max": max(values)}
