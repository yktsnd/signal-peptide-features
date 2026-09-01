# signal-peptide-features

`signal-peptide-features` is a lightweight Python library for reproducible
calculation of interpretable sequence-derived features for signal peptides and
neighboring protein regions.

It is a feature calculator, not an SP optimizer. It does not predict the best
signal peptide, secretion yield, cargo compatibility, or experimental outcome.
It contains no OrthoSignal code, data, labels, model weights, or benchmark
logic.

## Install

```powershell
python -m pip install -e ".[dev]"
```

The core package depends only on NumPy. Optional embedding helpers accept
already computed arrays and do not install or load a protein language model.

## Example

```python
from signal_peptide_features import interpretable_sp_features

features = interpretable_sp_features("MKWVTFISLLFLFSSAYS")
print(features["h_mean_hydrophobicity"])
```

## Feature groups

The presets cover sequence architecture, charge, Kyte–Doolittle
hydrophobicity, helix propensity, cleavage-proximal descriptors, Hessa/Sec61
insertion proxies, Kidera-10 summaries, and deterministic local-window
statistics. `split_fractional_regions` uses deterministic heuristic regions;
they are **not biological cleavage predictions**.

Hessa values are from Hessa et al. (2007), DOI
`10.1038/nature06502`. Kidera factors are from Kidera et al. (1985), DOI
`10.1007/BF01025492`. Kyte–Doolittle is Kyte and Doolittle (1982), DOI
`10.1016/0022-2836(82)90515-0`. These scales are sequence descriptors and do
not imply a secretion-performance claim.

## License and release review

Original code is MIT licensed. The cited numerical scales are retained with
source attribution; a human should confirm redistribution treatment of
source-derived constants before a public release. No external model weights,
datasets, or copied software are included.
