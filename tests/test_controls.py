from __future__ import annotations

from collections import Counter

import pytest

from signal_peptide_features import (
    RegionAnnotation,
    Substitution,
    composition_controls,
    interaction_effects,
    residue_profiles,
)
from signal_peptide_features.cli import main

ANNOTATIONS = [RegionAnnotation("a", 2, 6, "synthetic test")]


def test_profiles_reconstruct_hydropathy_and_coordinates():
    rows = list(residue_profiles("MKALLLSAAA", ANNOTATIONS))
    assert [row["position"] for row in rows] == list(range(1, 11))
    h = [row for row in rows if row["region"] == "h"]
    assert "".join(row["residue"] for row in h) == "ALLL"
    assert sum(row["kyte_doolittle"] for row in h) / len(h) == pytest.approx(3.3)


def test_seeded_controls_preserve_composition_and_global_composition_features():
    sequence = "MKALLLSAAA"
    rows = list(composition_controls(sequence, ANNOTATIONS, samples=4, seed=17))
    assert rows == list(composition_controls(sequence, ANNOTATIONS, samples=4, seed=17))
    assert len({row["sample"] for row in rows}) == 4
    for row in rows:
        assert Counter(row["shuffled_sequence"]) == Counter(sequence)
        if row["feature"].startswith(("global_", "aa_fraction_", "kidera_", "pro_gly_")):
            assert row["delta"] == pytest.approx(0, abs=1e-12)
    assert any(row["delta"] != 0 for row in rows if row["feature"] == "h_mean_hydrophobicity")


def test_shuffle_duplicates_and_unchanged_controls_are_visible():
    rows = list(
        composition_controls("AAA", [RegionAnnotation("a", 1, 2, "test")], samples=2, seed=1)
    )
    assert all(row["same_as_original"] == 1 for row in rows)
    assert all(row["duplicate_sample"] == (row["sample"] == 2) for row in rows)


@pytest.mark.parametrize("samples,seed", [(0, 1), (True, 1), (1, None), (1, 1.5)])
def test_control_sampling_arguments_are_explicit(samples, seed):
    with pytest.raises(ValueError):
        list(composition_controls("MKALLLSAAA", ANNOTATIONS, samples=samples, seed=seed))


def test_double_mutant_cycles_have_analytic_additive_and_nonlinear_cases():
    annotations = [RegionAnnotation("a", 1, 2, "test")]
    # In AKA, -3/-1 joint AGSC indicator is 1. A1L and A3L each remove it;
    # their double mutant still has 0: 0 - 0 - 0 + 1 = +1.
    pair = (Substitution(1, "L"), Substitution(3, "L"))
    rows = list(interaction_effects("AKA", annotations, [pair]))
    cleavage = next(row for row in rows if row["feature"] == "cleavage_small_neutral")
    assert cleavage["delta_a"] == -1
    assert cleavage["delta_b"] == -1
    assert cleavage["delta_ab"] == -1
    assert cleavage["interaction"] == 1
    gravy = next(row for row in rows if row["feature"] == "global_gravy")
    assert gravy["interaction"] == pytest.approx(0, abs=1e-12)
    reversed_pair = list(interaction_effects("AKA", annotations, [pair[::-1]]))
    assert [r["interaction"] for r in reversed_pair] == [r["interaction"] for r in rows]


@pytest.mark.parametrize(
    "pairs",
    [
        [],
        [(Substitution(1, "L"), Substitution(1, "K"))],
        [(Substitution(1, "A"), Substitution(3, "L"))],
        [(Substitution(1, "L"), Substitution(4, "L"))],
        [(Substitution(1, "L"), Substitution(3, "L"))] * 2,
    ],
)
def test_invalid_double_mutant_cycles_are_rejected(pairs):
    with pytest.raises(ValueError):
        list(interaction_effects("AKA", [RegionAnnotation("a", 1, 2, "test")], pairs))


@pytest.mark.parametrize(
    "mode",
    [
        ["--residue-profiles"],
        ["--order-controls", "2", "--seed", "17"],
        ["--interaction-pairs", "PAIRS"],
    ],
)
def test_cli_control_modes_roundtrip(tmp_path, mode):
    source = tmp_path / "seq.fa"
    regions = tmp_path / "regions.csv"
    pairs = tmp_path / "pairs.csv"
    output = tmp_path / "out.csv"
    source.write_text(">seq\nAKA\n")
    regions.write_text("sequence_id,annotation_id,n_end,h_end,source\nseq,a,1,2,test\n")
    pairs.write_text("sequence_id,position_a,residue_a,position_b,residue_b\nseq,1,L,3,L\n")
    args = [str(pairs) if item == "PAIRS" else item for item in mode]
    assert main([str(source), "--regions", str(regions), "-o", str(output), *args]) == 0
    assert len(output.read_text().splitlines()) > 1
