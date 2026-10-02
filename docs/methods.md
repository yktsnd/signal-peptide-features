# Methods and interpretation contract

## Intended research use

This package calculates deterministic descriptors of **already selected signal-peptide
sequences**. Researchers can use the results as covariates, exploratory summaries, or
inputs to separately validated statistical models. The package supplies no evidence
that these descriptors predict secretion yield or rank useful experimental variants.

The new workflow asks a narrower, auditable question: **does a descriptor change after
a substitution under every supplied N/H/C annotation, or does the conclusion depend on
where a boundary is placed?** This is a descriptive computational diagnostic, not a
validated biological mechanism or a new secretion predictor.

## Sequence and coordinate contract

- Supply the complete SP ending immediately before the intended cleavage site. Full
  precursor proteins are not trimmed automatically; the software cannot establish
  whether a supplied sequence is actually a signal peptide.
- Case and whitespace are normalized. Only the 20 canonical amino acids are accepted.
  No imputation, ambiguous-residue averaging, gap removal or stop-symbol removal occurs.
- Presets require at least three residues. N/H/C regions must be non-empty.
- Python `boundaries=(n_end, h_end)` defines N `[0,n_end)`, H `[n_end,h_end)`,
  C `[h_end,length)`. These are **zero-based, end-exclusive** coordinates.
- Mutation positions are **one-based**. The output includes the original and alternative
  residue to make coordinate errors detectable.
- `split_by_boundaries` also permits gaps between ordered non-overlapping regions; the
  feature presets use contiguous N/H/C regions covering the complete supplied SP.

For example, `MKALLLSAAA` with boundaries `(2,6)` has N `MK`, H `ALLL`, C `SAAA`.

## Two distinct region modes

**Fractional mode (legacy default)** uses N length `max(1,round(0.25*L))` and C length
`max(1,round(0.20*L))`, with H as the remainder. Python's round-to-even rule applies.
If required to leave H non-empty, C is shortened first, then N. These are arbitrary,
deterministic descriptive regions; they are not predicted biological domains.

**Explicit mode** uses researcher-supplied boundaries, with a non-empty source and
annotation ID. They may come from a stated annotation method, curated literature, or
a declared sensitivity scenario. The package does not confer validity on the source.
Record the prediction method/version or source accession and how its output was
converted into N/H/C boundaries. Choose alternatives independently of the outcomes
being analyzed. Repeated alternatives carry no additional evidential weight.

One legacy descriptor needs special care: in fractional mode `c_region_polarity` uses
the last `max(3,L//5)` residues, while `c_polarity` uses fractional C. This preserves
the original API's numerical results. In explicit mode **both use supplied C**.
Report region mode; mixing modes silently would change the meaning of this descriptor.

## Descriptor dictionary

Let `L` denote the length of the indicated region, `count(X)` the number of residues
in set X, `p(a)` the fraction of residue a, and `mean(scale)` the arithmetic mean of
its per-residue scale values. All features are deterministic; no model is trained.

