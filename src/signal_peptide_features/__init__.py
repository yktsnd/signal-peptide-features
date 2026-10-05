"""Pure sequence-derived feature functions for signal peptides."""

from .analysis import analyze_sequence
from .charge import charge_features
from .cleavage import cleavage_features
from .composition import amino_acid_composition, sequence_entropy
from .controls import Substitution, composition_controls, interaction_effects, residue_profiles
from .embeddings import mean_pool, multiscale_pool, region_pool
from .fasta import FastaRecord, read_fasta
from .feature_sets import basic_sp_features, interpretable_sp_features
from .hydrophobicity import hydrophobic_moment, mean_hydrophobicity
from .insertion import insertion_features
from .kidera import kidera_summary
from .regions import normalize_sequence, split_by_boundaries, split_fractional_regions
from .sensitivity import RegionAnnotation, boundary_sensitivity, mutation_effects

__all__ = [
    "analyze_sequence",
    "Substitution",
    "composition_controls",
    "interaction_effects",
    "residue_profiles",
    "RegionAnnotation",
    "boundary_sensitivity",
    "mutation_effects",
    "FastaRecord",
    "read_fasta",
    "amino_acid_composition",
    "basic_sp_features",
    "charge_features",
    "cleavage_features",
    "hydrophobic_moment",
    "insertion_features",
    "interpretable_sp_features",
    "kidera_summary",
    "mean_hydrophobicity",
    "mean_pool",
    "multiscale_pool",
    "normalize_sequence",
    "region_pool",
    "sequence_entropy",
    "split_by_boundaries",
    "split_fractional_regions",
]
