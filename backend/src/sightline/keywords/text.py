"""Keyword text (docs/08-seo-keyword-system.md sections 1 and 3.3).

The normalized form decides when two entries are the same keyword: Unicode NFKC, invisible
format characters removed, lower case, whitespace trimmed and collapsed. Lower case, not case
folding, since a German "Straße" and "Strasse" are two searches. The provider receives the text
as first entered, cleaned of what no search means (invisible characters, runs of whitespace).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final, Literal

KEYWORD_MAX: Final = 700

# Google search operators: a keyword with one is a different search (and a costlier one), not
# a ranking to track. Read on the normalized text, so full-width look-alikes count too. An
# operator is the word, a colon and at once a value ("site:acme.com"); "contact info: phone"
# is ordinary text. The `allin` family may take a space after its colon.
_OPERATOR = re.compile(
    r"(?:^|\s)(?:"
    r"(?:after|before|cache|daterange|define|ext|filetype|inanchor|info|intext|intitle|inurl|"
    r"link|related|site|source):\S"
    r"|allin(?:anchor|text|title|url):"
    r")"
)
# A word excluded with a minus after another word: "crm -free". A leading minus ("-40
# fahrenheit", "-webkit-appearance") and a hyphen inside a word ("k-pop") are not exclusions.
_EXCLUSION = re.compile(r"\S\s+-[^\s\d]")
# An exact-phrase search is a pair of quotes; one quote ("24\" monitor") is an inch mark.
_QUOTES = frozenset('"\N{LEFT DOUBLE QUOTATION MARK}\N{RIGHT DOUBLE QUOTATION MARK}')

RefusalCode = Literal[
    "keyword_missing", "keyword_invalid", "keyword_too_long", "search_operator_not_allowed"
]


class KeywordRefusedError(ValueError):
    """A keyword that cannot be tracked, with the code the API and imports report."""

    def __init__(self, code: RefusalCode, message: str) -> None:
        super().__init__(message)
        self.code: RefusalCode = code


def _visible(text: str) -> str:
    """Without format characters (zero-width spaces, a byte order mark, direction marks)."""
    return "".join(char for char in text if unicodedata.category(char) != "Cf")


def normalize(text: str) -> str:
    composed = unicodedata.normalize("NFKC", text)
    # Lower case can leave a sequence NFKC composes ("İ" becomes "i" and a combining dot), so
    # the result is composed again, which makes normalizing twice change nothing.
    return unicodedata.normalize("NFKC", " ".join(_visible(composed).lower().split()))


def check_keyword(text: str) -> str:
    """The keyword as it will be stored and sent: format characters removed, whitespace trimmed
    and collapsed, casing kept. Refused when it cannot be tracked."""
    if any(unicodedata.category(char) in ("Cc", "Cs") and not char.isspace() for char in text):
        raise KeywordRefusedError("keyword_invalid", "A keyword has no control characters.")
    cleaned = " ".join(_visible(text).split())
    normalized = normalize(cleaned)
    if not normalized:
        raise KeywordRefusedError("keyword_missing", "A keyword has at least one character.")
    if len(cleaned) > KEYWORD_MAX:
        raise KeywordRefusedError(
            "keyword_too_long", f"A keyword has at most {KEYWORD_MAX} characters."
        )
    if (
        _OPERATOR.search(normalized)
        or _EXCLUSION.search(normalized)
        or sum(char in _QUOTES for char in normalized) >= 2
    ):
        raise KeywordRefusedError(
            "search_operator_not_allowed",
            "Search operators (site:, intitle:, a quoted phrase, a word excluded with a minus) "
            "are not tracked.",
        )
    return cleaned
