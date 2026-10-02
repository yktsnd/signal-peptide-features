from __future__ import annotations

import csv
import io
import math

import pytest

from signal_peptide_features import (
    RegionAnnotation,
    boundary_sensitivity,
    interpretable_sp_features,
    mutation_effects,
    read_fasta,
)
from signal_peptide_features.cli import main
from signal_peptide_features.composition import amino_acid_composition, sequence_entropy
from signal_peptide_features.hydrophobicity import hydrophobic_moment, mean_hydrophobicity
from signal_peptide_features.regions import split_by_boundaries


def test_fasta_normalization_and_descriptions():
    records = list(read_fasta(io.StringIO(">one a, b\nmk w\nvt\n\n>two\nAAA\n")))
    assert records[0].sequence == "MKWVT"
    assert records[0].description == "a, b"
    assert records[1].identifier == "two"


@pytest.mark.parametrize(
    "text", ["", "AAA", ">\nAAA", ">a\n", ">a\nAAA\n>a\nAAA", ">a\nAXA", ">a\nAA*", ">a\nAA-"]
)
def test_invalid_fasta_is_rejected(text):
    with pytest.raises(ValueError):
        list(read_fasta(io.StringIO(text)))


def test_explicit_regions_drive_all_c_region_features():
    features = interpretable_sp_features("MKLLLLSAAA", boundaries=(2, 6))
    assert features["n_length"] == 2
    assert features["h_length"] == 4
    assert features["c_length"] == 4
    assert features["h_mean_hydrophobicity"] == 3.8
    assert features["c_polarity"] == 0.25
    assert features["c_region_polarity"] == 0.25
    with pytest.raises(ValueError):
        interpretable_sp_features("MKLLLLSAAA", boundaries=(6, 2))


@pytest.mark.parametrize("bounds", [(True, 3), (1.5, 3), (-1, 3), (0, 0), (0, 10)])
def test_invalid_boundary_types_and_ranges(bounds):
    with pytest.raises(ValueError):
        split_by_boundaries("MKWVT", n_region=bounds, h_region=(3, 4), c_region=(4, 5))


def test_boundary_sensitivity_hand_calculated_and_annotation_order_invariance():
    annotations = [RegionAnnotation("a", 2, 6, "test"), RegionAnnotation("b", 3, 6, "test")]
    result = boundary_sensitivity("MKALLLSAAA", annotations)
    # H is ALLL or LLL: KD mean is (1.8 + 3*3.8)/4 = 3.3 or 3.8.
    assert result["h_mean_hydrophobicity"]["min"] == pytest.approx(3.3)
    assert result["h_mean_hydrophobicity"]["max"] == pytest.approx(3.8)
    assert result["global_gravy"]["span"] == 0
    assert result == boundary_sensitivity("MKALLLSAAA", reversed(annotations))


def test_mutation_deltas_are_paired_before_extrema():
    annotations = [RegionAnnotation("a", 2, 6, "test"), RegionAnnotation("b", 3, 6, "test")]
    effects = list(mutation_effects("MKALLLSAAA", annotations, positions=[3], alternatives="L"))
    effect = next(row for row in effects if row["feature"] == "h_mean_hydrophobicity")
    # Position 3 belongs to H only in annotation a. A -> L adds (3.8-1.8)/4.
    assert effect["delta_min"] == 0
    assert effect["delta_max"] == pytest.approx(0.5)
    assert effect["direction"] == "annotation_dependent"
    global_effect = next(row for row in effects if row["feature"] == "global_gravy")
    assert global_effect["delta_min"] == pytest.approx(0.2)
    assert global_effect["delta_max"] == pytest.approx(0.2)
    assert global_effect["direction"] == "increase_all"


def test_mutation_full_scan_has_nineteen_alternatives_per_position():
    effects = list(mutation_effects("MKW", [RegionAnnotation("a", 1, 2, "test")]))
    assert len({(r["position"], r["alternative"]) for r in effects}) == 3 * 19
    assert all(r["original"] != r["alternative"] for r in effects)
    assert all(math.isfinite(r["delta_min"]) and math.isfinite(r["delta_max"]) for r in effects)


