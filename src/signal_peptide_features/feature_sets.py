"""Stable, outcome-free SP feature presets."""

from __future__ import annotations

from .charge import charge_features
from .cleavage import cleavage_features
from .composition import (
    amino_acid_composition,
    pro_gly_fraction,
    residue_fraction,
    sequence_entropy,
)
from .helix import helix_breaker_fraction, mean_helix_propensity
from .hydrophobicity import hydrophobic_moment, mean_hydrophobicity, window_means
from .insertion import insertion_features
from .kidera import kidera_summary
from .regions import normalize_sequence, split_fractional_regions


def basic_sp_features(sequence: str) -> dict[str, float]:
    normalized = normalize_sequence(sequence)
    regions = split_fractional_regions(normalized)
    n_region = str(regions["n"])
    h_region = str(regions["h"])
    c_region = str(regions["c"])
    charge = charge_features(normalized)
    composition = amino_acid_composition(normalized)
    return {
        "sp_length": float(len(normalized)),
        "n_length": float(len(n_region)),
        "h_length": float(len(h_region)),
        "c_length": float(len(c_region)),
        "global_gravy": mean_hydrophobicity(normalized),
        "global_entropy": sequence_entropy(normalized),
        "global_net_charge": charge["net_charge_proxy"],
        "global_aromaticity": residue_fraction(normalized, "FWY"),
        "global_aliphatic_index": 100.0
        * (
            normalized.count("A")
            + 2.9 * normalized.count("V")
            + 3.9 * (normalized.count("I") + normalized.count("L"))
        )
        / len(normalized),
        "h_mean_hydrophobicity": mean_hydrophobicity(h_region),
        "n_positive_charge": float(sum(residue in "KR" for residue in n_region)),
        "c_polarity": residue_fraction(c_region, "STNQ"),
        "cleavage_small_neutral": float(normalized[-3] in "AGSC" and normalized[-1] in "AGSC"),
        "pro_gly_fraction": pro_gly_fraction(normalized),
        **{f"aa_fraction_{residue}": value for residue, value in composition.items()},
    }


def interpretable_sp_features(sequence: str) -> dict[str, float | str]:
    normalized = normalize_sequence(sequence)
    regions = split_fractional_regions(normalized)
    n_region = str(regions["n"])
    h_region = str(regions["h"])
    c_region = str(regions["c"])
    n_charge = charge_features(n_region)
    c_charge = charge_features(c_region)
    h_mean = mean_hydrophobicity(h_region)
    c_mean = mean_hydrophobicity(c_region)
    result: dict[str, float | str] = {
        **basic_sp_features(normalized),
        "n_charge_density": n_charge["charge_density"],
        "n_acidic_count": n_charge["negative_count"],
        "n_hydrophobicity": mean_hydrophobicity(n_region),
        "h_max_local_hydrophobicity": window_means(h_region)["window_5_max"],
        "h_hydrophobic_moment": hydrophobic_moment(h_region),
        "h_helix_propensity": mean_helix_propensity(h_region),
        "h_helix_breaker_fraction": helix_breaker_fraction(h_region),
        "h_aromatic_fraction": residue_fraction(h_region, "FWY"),
        "h_aliphatic_fraction": residue_fraction(h_region, "AVIL"),
        "h_transmembrane_like_fraction": residue_fraction(h_region, "AILMFWVY"),
        "h_to_c_hydrophobicity_drop": h_mean - c_mean,
        "n_to_h_hydrophobicity_rise": h_mean - mean_hydrophobicity(n_region),
        "c_charge": c_charge["net_charge_proxy"],
        "c_mean_hydrophobicity": c_mean,
        "c_polarity": residue_fraction(c_region, "STNQ"),
        "minus_three_residue": normalized[-3],
        "minus_one_residue": normalized[-1],
        **cleavage_features(normalized),
        **insertion_features(h_region),
        **kidera_summary(normalized),
    }
    return result
