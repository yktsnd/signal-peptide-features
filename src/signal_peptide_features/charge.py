"""Simple sequence charge descriptors."""

from __future__ import annotations

from .regions import normalize_sequence

POSITIVE = frozenset("KR")
NEGATIVE = frozenset("DE")


def charge_features(sequence: str) -> dict[str, float]:
    normalized = normalize_sequence(sequence)
    positive = sum(residue in POSITIVE for residue in normalized)
    negative = sum(residue in NEGATIVE for residue in normalized)
    return {
        "positive_count": float(positive),
        "negative_count": float(negative),
        "positive_fraction": positive / len(normalized),
        "negative_fraction": negative / len(normalized),
        "net_charge_proxy": float(positive - negative),
        "charge_density": (positive - negative) / len(normalized),
    }
