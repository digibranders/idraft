"""Keyword text (docs/08-seo-keyword-system.md sections 1 and 3.3).

The normalized form decides when two entries are the same keyword: Unicode NFKC, invisible
format characters removed, lower case, whitespace trimmed and collapsed. Lower case, not case
folding, since a German "Straße" and "Strasse" are two searches. The provider receives the text
as first entered.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final, Literal

KEYWORD_MAX: Final = 700

# Google search operators: a keyword with one is a different search (and a costlier one), not
# a ranking to track.
_OPERATOR = re.compile(
    r"(?:^|\s)(?:allinanchor|allintext|allintitle|allinurl|cache|daterange|ext|filetype|"
    r"inanchor|info|intext|intitle|inurl|link|related|site):",
    re.IGNORECASE,
)
# A word excluded with a leading minus: "crm -free". A hyphen inside a word ("k-pop") is not.
_EXCLUSION = re.compile(r"(?:^|\s)-\S")
# An exact-phrase search.
_QUOTES = frozenset('"\N{LEFT DOUBLE QUOTATION MARK}\N{RIGHT DOUBLE QUOTATION MARK}')

RefusalCode = Literal["keyword_missing", "keyword_too_long", "search_operator_not_allowed"]


class KeywordRefusedError(ValueError):
    """A keyword that cannot be tracked, with the code the API and imports report."""

    def __init__(self, code: RefusalCode, message: str) -> None:
        super().__init__(message)
        self.code: RefusalCode = code


def normalize(text: str) -> str:
    composed = unicodedata.normalize("NFKC", text)
    visible = "".join(char for char in composed if unicodedata.category(char) != "Cf")
    # Lower case can leave a sequence NFKC composes ("İ" becomes "i" and a combining dot), so
    # the result is composed again, which makes normalizing twice change nothing.
    return unicodedata.normalize("NFKC", " ".join(visible.lower().split()))


def check_keyword(text: str) -> str:
    """The keyword as it will be stored and sent, trimmed; refused when it cannot be tracked."""
    trimmed = text.strip()
    if not normalize(trimmed):
        raise KeywordRefusedError("keyword_missing", "A keyword has at least one character.")
    if len(trimmed) > KEYWORD_MAX:
        raise KeywordRefusedError(
            "keyword_too_long", f"A keyword has at most {KEYWORD_MAX} characters."
        )
    if (
        _OPERATOR.search(trimmed)
        or _EXCLUSION.search(trimmed)
        or any(char in _QUOTES for char in trimmed)
    ):
        raise KeywordRefusedError(
            "search_operator_not_allowed",
            "Search operators (site:, intitle:, quotes, a leading minus) are not tracked.",
        )
    return trimmed
