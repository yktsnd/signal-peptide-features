"""Auditable FASTA-to-table workflow and descriptive reference differences."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import sys
import tempfile
from collections.abc import Iterable, Iterator, Sequence
from importlib.metadata import version
from pathlib import Path
from typing import TextIO

import numpy as np

from .controls import Substitution, composition_controls, interaction_effects, residue_profiles
from .fasta import FastaRecord, read_fasta
from .feature_sets import basic_sp_features, interpretable_sp_features
from .regions import split_fractional_regions
from .sensitivity import RegionAnnotation, mutation_effects

PRESETS = {"basic": basic_sp_features, "interpretable": interpretable_sp_features}


def implementation_sha256() -> str:
    """Fingerprint packaged Python source, including coefficient tables."""
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode("utf-8") + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def read_annotations(path: str) -> dict[str, tuple[RegionAnnotation, ...]]:
    groups: dict[str, list[RegionAnnotation]] = {}
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        expected = {"sequence_id", "annotation_id", "n_end", "h_end", "source"}
        if (
            reader.fieldnames is None
            or len(reader.fieldnames) != len(expected)
            or set(reader.fieldnames) != expected
        ):
            raise ValueError("region CSV columns must be: " + ",".join(sorted(expected)))
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None or not value.strip() for value in row.values()):
                raise ValueError(f"region CSV line {line}: missing or extra values")
            identifier = row["sequence_id"].strip()
            try:
                annotation = RegionAnnotation(
                    row["annotation_id"].strip(),
                    int(row["n_end"]),
                    int(row["h_end"]),
                    row["source"].strip(),
                )
            except ValueError as error:
                raise ValueError(f"region CSV line {line}: {error}") from error
            group = groups.setdefault(identifier, [])
            if any(item.annotation_id == annotation.annotation_id for item in group):
                raise ValueError(f"duplicate annotation ID for sequence {identifier!r}")
            group.append(annotation)
    if not groups:
        raise ValueError("region CSV contains no annotations")
    return {name: tuple(group) for name, group in groups.items()}


def read_pairs(path: str) -> dict[str, tuple[tuple[Substitution, Substitution], ...]]:
    groups: dict[str, list[tuple[Substitution, Substitution]]] = {}
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        expected = {"sequence_id", "position_a", "residue_a", "position_b", "residue_b"}
        if (
            reader.fieldnames is None
            or len(reader.fieldnames) != len(expected)
            or set(reader.fieldnames) != expected
        ):
            raise ValueError("pair CSV columns must be: " + ",".join(sorted(expected)))
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None or not value.strip() for value in row.values()):
                raise ValueError(f"pair CSV line {line}: missing or extra values")
            groups.setdefault(row["sequence_id"].strip(), []).append(
                (
                    Substitution(int(row["position_a"]), row["residue_a"].strip()),
                    Substitution(int(row["position_b"]), row["residue_b"].strip()),
                )
            )
    if not groups:
        raise ValueError("pair CSV contains no substitution pairs")
    return {name: tuple(group) for name, group in groups.items()}


def feature_rows(
    records: Iterable[FastaRecord],
    *,
    preset: str = "interpretable",
    reference: FastaRecord | None = None,
    annotations: dict[str, tuple[RegionAnnotation, ...]] | None = None,
    mutation_scan: bool = False,
    profiles: bool = False,
    control_samples: int | None = None,
    seed: int | None = None,
    pairs: dict[str, tuple[tuple[Substitution, Substitution], ...]] | None = None,
) -> Iterator[dict[str, float | str | int]]:
    """Yield descriptors or a paired mutation map, with source provenance."""
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r}; choose from {tuple(PRESETS)}")
    analysis_mode = mutation_scan or profiles or control_samples is not None or pairs is not None
    if sum((mutation_scan, profiles, control_samples is not None, pairs is not None)) > 1:
        raise ValueError("choose only one analysis mode")
    if reference is not None and (annotations is not None or analysis_mode):
        raise ValueError(
            "reference comparison uses fractional regions; use mutation scan "
            "for paired changes across explicit annotations"
        )
    if analysis_mode and (annotations is None or preset != "interpretable"):
        raise ValueError("analysis modes require explicit annotations and interpretable preset")
    if seed is not None and control_samples is None:
        raise ValueError("seed is used only with composition controls")
    if control_samples is not None and seed is None:
        raise ValueError("composition controls require an explicit integer seed")
    calculate = PRESETS[preset]
    package_version = version("signal-peptide-features")
    code_hash = implementation_sha256()
    baseline = calculate(reference.sequence) if reference is not None else None
    used: set[str] = set()
    for record in records:
        used.add(record.identifier)
        if annotations is not None and record.identifier not in annotations:
            raise ValueError(f"record {record.identifier!r}: no region annotations supplied")
        choices = annotations[record.identifier] if annotations is not None else (None,)
        common: dict[str, float | str | int] = {
            "sequence_id": record.identifier,
            "description": record.description,
            "sequence": record.sequence,
            "sequence_sha256": hashlib.sha256(record.sequence.encode("ascii")).hexdigest(),
            "package_version": package_version,
            "implementation_sha256": code_hash,
            "preset": preset,
            "python_version": sys.version.split()[0],
            "numpy_version": np.__version__,
        }
        if analysis_mode:
            definitions = [
                {
                    "annotation_id": item.annotation_id,
                    "n_end": item.n_end,
                    "h_end": item.h_end,
                    "source": item.source,
                }
                for item in choices
            ]
            if mutation_scan:
                effects = mutation_effects(record.sequence, choices)
            elif profiles:
                effects = residue_profiles(record.sequence, choices)
            elif control_samples is not None:
                effects = composition_controls(
                    record.sequence, choices, samples=control_samples, seed=seed
                )
            else:
                if record.identifier not in pairs:
                    raise ValueError(
                        f"record {record.identifier!r}: no substitution pairs supplied"
                    )
                effects = interaction_effects(record.sequence, choices, pairs[record.identifier])
            for effect in effects:
                yield {
                    **common,
                    "region_annotations": json.dumps(definitions, sort_keys=True),
                    **effect,
                }
            continue
        for annotation in choices:
            boundaries = annotation.boundaries if annotation is not None else None
            try:
                features = calculate(record.sequence, boundaries=boundaries)
                regions = split_fractional_regions(record.sequence) if boundaries is None else None
            except ValueError as error:
                raise ValueError(f"record {record.identifier!r}: {error}") from error
            row = {
                **common,
                "region_method": "explicit" if annotation else "fractional_n0.25_c0.20",
                "annotation_id": annotation.annotation_id if annotation else "fractional",
                "annotation_source": annotation.source if annotation else "heuristic",
            }
            if annotation is not None:
                bounds = (
                    (0, annotation.n_end),
                    (annotation.n_end, annotation.h_end),
                    (annotation.h_end, len(record.sequence)),
                )
            else:
                bounds = tuple(regions[f"{name}_bounds"] for name in ("n", "h", "c"))
            for name, (start, end) in zip(("n", "h", "c"), bounds, strict=True):
                row[f"{name}_start"] = start
                row[f"{name}_end"] = end
            row.update(features)
            if reference is not None and baseline is not None:
                row["reference_id"] = reference.identifier
                row["reference_sequence"] = reference.sequence
                row["reference_sha256"] = hashlib.sha256(
                    reference.sequence.encode("ascii")
                ).hexdigest()
                for name, value in features.items():
                    if isinstance(value, (int, float)):
                        row[f"delta_{name}"] = value - baseline[name]
            yield row
    if annotations is not None and set(annotations) - used:
        raise ValueError(
            "region CSV contains IDs absent from FASTA: "
            + ", ".join(sorted(set(annotations) - used))
        )

    if pairs is not None and set(pairs) - used:
        raise ValueError("pair CSV contains IDs absent from FASTA")


def _write_table(rows: Iterable[dict[str, float | str | int]], target: TextIO) -> None:
    iterator = iter(rows)
    first = next(iterator, None)
    if first is None:
        raise ValueError("input contains no records")
    writer = csv.DictWriter(target, fieldnames=list(first), lineterminator="\n")
    writer.writeheader()
    writer.writerow(first)
    writer.writerows(iterator)


def _reference(path: str) -> FastaRecord:
    with Path(path).open(encoding="utf-8-sig") as source:
        records = read_fasta(source)
        reference = next(records)
        if next(records, None) is not None:
            raise ValueError("reference FASTA must contain exactly one record")
        return reference


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv) if argv is not None else sys.argv[1:]
    if arguments and arguments[0] in {"gui", "configure-tsignal"}:
        from .web_cli import main as web_main

        return web_main(arguments)
    parser = argparse.ArgumentParser(
        description="Calculate SP descriptors from FASTA; optional deltas are candidate minus "
        "reference, not secretion predictions. Supply signal-peptide sequences, not full proteins."
    )
    parser.add_argument("input", help="protein FASTA path, or - for standard input")
    parser.add_argument("-o", "--output", default="-", help="CSV path, or - for standard output")
    parser.add_argument("--preset", choices=tuple(PRESETS), default="interpretable")
    parser.add_argument(
        "--regions", help="CSV with explicit N/H/C annotations (see docs/methods.md)"
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--mutation-scan",
        action="store_true",
        help="enumerate single substitutions paired across supplied annotations",
    )
    modes.add_argument("--residue-profiles", action="store_true", help="per-residue scale values")
    modes.add_argument(
        "--order-controls", type=int, help="number of composition-preserving shuffles"
    )
    modes.add_argument("--interaction-pairs", help="CSV of user-selected double substitutions")
    parser.add_argument("--seed", type=int, help="explicit RNG seed for order controls")
    parser.add_argument("--reference", help="FASTA path containing one reference SP")
    parser.add_argument("--version", action="version", version=version("signal-peptide-features"))
    args = parser.parse_args(argv)

    temporary_path: Path | None = None
    try:
        output = Path(args.output) if args.output != "-" else None
        if output is not None:
            for source_path in (args.input, args.reference, args.regions, args.interaction_pairs):
                if source_path is not None and source_path != "-":
                    source = Path(source_path)
                    if source.resolve() == output.resolve() or (
                        output.exists() and source.exists() and os.path.samefile(source, output)
                    ):
                        raise ValueError("output must differ from input and reference files")
        reference = _reference(args.reference) if args.reference else None
        annotations = read_annotations(args.regions) if args.regions else None
        pairs = read_pairs(args.interaction_pairs) if args.interaction_pairs else None
        # Stage on disk before publishing: a late invalid record cannot replace
        # a valid existing table or emit a misleading partial CSV to stdout.
        with tempfile.NamedTemporaryFile(
            mode="w+",
            encoding="utf-8",
            newline="",
            delete=False,
            dir=output.parent if output is not None else None,
            prefix=".sp-features-",
            suffix=".csv",
        ) as staged:
            temporary_path = Path(staged.name)
            if args.input == "-":
                _write_table(
                    feature_rows(
                        read_fasta(sys.stdin),
                        preset=args.preset,
                        reference=reference,
                        annotations=annotations,
                        mutation_scan=args.mutation_scan,
                        profiles=args.residue_profiles,
                        control_samples=args.order_controls,
                        seed=args.seed,
                        pairs=pairs,
                    ),
                    staged,
                )
            else:
                with Path(args.input).open(encoding="utf-8-sig") as source:
                    _write_table(
                        feature_rows(
                            read_fasta(source),
                            preset=args.preset,
                            reference=reference,
                            annotations=annotations,
                            mutation_scan=args.mutation_scan,
                            profiles=args.residue_profiles,
                            control_samples=args.order_controls,
                            seed=args.seed,
                            pairs=pairs,
                        ),
                        staged,
                    )
            staged.flush()
            if output is None:
                staged.seek(0)
                shutil.copyfileobj(staged, sys.stdout)
        if output is not None:
            os.replace(temporary_path, output)
            temporary_path = None
        return 0
    except (OSError, UnicodeError, ValueError) as error:
        print(f"sp-features: {error}", file=sys.stderr)
        return 2
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
