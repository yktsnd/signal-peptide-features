"""Independent database references, not snapshots generated from our tables."""

import json
from pathlib import Path

from signal_peptide_features.helix import HELIX_PROPENSITY
from signal_peptide_features.hydrophobicity import KYTE_DOOLITTLE
from signal_peptide_features.kidera import KIDERA_FACTORS


def test_scales_against_independent_aaindex_extraction():
    reference = json.loads(
        (Path(__file__).parent / "fixtures" / "aaindex_reference.json").read_text()
    )["values"]
    assert KYTE_DOOLITTLE == reference["KYTJ820101"]
    assert HELIX_PROPENSITY == reference["CHOP780201"]
    assert {aa: values[3] for aa, values in KIDERA_FACTORS.items()} == reference["KIDA850101"]
