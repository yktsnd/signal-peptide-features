"""Pooling utilities for already computed residue embeddings."""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np


def _array(embedding: np.ndarray) -> np.ndarray:
    array = np.asarray(embedding, dtype=np.float64)
    if array.ndim != 2 or array.shape[0] == 0 or array.shape[1] == 0:
        raise ValueError("embedding must have shape (residues, dimensions)")
    if not np.isfinite(array).all():
        raise ValueError("embedding must contain finite values")
    return array


def mean_pool(embedding: np.ndarray) -> np.ndarray:
    return _array(embedding).mean(axis=0)


def region_pool(embedding: np.ndarray, start: int, end: int) -> np.ndarray:
    array = _array(embedding)
    if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= len(array):
        raise ValueError("region must be a non-empty half-open interval inside embedding")
    return array[start:end].mean(axis=0)


def multiscale_pool(
    embedding: np.ndarray, widths: Iterable[int] = (5, 10, 20)
) -> dict[str, np.ndarray]:
    array = _array(embedding)
    output = {"full": mean_pool(array)}
    for requested_width in widths:
        if not isinstance(requested_width, int) or requested_width <= 0:
            raise ValueError("widths must contain positive integers")
        output[f"n_terminal_{requested_width}"] = region_pool(
            array, 0, min(requested_width, len(array))
        )
    return output
