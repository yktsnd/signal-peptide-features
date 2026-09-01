from __future__ import annotations

import numpy as np
import pytest

from signal_peptide_features import (
    interpretable_sp_features,
    mean_pool,
    split_fractional_regions,
)
from signal_peptide_features.cleavage import cleavage_features
from signal_peptide_features.feature_sets import basic_sp_features
from signal_peptide_features.hydrophobicity import mean_hydrophobicity
from signal_peptide_features.windows import window_summary


def test_canonical_migration_regression_snapshot() -> None:
    features = interpretable_sp_features("MKWVTFISLLFLFSSAYS")

    assert features["sp_length"] == 18.0
    assert features["n_length"] == 4.0
    assert features["h_length"] == 10.0
    assert features["c_length"] == 4.0
    assert features["n_positive_charge"] == 1.0
    assert features["cleavage_small_neutral"] == 1.0
    assert features["mean_hessa_sec61_dg"] == pytest.approx(-0.101, abs=0.001)


def test_short_sequence_and_explicit_regions() -> None:
    regions = split_fractional_regions("MKW")

    assert regions["n"] == "M"
    assert regions["h"] == "K"
    assert regions["c"] == "W"

    with pytest.raises(ValueError):
        split_fractional_regions("MK")


def test_invalid_and_empty_sequences_fail_closed() -> None:
    with pytest.raises(ValueError):
        basic_sp_features("")
    with pytest.raises(ValueError):
        basic_sp_features("ACDZ")


def test_deterministic_window_and_embedding_pooling() -> None:
    assert window_summary("AAAA", 2, mean_hydrophobicity) == {
        "mean": 1.8,
        "min": 1.8,
        "max": 1.8,
    }
    embedding = np.arange(12, dtype=float).reshape(4, 3)
    assert np.allclose(mean_pool(embedding), [4.5, 5.5, 6.5])
    assert np.allclose(mean_pool(embedding), mean_pool(embedding))


def test_cleavage_descriptors_are_not_predictor_labels() -> None:
    result = cleavage_features("MKKAAA")

    assert result["minus_three_residue"] == "A"
    assert result["minus_one_residue"] == "A"
    assert result["small_neutral_minus_three_minus_one"] == 1.0