@pytest.mark.parametrize(
    "annotations",
    [[], [RegionAnnotation("a", 1, 2, "test")] * 2, [RegionAnnotation("a", 1, 30, "test")]],
)
def test_annotation_ensembles_fail_closed(annotations):
    with pytest.raises(ValueError):
        boundary_sensitivity("MKWVT", annotations)


def test_analytic_and_invariance_checks():
    sequence = "ACDEFGHIKLMNPQRSTVWY"
    assert sum(amino_acid_composition(sequence).values()) == pytest.approx(1)
    assert sequence_entropy(sequence) == pytest.approx(math.log2(20))
    assert sequence_entropy("AAAA") == 0
    assert mean_hydrophobicity(sequence) == pytest.approx(mean_hydrophobicity(sequence[::-1]))
    # A two-residue period of 2 has opposing vectors: (I - L)/2 = (4.5-3.8)/2.
    assert hydrophobic_moment("IL", residues_per_turn=2) == pytest.approx(0.35)


def test_cli_reference_roundtrip_and_deterministic_output(tmp_path):
    source = tmp_path / "input.fa"
    reference = tmp_path / "reference.fa"
    output = tmp_path / "out.csv"
    source.write_text(">a a, description\nMKW\n>b\nMLW\n")
    reference.write_text(">ref\nMKW\n")
    args = [str(source), "--reference", str(reference), "-o", str(output)]
    assert main(args) == 0
    first = output.read_bytes()
    assert main(args) == 0
    assert output.read_bytes() == first
    rows = list(csv.DictReader(io.StringIO(first.decode())))
    assert rows[0]["description"] == "a, description"
    assert all(float(value) == 0 for name, value in rows[0].items() if name.startswith("delta_"))
    assert float(rows[1]["delta_global_net_charge"]) == -1
    assert len(rows[0]["implementation_sha256"]) == 64


def test_cli_late_error_preserves_output_and_stages_stdout(tmp_path, capsys, monkeypatch):
    source = tmp_path / "input.fa"
    output = tmp_path / "out.csv"
    source.write_text(">good\nMKW\n>bad\nAXA\n")
    output.write_text("previous result")
    assert main([str(source), "-o", str(output)]) == 2
    assert output.read_text() == "previous result"
    assert not list(tmp_path.glob(".sp-features-*"))
    monkeypatch.setattr("sys.stdin", io.StringIO(source.read_text()))
    assert main(["-"]) == 2
    assert capsys.readouterr().out == ""


def test_cli_annotations_and_mutation_scan(tmp_path):
    source = tmp_path / "input.fa"
    regions = tmp_path / "regions.csv"
    output = tmp_path / "map.csv"
    source.write_text(">seq\nMKW\n")
    regions.write_text("sequence_id,annotation_id,n_end,h_end,source\nseq,a,1,2,test\n")
    assert main([str(source), "--regions", str(regions), "--mutation-scan", "-o", str(output)]) == 0
    rows = list(csv.DictReader(io.StringIO(output.read_text())))
    assert len({(r["position"], r["alternative"]) for r in rows}) == 57
    assert '"source": "test"' in rows[0]["region_annotations"]
    assert main([str(source), "--regions", str(regions), "-o", str(output)]) == 0
    assert list(csv.DictReader(io.StringIO(output.read_text())))[0]["region_method"] == "explicit"


def test_cli_rejects_input_overwrite_and_annotation_mismatch(tmp_path):
    source = tmp_path / "input.fa"
    regions = tmp_path / "regions.csv"
    source.write_text(">seq\nMKW\n")
    regions.write_text("sequence_id,annotation_id,n_end,h_end,source\nother,a,1,2,test\n")
    assert main([str(source), "-o", str(source)]) == 2
    assert source.read_text() == ">seq\nMKW\n"
    assert main([str(source), "--regions", str(regions)]) == 2
