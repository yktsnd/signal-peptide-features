# Validation scope

## What is tested

- Original default feature regression: default numerical behavior remains intact.
- Independent coefficient transcription: all 20 Kyte–Doolittle and Chou–Fasman
  values, plus all 20 values of Kidera factor 4, agree with separately extracted
  AAindex reference data. Other coefficients are not claimed to be table-verified.
- Analytical cases: uniform composition entropy, fraction sum, a two-residue
  hydrophobic-moment case, explicit region means, paired A3L deltas and a binary
  cleavage-descriptor double-mutant interaction.
- Invariance: global composition descriptors survive residue shuffling up to
  floating-point rounding; annotation order preserves sensitivity extrema;
  switching a substitution pair's order preserves its descriptor interaction.
- Complete single-mutant enumeration: 19 alternatives per position, excluding the
  unchanged residue. Output values in the test case are finite.
- Strict parsing: duplicate FASTA/annotation IDs, malformed records, noncanonical
  residues, invalid region coordinates, invalid mutation specifications, and
  sequence/annotation mismatches are rejected.
- Reproducibility: a local seeded RNG gives repeatable controls; duplicated and
  unchanged shuffled sequences are retained and marked.
- Output integrity: input/reference/annotation overwrite prevention, stable CSV
  ordering, late-error protection of an existing output, and staging of stdout.
- Packaging: wheel and source distribution build; installed CLI and module entry
  points operate outside the source directory. CI declares Python 3.12 and 3.13.

## Evidence boundaries

The shipped tests establish behavior for their stated numerical and software cases.
They do not establish secretion-yield prediction, SP/cargo compatibility, correct
biological cleavage boundaries, biological epistasis, causal mechanisms, statistical
significance, or advantage over established packages. No measured benchmark is shipped.

The implementation contains no pH-dependent charge model, position-dependent Hessa
insertion model, secondary-structure predictor, SP detector, or experimentally trained
ranking function. Numerical scale means remain descriptors.

The full original Hessa table and Kidera factors other than factor 4 still require
independent table verification. Scientific use should report which scales were used
and their exact source/version. Redistribution review remains separate from testing.

## Re-run

```bash
python -m pip install -e ".[dev]" build
python -m ruff check .
python -m pytest
python -m build
python examples/research_walkthrough.py --output-dir research-output
```

The coefficient fixture is offline and includes the retrieval URL/date and original
download fingerprint. Tests do not query a live database or provider.
