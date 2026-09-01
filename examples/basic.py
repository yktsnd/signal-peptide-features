from signal_peptide_features import interpretable_sp_features

if __name__ == "__main__":
    features = interpretable_sp_features("MKWVTFISLLFLFSSAYS")
    print({key: features[key] for key in ("sp_length", "h_mean_hydrophobicity", "insertion_score")})
