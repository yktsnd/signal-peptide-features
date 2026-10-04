"""Validated TSignal CSV adapter. Upstream runs in its own legacy environment."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from threading import Event

TYPES = {"S": "Sec/SPI", "L": "Sec/SPII", "T": "Tat/SPI", "W": "Tat/SPII", "P": "Sec/SPIV"}


def config_path() -> Path:
    return Path(
        os.environ.get("SP_FEATURES_CONFIG", Path.home() / ".config/sp-features/tsignal.json")
    )


def read_config() -> dict | None:
    path = config_path()
    return json.loads(path.read_text()) if path.exists() else None


def validate_prediction(value: dict, sequence: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError("prediction must be an annotation object")
    value = dict(value)
    if value.get("sequence_sha256") != hashlib.sha256(sequence.encode()).hexdigest():
        raise ValueError("prediction sequence hash mismatch")
    expected_range = [1, min(70, len(sequence))]
    if value.get("analyzed_range", expected_range) != expected_range:
        raise ValueError("prediction analyzed range must match the upstream 70-residue prefix")
    value["analyzed_range"] = expected_range
    if value.get("source") != "TSignal" or type(value.get("has_sp")) is not bool:
        raise ValueError("prediction requires TSignal source and boolean has_sp")
    cut = value.get("cleavage")
    if cut is not None and (type(cut) is not int or not 1 <= cut < min(70, len(sequence))):
        raise ValueError("TSignal cleavage requires a transition within its analyzed window")
    if value["has_sp"]:
        if value.get("type") not in TYPES.values():
            raise ValueError("invalid predicted SP type")
    elif value.get("type") is not None or cut is not None:
        raise ValueError("no-SP prediction conflicts with type or cleavage")
    for key in ("type_score", "cleavage_score"):
        score = value.get(key)
        if score is not None and (type(score) not in {int, float} or not 0 <= score <= 1):
            raise ValueError("model scores must be finite fractions")
    return value


def parse_tsignal_csv(path: Path, sequence: str) -> dict:
    with path.open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 1 or rows[0].get("seqs") != sequence[:70]:
        raise ValueError("TSignal output must contain exactly the submitted 70-residue prefix")
    row = rows[0]
    labels = row.get("pred_lbls", "")
    if len(labels) != len(sequence[:70]) or set(labels) - set("SLTWP IOM".replace(" ", "")):
        raise ValueError("invalid TSignal residue labels or label length")
    first = labels[0]
    present = first in TYPES
    cut = None
    if present:
        n = len(labels) - len(labels.lstrip(first))
        if set(labels[n:]) & set(TYPES):
            raise ValueError("non-contiguous or mixed SP labels")
        if n < len(labels):
            cut = n
    elif set(labels) & set(TYPES):
        raise ValueError("SP labels must form an N-terminal prefix")

    def score(key):
        text = row.get(key, "")
        return None if not text or text.startswith("N/A") else float(text)

    return validate_prediction(
        {
            "source": "TSignal",
            "sequence_sha256": hashlib.sha256(sequence.encode()).hexdigest(),
            "has_sp": present,
            "type": TYPES.get(first),
            "cleavage": cut,
            "analyzed_range": [1, min(70, len(sequence))],
            "labels": labels,
            "type_score": score("SP_type_prob"),
            "cleavage_score": score("CS_prob"),
            "score_interpretation": "Raw upstream softmax scores; calibration not established",
        },
        sequence,
    )


def predict(sequence: str, config: dict | None = None, cancel: Event | None = None) -> dict:
    config = config or read_config()
    if config is None:
        raise ValueError("TSignal is not configured; supply annotations or configure-tsignal")
    root = Path(config["root"]).resolve()
    model = Path(config["model"]).resolve()
    if not (root / "main.py").is_file() or not model.is_file():
        raise ValueError("TSignal source or checkpoint is missing")
    # Upstream prepends sp_data/ to both paths. Relative traversal is server-owned config.
    model_arg = os.path.relpath(model, root / "sp_data")
    with tempfile.TemporaryDirectory(prefix="spfeatures-", dir=root / "sp_data") as folder:
        folder = Path(folder)
        fasta = folder / "input.fasta"
        output = folder / "output.csv"
        fasta.write_text(">spfeatures\n" + sequence + "\n")
        command = [
            config["python"],
            "main.py",
            "--test_seqs",
            os.path.relpath(fasta, root / "sp_data"),
            "--test_mdl",
            model_arg,
            "--tune_bert",
            "--train_only_decoder",
            "--output_file",
            str(output),
        ]
        try:
            with (folder / "run.log").open("w") as log:
                with subprocess.Popen(
                    command, cwd=root, stdout=log, stderr=subprocess.STDOUT
                ) as process:
                    deadline = time.monotonic() + 600
                    try:
                        while process.poll() is None:
                            if cancel is not None and cancel.is_set():
                                raise ValueError("Analysis cancelled")
                            if time.monotonic() >= deadline:
                                raise ValueError("TSignal inference timed out")
                            time.sleep(0.1)
                        if process.returncode:
                            raise ValueError("TSignal process failed; check its environment")
                    finally:
                        if process.poll() is None:
                            process.kill()
                            process.wait()
        except OSError as exc:
            raise ValueError(
                "TSignal failed or timed out; check the legacy environment and checkpoint"
            ) from exc
        if not output.exists():
            raise ValueError("TSignal did not write an output CSV")
        result = parse_tsignal_csv(output, sequence)
        with model.open("rb") as stream:
            result["checkpoint_sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        result["adapter"] = "upstream-csv-v1"
        return result
