"""Strict, streaming FASTA input without a bioinformatics dependency."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from .regions import normalize_sequence


@dataclass(frozen=True)
class FastaRecord:
    """An identifier, remaining header text, and normalized protein sequence."""

    identifier: str
    description: str
    sequence: str

    def __post_init__(self) -> None:
        if not self.identifier or any(character.isspace() for character in self.identifier):
            raise ValueError("FASTA identifier must be a non-empty token")
        object.__setattr__(self, "sequence", normalize_sequence(self.sequence))


def read_fasta(lines: Iterable[str]) -> Iterator[FastaRecord]:
    """Read wrapped FASTA; reject empty/duplicate IDs and invalid sequences.

    IDs are the first whitespace-delimited header token. Blank lines are
    ignored. Comments, gaps, stop symbols and ambiguous residues are rejected.
    The ID set is retained to prevent ambiguous joins of the resulting table.
    """
    seen: set[str] = set()
    identifier: str | None = None
    description = ""
    chunks: list[str] = []

    def record() -> FastaRecord:
        assert identifier is not None
        try:
            sequence = normalize_sequence("".join(chunks))
        except ValueError as error:
            raise ValueError(f"record {identifier!r}: {error}") from error
        return FastaRecord(identifier, description, sequence)

    for line_number, raw_line in enumerate(lines, 1):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            if identifier is not None:
                yield record()
            header = line[1:].strip().split(maxsplit=1)
            if not header:
                raise ValueError(f"line {line_number}: FASTA header must contain an ID")
            identifier = header[0]
            if identifier in seen:
                raise ValueError(f"line {line_number}: duplicate FASTA ID {identifier!r}")
            seen.add(identifier)
            description = header[1] if len(header) == 2 else ""
            chunks = []
        elif identifier is None:
            raise ValueError(f"line {line_number}: sequence appears before a FASTA header")
        else:
            chunks.append(line)
    if identifier is None:
        raise ValueError("FASTA input contains no records")
    yield record()
