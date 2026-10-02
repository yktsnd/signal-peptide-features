"""Plot paired mutation extrema; values are descriptors, not yield predictions."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="mutation CSV from CLI or walkthrough")
    parser.add_argument("--feature", required=True, help="numeric feature name")
    parser.add_argument("--sequence-id", help="required for a multi-sequence CSV")
    parser.add_argument("--output", type=Path, required=True, help="PNG, SVG or PDF path")
    args = parser.parse_args()
    with args.input.open(encoding="utf-8", newline="") as source:
        rows = [r for r in csv.DictReader(source) if r["feature"] == args.feature]
    if args.sequence_id:
        rows = [r for r in rows if r.get("sequence_id") == args.sequence_id]
    if not rows or len({r.get("sequence_id", "synthetic") for r in rows}) != 1:
        parser.error("select one sequence and an existing numeric feature")
    positions = sorted({int(row["position"]) for row in rows})
    residues = "ACDEFGHIKLMNPQRSTVWY"
    minimum = np.full((20, len(positions)), np.nan)
    maximum = minimum.copy()
    originals = {}
    seen = set()
    for row in rows:
        position = int(row["position"])
        key = position, row["alternative"]
        if key in seen:
            parser.error("duplicate position/residue cells; select one sequence")
        seen.add(key)
        i, j = residues.index(row["alternative"]), positions.index(position)
        minimum[i, j], maximum[i, j] = float(row["delta_min"]), float(row["delta_max"])
        originals[position] = row["original"]
    limit = max(float(np.nanmax(np.abs(minimum))), float(np.nanmax(np.abs(maximum)))) or 1
    cmap = plt.get_cmap("RdBu_r").copy()
    cmap.set_bad("#d9dde2")
    fig, axes = plt.subplots(1, 2, figsize=(12, 7), layout="constrained", sharey=True)
    for axis, data, title in zip(
        axes, (minimum, maximum), ("Minimum paired delta", "Maximum paired delta"), strict=True
    ):
        image = axis.imshow(data, aspect="auto", cmap=cmap, vmin=-limit, vmax=limit)
        axis.set_title(title, loc="left", fontsize=13, pad=12)
        axis.set_xticks(range(len(positions)), [f"{p}\n{originals[p]}" for p in positions])
        axis.set_yticks(range(20), list(residues))
        axis.set_xlabel("Original position / residue")
        axis.spines[["top", "right"]].set_visible(False)
    axes[0].set_ylabel("Alternative residue")
    fig.colorbar(image, ax=axes, label="Candidate minus original (feature units)", shrink=0.7)
    fig.suptitle(f"Annotation-conditioned mutation map\n{args.feature}", fontsize=16)
    fig.supxlabel(
        "Extrema over supplied annotations; not confidence intervals. "
        "Grey: unscanned cells or unchanged residue. No yield prediction.",
        fontsize=9,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, dpi=180)
    plt.close(fig)


if __name__ == "__main__":
    main()
