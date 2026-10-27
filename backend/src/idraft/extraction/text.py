"""Text normalization for alias matching (docs/13-ai-extraction-engine.md stage 4).

Aliases and answers go through the same function, so they compare directly, and every
normalized character remembers the original characters it came from, so a match found in the
normalized text is reported at its place in the text as it was sent.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Final

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
# The combining diacritical mark blocks: accents on Latin, Greek and Cyrillic letters, folded
# away. Other marks (Indic vowel signs and viramas, the kana voicing marks) tell letters apart
# and are kept.
_DIACRITIC_BLOCKS: Final = (
    (0x0300, 0x036F),
    (0x1AB0, 0x1AFF),
    (0x1DC0, 0x1DFF),
    (0x20D0, 0x20FF),
    (0xFE20, 0xFE2F),
)
# Symbols and other numbers separate words: compatibility decomposition would glue `™` onto a
# name as `tm`, and a footnote digit as a digit.
_SEPARATING_CATEGORIES: Final = frozenset({"So", "No"})


@dataclass(frozen=True, slots=True)
class NormalizedText:
    text: str
    # For each character of `text`, the original characters it came from: [start, end). Both
    # never decrease.
    starts: tuple[int, ...]
    ends: tuple[int, ...]

    def original_span(self, start: int, end: int) -> tuple[int, int]:
        """The original range that normalized characters [start, end) came from."""
        if not 0 <= start < end <= len(self.text):
            raise ValueError(f"not a span of the normalized text: [{start}, {end})")
        return self.starts[start], self.ends[end - 1]


def normalize(text: str, *, fold_case: bool) -> NormalizedText:
    """Compatibility forms, Latin, Greek and Cyrillic accents removed, ASCII quotes and dashes,
    no format characters (zero-width, soft hyphen, direction marks), whitespace runs as one
    space, and case folded when asked.

    Each original character is normalized on its own, so a character's output never depends on
    its neighbours and offsets stay exact.
    """
    out: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    for index, char in enumerate(text):
        for piece in _normalized(char, fold_case=fold_case):
            if piece == " " and out and out[-1] == " ":
                ends[-1] = index + 1  # the one space stands for the whole run
                continue
            out.append(piece)
            starts.append(index)
            ends.append(index + 1)
    return NormalizedText("".join(out), tuple(starts), tuple(ends))


def normalize_pattern(pattern: str) -> str:
    """A regex alias written the way the text it runs on is (case kept): each character that is
    not ASCII is normalized as text is, so `Nestl\N{LATIN SMALL LETTER E WITH ACUTE}` finds
    `Nestle`. RE2's own syntax is ASCII and is left alone."""
    return "".join(
        char if char.isascii() else _normalized(char, fold_case=False) for char in pattern
    )


def is_word_character(char: str) -> bool:
    """Letters, digits and the marks that are part of letters (Indic vowel signs)."""
    return char.isalnum() or unicodedata.category(char).startswith("M")


def _normalized(char: str, *, fold_case: bool) -> str:
    category = unicodedata.category(char)
    if category == "Cf":
        return ""
    if category == "Cs":  # a lone surrogate: neither UTF-8 nor RE2 can carry it
        return "\N{REPLACEMENT CHARACTER}"
    if char.isspace() or category in _SEPARATING_CATEGORIES:
        return " "
    decomposed = unicodedata.normalize("NFKD", char.translate(_PUNCTUATION))
    if fold_case:
        decomposed = decomposed.casefold()
    return "".join(
        " " if piece.isspace() else piece for piece in decomposed if not _is_diacritic(piece)
    )


def _is_diacritic(char: str) -> bool:
    code = ord(char)
    return any(low <= code <= high for low, high in _DIACRITIC_BLOCKS)
