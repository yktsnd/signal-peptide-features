"""Single precursor analysis with explicit coordinate and evidence provenance."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from importlib.resources import files
from statistics import mean

from .composition import sequence_entropy
from .helix import HELIX_PROPENSITY
from .hydrophobicity import KYTE_DOOLITTLE, hydrophobic_moment
from .regions import normalize_sequence

REFERENCE = json.loads(files(__package__).joinpath("scales.json").read_text())
SCALES = {
    "hydrophobicity": (KYTE_DOOLITTLE, "Kyte–Doolittle / KYTJ820101", "疎水性"),
    "polarity": (REFERENCE["tables"]["GRAR740102"], "Grantham / GRAR740102", "極性"),
    "volume": (REFERENCE["tables"]["GRAR740103"], "Grantham / GRAR740103", "残基体積尺度"),
    "helix": (HELIX_PROPENSITY, "Chou–Fasman / CHOP780201", "ヘリックス形成傾向"),
    "flexibility": (REFERENCE["tables"]["VINM940101"], "Vihinen / VINM940101", "柔軟性参照値"),
    "charge": (
        {a: int(a in "KR") - int(a in "DE") for a in KYTE_DOOLITTLE},
        "K+R−D−E; excludes pH and termini",
        "電荷の簡易指標",
    ),
}
PROCESSES = {
    "targeting": "標的への移行",
    "orientation": "膜での向き",
    "translocation": "膜通過",
    "recognition": "切断部位の認識",
    "accessibility": "切断部位への接近",
    "selection": "切断位置の選択",
}
# These are exploratory relationships, not validated physiological predictions.
RELATIONS = {
    "hydrophobicity": ["targeting", "orientation", "translocation", "accessibility"],
    "polarity": ["translocation", "recognition", "accessibility"],
    "volume": ["recognition", "accessibility"],
    "helix": ["translocation", "accessibility"],
    "flexibility": ["accessibility"],
    "charge": ["targeting", "orientation", "translocation", "recognition"],
    "identity": ["recognition", "selection"],
    "composition": ["targeting", "recognition", "accessibility"],
}


def estimate_regions(sp: str) -> dict | None:
    """Maximum positive KD-sum internal segment; exploratory rule, not a model."""
    if len(sp) < 3:
        return None
    best_sum = current = 0.0
    start = 1
    best = None
    for i in range(1, len(sp) - 1):
        if current <= 0:
            current, start = 0.0, i
        current += KYTE_DOOLITTLE[sp[i]]
        if current > best_sum:
            best_sum, best = current, (start, i + 1)
    if best is None:
        return None
    left, right = best
    return {"N": [1, left], "H": [left + 1, right], "C": [right + 1, len(sp)]}


def analyze_sequence(
    sequence: str,
    *,
    mode: str = "precursor",
    cleavage: int | None = None,
    sp_type: str | None = None,
    has_sp: bool | None = None,
    prediction: dict | None = None,
    boundaries: tuple[int, int] | None = None,
    estimate: bool = True,
    mature_window: int = 10,
    structure: list[dict] | None = None,
) -> dict:
    """Coordinates in reports are 1-based inclusive; cleavage is last SP residue."""
    seq = normalize_sequence(sequence)
    if len(seq) > 10000:
        raise ValueError("maximum sequence length is 10000")
    if mode not in {"precursor", "sp"}:
        raise ValueError("mode must be precursor or sp")
    if type(mature_window) is not int or not 1 <= mature_window <= 100:
        raise ValueError("mature_window must be between 1 and 100")
    if type(estimate) is not bool:
        raise ValueError("estimate must be boolean")
    if has_sp is not None and type(has_sp) is not bool:
        raise ValueError("has_sp must be boolean")
    allowed_types = {"Sec/SPI", "Sec/SPII", "Tat/SPI", "Tat/SPII", "Sec/SPIV"}
    if sp_type is not None and sp_type not in allowed_types:
        raise ValueError("unsupported SP type")
    if has_sp is False and (cleavage is not None or sp_type is not None or mode == "sp"):
        raise ValueError("has_sp=false conflicts with supplied SP annotations")
    supplied = {"cleavage": cleavage, "type": sp_type, "has_sp": has_sp}
    annotations = {}
    warnings = []
    if prediction is not None:
        from .prediction import validate_prediction

        prediction = validate_prediction(prediction, seq)
    for key, value in supplied.items():
        predicted = prediction.get(key) if prediction else None
        annotations[key] = {
            "value": value if value is not None else predicted,
            "basis": "provided"
            if value is not None
            else "model_prediction"
            if predicted is not None
            else "missing",
        }
        if value is not None and predicted is not None and value != predicted:
            warnings.append(f"Supplied {key} differs from TSignal; supplied value retained.")
    cut = annotations["cleavage"]["value"]
    present = annotations["has_sp"]["value"]
    if cut is not None and (type(cut) is not int or not 1 <= cut <= len(seq)):
        raise ValueError("cleavage must be an integer inside the sequence")
    if mode == "sp":
        if cut is not None and cut != len(seq):
            raise ValueError("SP-only input must end at the supplied cleavage position")
        cut = len(seq)
        annotations["cleavage"] = {
            "value": cut,
            "basis": "provided",
            "method": "SP-only input declares its terminal boundary",
        }
    if has_sp is False:
        for key in ("cleavage", "type"):
            if annotations[key]["value"] is not None:
                warnings.append(f"Predicted {key} suppressed by supplied has_sp=false.")
            annotations[key] = {"value": None, "basis": "missing"}
        cut = None
    elif has_sp is None and (cleavage is not None or sp_type is not None or mode == "sp"):
        if present is False:
            warnings.append(
                "Supplied SP annotation conflicts with predicted no-SP; input retained."
            )
        annotations["has_sp"] = {
            "value": True,
            "basis": "provided",
            "method": "Presence implied by supplied SP annotation",
        }
        present = True
    if present is False and (cut is not None or annotations["type"]["value"] is not None):
        raise ValueError("has_sp=false conflicts with a cleavage position or SP type")
    if cut is not None and present is None:
        annotations["has_sp"] = {"value": True, "basis": annotations["cleavage"]["basis"]}
    sp = seq[:cut] if cut is not None else None
    regions = None
    region_basis = "missing"
    if boundaries is not None:
        if sp is None or len(boundaries) != 2:
            raise ValueError("N/H/C boundaries require a known SP endpoint")
        n, h = boundaries
        if any(type(x) is not int for x in boundaries) or not 0 < n < h < len(sp):
            raise ValueError("boundaries must satisfy 0 < n_end < h_end < SP length")
        regions, region_basis = {"N": [1, n], "H": [n + 1, h], "C": [h + 1, len(sp)]}, "provided"
    elif sp is not None and estimate and annotations["type"]["value"] in {None, "Sec/SPI"}:
        regions, region_basis = estimate_regions(sp), "rule_estimate"
    if not regions:
        region_basis = "missing"
    warnings += [
        "Sequence coefficients do not measure cleavage efficiency, secretion yield, "
        "or physical rigidity.",
        "Matrix links are exploratory interpretations, not validated physiological scores.",
    ]
    if cut == len(seq):
        warnings.append("Mature-side residues are unavailable; +1 and exposure cannot be inferred.")
    if cut is None:
        warnings.append("SP endpoint is unknown; SP, N/H/C and junction metrics are unavailable.")
    profiles = []
    for i, aa in enumerate(seq, 1):
        relative = (
            i - cut if cut is not None and i > cut else (i - cut - 1 if cut is not None else None)
        )
        profiles.append(
            {
                "position": i,
                "residue": aa,
                "relative": relative,
                "region": next(
                    (r for r, (a, b) in (regions or {}).items() if a <= i <= b),
                    "mature" if cut and i > cut else "unknown",
                ),
                **{k: table[aa] for k, (table, _, _) in SCALES.items()},
            }
        )
    if structure is not None and (
        not isinstance(structure, list) or any(not isinstance(row, dict) for row in structure)
    ):
        raise ValueError("structure must be an array of annotation objects")
    for row in structure or []:
        pos = row.get("position")
        if type(pos) is not int or not 1 <= pos <= len(seq) or row.get("residue") != seq[pos - 1]:
            raise ValueError("structure rows must match full precursor coordinates and residues")
        if not row.get("source") or row.get("basis") not in {"provided", "model_prediction"}:
            raise ValueError("structure rows require source and provided/model_prediction basis")
        values = {k: row[k] for k in ("rsa", "disorder", "secondary_structure") if k in row}
        for key in ("rsa", "disorder"):
            if key in values and (
                type(values[key]) not in {int, float} or not 0 <= values[key] <= 1
            ):
                raise ValueError(f"{key} must be a finite fraction between 0 and 1")
        if "secondary_structure" in values and values["secondary_structure"] not in {"H", "E", "C"}:
            raise ValueError("secondary_structure must be H, E or C")
        if "structure" in profiles[pos - 1]:
            raise ValueError("duplicate structure position")
        profiles[pos - 1]["structure"] = {**values, "source": row["source"], "basis": row["basis"]}
    metrics = []

    def add(key, value, prop, scope, interval, basis, definition, source, label=None):
        metrics.append(
            {
                "id": key,
                "value": value,
                "property": prop,
                "scope": scope,
                "range": interval,
                "basis": basis,
                "definition": definition,
                "source": source,
                "unit": "residues"
                if key.endswith(".length")
                else "fraction"
                if ".fraction_" in key
                else "bits"
                if key.endswith(".entropy")
                else "amino-acid identity"
                if key.endswith(".identity")
                else "source-defined scale units",
                "source_verification": "AAindex 20-residue table checked"
                if any(
                    code in source
                    for code in (
                        "KYTJ820101",
                        "CHOP780201",
                        "GRAR740102",
                        "GRAR740103",
                        "VINM940101",
                    )
                )
                else "explicit calculation definition"
                if source == "sequence"
                else "source attributed; interpretation limited as stated",
                "label_ja": label or key,
                "processes": RELATIONS.get(prop, []),
                "boundary_basis": annotations["cleavage"]["basis"] if scope != "whole" else None,
            }
        )

    scopes = [("whole", [1, len(seq)], "sequence")]
    if sp is not None:
        scopes.append(("SP", [1, cut], annotations["cleavage"]["basis"]))
        scopes.extend((r, interval, region_basis) for r, interval in (regions or {}).items())
        scopes.append(("junction_SP", [max(1, cut - 5), cut], annotations["cleavage"]["basis"]))
        if cut < len(seq):
            scopes.append(
                (
                    "mature_N",
                    [cut + 1, min(len(seq), cut + mature_window)],
                    annotations["cleavage"]["basis"],
                )
            )
    for scope, (a, b), basis in scopes:
        fragment = seq[a - 1 : b]
        add(
            f"{scope}.length",
            len(fragment),
            "composition",
            scope,
            [a, b],
            basis,
            "Number of residues in the selected interval",
            "sequence",
            "残基数",
        )
        for prop, (table, source, label) in SCALES.items():
            add(
                f"{scope}.{prop}",
                mean(table[x] for x in fragment),
                prop,
                scope,
                [a, b],
                basis,
                "Arithmetic mean of residue coefficients; "
                "not a structural or physiological prediction",
                source,
                label,
            )
        for group, residues in {"PG": "PG", "KR": "KR", "DE": "DE", "STNQ": "STNQ"}.items():
            add(
                f"{scope}.fraction_{group}",
                sum(x in residues for x in fragment) / len(fragment),
                "composition",
                scope,
                [a, b],
                basis,
                f"Fraction of residues in {residues}",
                "sequence",
                f"{group}の割合",
            )
        for aa in sorted(KYTE_DOOLITTLE):
            add(
                f"{scope}.fraction_{aa}",
                fragment.count(aa) / len(fragment),
                "composition",
                scope,
                [a, b],
                basis,
                f"Fraction of {aa} residues",
                "sequence",
                f"{aa}の割合",
            )
        add(
            f"{scope}.charge_sum",
            sum(SCALES["charge"][0][x] for x in fragment),
            "charge",
            scope,
            [a, b],
            basis,
            "K+R-D-E count; not pH-dependent net charge",
            SCALES["charge"][1],
            "電荷の簡易指標（合計）",
        )
        add(
            f"{scope}.entropy",
            sequence_entropy(fragment),
            "composition",
            scope,
            [a, b],
            basis,
            "Shannon entropy in bits of residue composition",
            "sequence",
            "組成の多様性",
        )
        add(
            f"{scope}.hydrophobic_moment",
            hydrophobic_moment(fragment),
            "hydrophobicity",
            scope,
            [a, b],
            basis,
            "KD hydrophobic moment under a hypothetical 100-degree helix",
            "Eisenberg geometry; KD coefficients; not measured secondary structure",
            "疎水性モーメント",
        )
    if cut is not None:
        for row in profiles[max(0, cut - 6) : min(len(seq), cut + 6)]:
            rel = row["relative"]
            add(
                f"junction.{rel:+d}.identity",
                row["residue"],
                "identity",
                "junction",
                [row["position"], row["position"]],
                annotations["cleavage"]["basis"],
                "Residue relative to cleavage; no position zero",
                "sequence",
                f"{rel:+d}の残基",
            )
        if annotations["type"]["value"] == "Sec/SPI" and cut >= 3:
            add(
                "junction.small_neutral",
                int(seq[cut - 3] in "AGSC" and seq[cut - 1] in "AGSC"),
                "identity",
                "junction",
                [cut - 2, cut],
                annotations["cleavage"]["basis"],
                "-3 and -1 both in AGSC; descriptive rule, not a cleavage probability",
                "von Heijne -3/-1 heuristic; AGSC operational set",
                "−3/−1の小型中性残基",
            )
    for row in profiles:
        for prop in ("rsa", "disorder", "secondary_structure"):
            if prop in row.get("structure", {}):
                item = row["structure"]
                add(
                    f"structure.{row['position']}.{prop}",
                    item[prop],
                    prop,
                    "structure",
                    [row["position"], row["position"]],
                    item["basis"],
                    "Imported annotation; structure state and model uncertainty depend on source",
                    item["source"],
                    prop,
                )
    return {
        "schema_version": "1.0",
        "software": {
            "name": "signal-peptide-features",
            "version": "0.3.0",
            "implementation_sha256": hashlib.sha256(
                b"".join(
                    p.name.encode() + p.read_bytes()
                    for p in sorted(files(__package__).iterdir(), key=lambda p: p.name)
                    if p.name.endswith((".py", ".json"))
                )
            ).hexdigest(),
        },
        "created_at": datetime.now(UTC).isoformat(),
        "sequence": seq,
        "mode": mode,
        "sequence_sha256": hashlib.sha256(seq.encode()).hexdigest(),
        "annotations": annotations,
        "prediction": prediction,
        "regions": {
            "intervals": regions,
            "basis": region_basis,
            "method": "max-positive-internal-KD-sum-v1"
            if region_basis == "rule_estimate"
            else None,
        },
        "settings": {"mature_window": mature_window, "estimate": estimate},
        "profiles": profiles,
        "metrics": metrics,
        "warnings": warnings,
        "matrix": {"processes": PROCESSES, "relations": RELATIONS},
        "references": REFERENCE | {"tables": list(REFERENCE["tables"])},
    }
