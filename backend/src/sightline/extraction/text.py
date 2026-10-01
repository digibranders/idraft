"""Text normalization for alias matching (docs/13-ai-extraction-engine.md stage 4).

Aliases and answers go through the same function, so they compare directly, and every
normalized character remembers the original characters it came from, so a match found in the
normalized text is reported at its place in the text as it was sent.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Final

_ZERO_WIDTH: Final = frozenset(
    "\N{ZERO WIDTH SPACE}\N{ZERO WIDTH NON-JOINER}\N{ZERO WIDTH JOINER}\N{WORD JOINER}"
    "\N{ZERO WIDTH NO-BREAK SPACE}\N{SOFT HYPHEN}"
)
# Curly quotes, primes and dashes become their ASCII forms.
_PUNCTUATION: Final = str.maketrans(
    {
        "\N{LEFT SINGLE QUOTATION MARK}": "'",
        "\N{RIGHT SINGLE QUOTATION MARK}": "'",
        "\N{SINGLE LOW-9 QUOTATION MARK}": "'",
        "\N{SINGLE HIGH-REVERSED-9 QUOTATION MARK}": "'",
        "\N{PRIME}": "'",
        "\N{LEFT DOUBLE QUOTATION MARK}": '"',
        "\N{RIGHT DOUBLE QUOTATION MARK}": '"',
        "\N{DOUBLE LOW-9 QUOTATION MARK}": '"',
        "\N{DOUBLE HIGH-REVERSED-9 QUOTATION MARK}": '"',
        "\N{DOUBLE PRIME}": '"',
        "\N{HYPHEN}": "-",
        "\N{NON-BREAKING HYPHEN}": "-",
        "\N{FIGURE DASH}": "-",
        "\N{EN DASH}": "-",
        "\N{EM DASH}": "-",
        "\N{HORIZONTAL BAR}": "-",
        "\N{MINUS SIGN}": "-",
    }
)


@dataclass(frozen=True, slots=True)
class NormalizedText:
    text: str
    # For each character of `text`, the original characters it came from: [start, end).
    starts: tuple[int, ...]
    ends: tuple[int, ...]

    def original_span(self, start: int, end: int) -> tuple[int, int]:
        """The original range that normalized characters [start, end) came from."""
        if not 0 <= start < end <= len(self.text):
            raise ValueError(f"not a span of the normalized text: [{start}, {end})")
        return self.starts[start], self.ends[end - 1]


def normalize(text: str, *, fold_case: bool) -> NormalizedText:
    """NFKC compatibility forms, diacritics removed, ASCII quotes and dashes, no zero-width
    characters, whitespace runs as one space, and case folded when asked.

    Each original character is normalized on its own (decomposed, then its combining marks
    dropped), so a character's output never depends on its neighbours and offsets stay exact.
    """
    out: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    for index, char in enumerate(text):
        if char in _ZERO_WIDTH:
            continue
        if char.isspace():
            if out and out[-1] == " ":
                ends[-1] = index + 1  # the one space stands for the whole run
            else:
                out.append(" ")
                starts.append(index)
                ends.append(index + 1)
            continue
        for piece in _fold(char.translate(_PUNCTUATION), fold_case=fold_case):
            if piece.isspace() and out and out[-1] == " ":
                ends[-1] = index + 1
                continue
            out.append(" " if piece.isspace() else piece)
            starts.append(index)
            ends.append(index + 1)
    return NormalizedText("".join(out), tuple(starts), tuple(ends))


def _fold(char: str, *, fold_case: bool) -> str:
    decomposed = unicodedata.normalize("NFKD", char)
    if fold_case:
        # Folding can bring marks back (U+0130 folds to i and a combining dot).
        decomposed = unicodedata.normalize("NFKD", decomposed.casefold())
    return "".join(piece for piece in decomposed if not unicodedata.combining(piece))