| Output key(s) | Definition / region | Units / source |
|---|---|---|
| `sp_length`, `n_length`, `h_length`, `c_length` | Number of residues in complete SP or N/H/C | residues |
| `aa_fraction_A` … `aa_fraction_Y` | `p(a)` for each of the 20 canonical residues, complete SP | fraction |
| `global_gravy` | Mean Kyte–Doolittle hydropathy, complete SP | scale units [1] |
| `global_entropy` | `-sum(p(a)*log2(p(a)))`, ignoring zero frequencies | bits; composition entropy, not evolutionary information |
| `global_net_charge` | `count(KR)-count(DE)`, complete SP | residue-count proxy; no pH, histidine or terminal charges |
| `global_aromaticity` | `count(FWY)/L`, complete SP | fraction; declared residue-set convention |
| `global_aliphatic_index` | `100*(count(A)+2.9*count(V)+3.9*count(IL))/L` | index [6]; coefficients retained |
| `h_mean_hydrophobicity`, `n_hydrophobicity`, `c_mean_hydrophobicity` | Mean Kyte–Doolittle values over H, N, C respectively | scale units [1] |
| `n_positive_charge` | `count(KR)` over N | residue count |
| `c_polarity`, `c_region_polarity` | `count(STNQ)/L` over C; fractional-mode exception above | fraction; declared set, not a polarity scale |
| `cleavage_small_neutral`, `small_neutral_minus_three_minus_one` | 1 if both -3 and -1 of supplied SP are in AGSC; 0 otherwise | redundant indicators; package convention [7] |
| `minus_three_residue`, `minus_one_residue` | Third-last and last residue of supplied SP | categorical; conditional on correct SP endpoint |
| `minus_three_small`, `minus_one_small` | Membership of -3 or -1 in AGSC | 0/1; package convention |
| `pro_gly_fraction` | `count(PG)/L`, complete SP | fraction |
| `n_charge_density` | `(count(KR)-count(DE))/L` over N | proxy per residue |
| `n_acidic_count` | `count(DE)` over N | residue count |
| `c_charge` | `count(KR)-count(DE)` over C | residue-count proxy |
| `h_max_local_hydrophobicity` | Maximum mean KD over all overlapping length `min(5,L_H)` windows of H | scale units; width 5 is a package choice |
| `h_hydrophobic_moment` | `abs(sum(h_j*exp(2*pi*i*j/3.6)))/L_H`, KD values in H | scale units; period 3.6 is an idealized helix [2] |
| `h_helix_propensity` | Mean Chou–Fasman alpha-helix frequency, H | dimensionless [3]; not predicted helix probability |
| `h_helix_breaker_fraction` | `count(PG)/L` over H | fraction; declared heuristic |
| `h_aromatic_fraction` | `count(FWY)/L` over H | fraction |
| `h_aliphatic_fraction` | `count(AVIL)/L` over H | fraction |
| `h_transmembrane_like_fraction` | `count(AILMFWVY)/L` over H | fraction; declared set, not a membrane classifier |
| `h_to_c_hydrophobicity_drop` | mean KD(H) minus mean KD(C) | scale units |
| `n_to_h_hydrophobicity_rise` | mean KD(H) minus mean KD(N) | scale units |
| `mean_hessa_sec61_dg` | Mean of the 20 stored Hessa residue values over H | kcal/mol per-residue scale average [4]; not segment insertion energy |
| `insertion_score` | Negative of `mean_hessa_sec61_dg` | redundant convenience transform; not insertion probability |
| `kidera_f1_mean` … `kidera_f10_mean` | Mean of factor 1…10 over complete SP | standardized factor units [5] |
| `kidera_f1_std` … `kidera_f10_std` | Population standard deviation (`ddof=0`) of factor values over complete SP | factor units [5] |

The charge, composition, window and residue-set choices are transparent definitions,
not independent biological validation. Several columns are exact duplicates or simple
transforms. Feature selection and statistical collinearity handling remain part of the
researcher's analysis. Means are composition summaries; hydrophobic moment and local
windows add some order dependence, but do not reconstruct a structure.

### Sources and numerical verification status

1. Kyte & Doolittle (1982), https://doi.org/10.1016/0022-2836(82)90515-0.
   All 20 stored values checked against independent AAindex `KYTJ820101` extraction.
2. Eisenberg, Weiss & Terwilliger (1984), https://doi.org/10.1073/pnas.81.1.140.
   This package applies the moment formula to KD hydropathy; do not describe it as
   an exact reproduction of a published Eisenberg-scale implementation.
3. Chou & Fasman, https://pubmed.ncbi.nlm.nih.gov/364941/.
   All 20 helix coefficients checked against AAindex `CHOP780201`.
