# Research questions the toolbox can support

These are testable questions suggested by the implemented diagnostics, not findings.
The synthetic walkthrough carries no experimental labels. Sample sizes, outcomes,
validation sets and protocols must be justified separately for each study.

| Question | Implemented analysis | Evidence still needed |
|---|---|---|
| Which sequence descriptors depend on uncertain N/H/C placement? | Explicit annotations; numeric min/max/span; a map of paired mutation extrema | Justification and independent provenance for plausible annotation alternatives |
| Which mutation explanations persist over all supplied alternatives? | Single-substitution map; direction flag; IDs attaining each extreme | External annotations and experimental outcomes; no general robustness claim from one supplied set |
| Is an apparent signal driven by residue counts or residue order? | Seeded composition-preserving permutations with unchanged/duplicate flags | A defensible null model for the actual biological question; arbitrary shuffles may destroy an SP |
| Which local positions contribute to a regional mean? | Per-residue hydropathy, helix-frequency, Hessa-scale and charge-proxy profiles | Confirmation that the scale and region are appropriate for the studied mechanism |
| Are two mutations additive for a chosen descriptor? | Caller-selected descriptor double-mutant cycles | Biological double-mutant measurements to test epistasis; descriptor nonlinearity is a separate explanation |
| Does an average hide opposite local effects? | Residue profiles together with global/regional descriptor changes | A separately validated model relating local patterns to the measured outcome |
| Is a claimed order-sensitive feature actually composition-invariant? | Permutation controls; exact composition tests; descriptor definitions | Sufficient, declared control sampling for empirical claims |
| Can a published feature table be recalculated exactly? | Normalized sequences, boundaries, provenance, version/implementation hashes | Pinned environment and archived study inputs; a hash alone does not archive data |

## Example: annotation-conditioned mutation explanations

1. Select SP endpoints and annotated regions using a stated source independent of
   the outcomes. Preserve all alternatives being compared and their provenance.
2. Compute descriptors and the paired substitution map. Examine numeric magnitudes
   as well as direction flags; zero is classified using stored floating-point values.
3. Inspect profiles where annotation alternatives disagree. Use order controls to
   determine whether the descriptor is insensitive to global residue order or
   affected by position/region assignment.
4. For a separately justified set of pairs, examine double-mutant descriptor cycles.
   Check whether nonlinear descriptor formulas already explain nonadditivity.
5. If experimental data are available, test the relationship separately, with an
   appropriate train/test separation and comparison model. Any prospective mutation
   choice requires independent experimental evidence.

This is a conceptual use pattern, not a validated experimental protocol or recommended
sampling plan. The software avoids outcome-guided annotation selection, significance
tests on synthetic controls, predicted yield scores, and automatic design rankings.

## Why these functions belong together

Ordinary feature calculation returns one value per sequence. This toolkit additionally
keeps the annotation condition, pairs perturbations under matching conditions, exposes
the extrema's annotations, and includes controls for composition and descriptor
nonlinearity. That makes explanations inspectable rather than turning descriptors into
an unvalidated performance score. No priority or scientific novelty claim is made for
mutation scanning, shuffling, sensitivity analysis or double-mutant arithmetic.
