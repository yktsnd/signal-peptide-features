"""Reproduce a synthetic arithmetic case; no biological outcome is modeled."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from dataclasses import asdict
from importlib.metadata import version
from pathlib import Path

import numpy as np

from signal_peptide_features import (
    FastaRecord,
    RegionAnnotation,
    Substitution,
    boundary_sensitivity,
    composition_controls,
    interaction_effects,
    mutation_effects,
    residue_profiles,
)
from signal_peptide_features.cli import feature_rows, implementation_sha256


def write_csv(path, rows):
    rows = iter(rows)
    first = next(rows)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(first), lineterminator="\n")
        writer.writeheader()
        writer.writerow(first)
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    sequence = "MKALLLSAAA"
    annotations = [
        RegionAnnotation("scenario_a", 2, 6, "synthetic arithmetic example"),
        RegionAnnotation("scenario_b", 3, 6, "synthetic boundary alternative"),
    ]
    record = FastaRecord("synthetic", "not an experimental sequence", sequence)
    write_csv(
        args.output_dir / "features.csv",
        feature_rows(
            [record],
            annotations={"synthetic": tuple(annotations)},
        ),
    )
    write_csv(
        args.output_dir / "boundaries.csv",
        (
            {"feature": name, **values}
            for name, values in boundary_sensitivity(sequence, annotations).items()
        ),
    )
    write_csv(args.output_dir / "mutations.csv", mutation_effects(sequence, annotations))
    write_csv(args.output_dir / "profiles.csv", residue_profiles(sequence, annotations))
    # Eight draws illustrate deterministic software behavior, not statistical power.
    write_csv(
        args.output_dir / "controls.csv",
        composition_controls(
            sequence,
            annotations,
            samples=8,
            seed=17,
        ),
    )
    write_csv(
        args.output_dir / "interactions.csv",
        interaction_effects(
            sequence,
            annotations,
            [(Substitution(3, "L"), Substitution(6, "A"))],
        ),
    )
    manifest = {
        "case": "synthetic arithmetic example; no biological outcome",
        "sequence": sequence,
        "annotations": [asdict(annotation) for annotation in annotations],
        "control_samples": 8,
        "control_seed": 17,
        "interaction_pairs": [[{"position": 3, "residue": "L"}, {"position": 6, "residue": "A"}]],
        "package_version": version("signal-peptide-features"),
        "implementation_sha256": implementation_sha256(),
        "python_version": sys.version.split()[0],
        "numpy_version": np.__version__,
        "files": {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(args.output_dir.glob("*.csv"))
        },
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote six synthetic research tables and manifest to {args.output_dir}")


if __name__ == "__main__":
    main()