4. Hessa et al. (2005), https://doi.org/10.1038/nature03216.
   The previous `nature06502` citation identified an Arctic-climate paper and was
   incorrect. The stored coefficients are retained. A complete independent check
   against the original supplemental table is still outstanding. The 2007
   position-dependent model (https://doi.org/10.1038/nature06387) is not implemented.
5. Kidera et al. (1985), https://doi.org/10.1007/BF01025492.
   Factor 4's 20 values checked against AAindex `KIDA850101`. The other nine factors
   remain source-attributed but not independently table-verified in this change.
6. Ikai (1980), https://pubmed.ncbi.nlm.nih.gov/7462208/.
   The existing 2.9/3.9 weights are retained, without a new independent table check.
7. von Heijne (1983), https://doi.org/10.1111/j.1432-1033.1983.tb07424.x,
   provides cleavage-region context. The package's exact AGSC set and binary outputs
   are descriptive conventions, not a reproduction of a cleavage predictor.

The independent AAindex fixture is downloaded separately from the implementation;
its URL, retrieval date and whole-download SHA-256 are in
`tests/fixtures/aaindex_reference.json`. Tests are offline. Database agreement establishes
transcription consistency, not biological predictive validity or licensing clearance.

## Annotation sensitivity and mutation effects

`boundary_sensitivity(sequence, annotations)` reports min, max and span of each
numeric feature across the supplied alternatives. The alternatives need not form a
statistical sample. Extrema are **not confidence or credible intervals**.

`mutation_effects` enumerates single-residue substitutions, holding the sequence length
and each annotation's coordinates fixed. For feature f and annotation a:

`delta(a) = f(mutant, a) - f(original, a)`.

Only after pairing does it compute `delta_min` and `delta_max` over a. Subtracting
separately pooled extrema would compare different annotations and is not used.

| `direction` | Exact numerical rule |
|---|---|
| `increase_all` | Every supplied delta is strictly positive |
| `decrease_all` | Every supplied delta is strictly negative |
| `unchanged_all` | Every supplied delta is exactly zero |
| `annotation_dependent` | All other cases, including zero in some annotations and a nonzero effect in others |

This classification applies to stored floating-point values, without an effect-size
threshold. Very small nonzero differences can reflect rounding; inspect magnitudes
and set a stated scientific threshold in downstream analysis where appropriate.
No equal weighting, p-value, probability of improvement, or claim of robust secretion
is attached. The method does not recompute a biological cleavage predictor after a
mutation. Large changes may invalidate the original annotations; that needs separate
annotation and experimental work.

## Composition controls, profiles, and double-mutant cycles

`residue_profiles` exposes each stored residue-scale value and its annotation-specific
N/H/C membership. Positions are one-based; no smoothing, structural inference or
cleavage prediction is performed.

`composition_controls` draws composition-preserving permutations with a local
`random.Random(seed)` generator. Each draw shuffles a fresh copy of the original;
draws are with replacement. Duplicate and unchanged samples are kept and explicitly
marked. Global composition descriptors should stay unchanged up to floating-point
rounding; regional descriptors and order-sensitive formulas may change. Each numeric
descriptor is reported for the original and control under the same annotation.
Permutations are a diagnostic for descriptor order dependence, not biologically
plausible alternative SPs or a validated statistical null. No p-value is calculated.

`interaction_effects` accepts caller-selected pairs of substitutions at different
positions. With matching annotation a, it reports single-mutant changes, the double
change and `interaction = f(AB,a)-f(A,a)-f(B,a)+f(WT,a)`. A nonzero result can arise
entirely from a nonlinear descriptor formula. It is not evidence of biological
epistasis, cooperative folding or improved secretion. Pair order does not change
the result; unchanged residues, invalid positions and duplicated pairs are rejected.

Pair CSV columns: `sequence_id,position_a,residue_a,position_b,residue_b`; residues
are uppercase canonical letters and positions are one-based. CLI pair mode uses
explicit annotations and the interpretable preset. Each FASTA ID must have pairs.

### Hand-checkable example

`MKALLLSAAA` has H `ALLL` under `(2,6)`, and H `LLL` under `(3,6)`.
For A3L, KD values A=1.8 and L=3.8 give:

| Descriptor | Annotation `(2,6)` delta | Annotation `(3,6)` delta | Interpretation |
|---|---:|---:|---|
| H mean hydropathy | `(3.8-1.8)/4 = 0.5` | 0 | depends on whether position 3 is in H |
| Complete-SP mean hydropathy | `(3.8-1.8)/10 = 0.2` | 0.2 | increases under both alternatives |

The example is a synthetic arithmetic case, not an experimentally measured SP or a
recommendation to make this mutation. Its values are independently asserted in tests.

## Provenance and publication reporting

The CLI preserves normalized sequence, description, sequence SHA-256, package version,
implementation SHA-256, region coordinates and annotation source. Mutation tables also
carry the complete annotation set as JSON. CSV ordering follows input order, annotation
order, position order, and alphabetical alternative residues. A fresh CSV is staged
before publication; input failure preserves an existing destination and emits no
partial stdout table. Successful file output replaces an existing destination.

For a Methods section, specify package version **and commit or implementation hash**,
the feature subset and scale references, the SP endpoint/source, normalization, region
mode, annotation source/conversion, and any downstream selection or validation.
The original software has no associated methods publication or minted DOI; cite the
repository version/commit and original scale publications. Do not invent a software DOI.

The v0.2 work adds software verification, source checks and descriptive diagnostics.
There is no experimental benchmark, secretion-yield validation or demonstrated
advantage over other feature libraries. These remain open research questions.
