"""The head search phrase of a prompt: the keyword its search volume is read from.

A prompt is a question to an AI platform ("Who are the best Managed SOC service providers in
India?"); the nearest thing people type into a search engine is its head phrase ("managed soc
service providers india"). It is derived by fixed rules, so no model is asked and nothing costs
money: lower case, question lead-ins and filler words dropped, the place after a last "in" kept,
at most `MAX_WORDS` words in all.
"""

from __future__ import annotations

import re
from typing import Final

MAX_WORDS: Final = 6
# Words that carry no search meaning: question lead-ins, auxiliaries, articles, ranking words.
_FILLER: Final = frozenset(
    [
        "a",
        "an",
        "and",
        "any",
        "are",
        "about",
        "as",
        "at",
        "be",
        "best",
        "by",
        "can",
        "could",
        "do",
        "does",
        "for",
        "from",
        "good",
        "great",
        "has",
        "have",
        "how",
        "i",
        "ideal",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "looking",
        "me",
        "most",
        "my",
        "need",
        "needs",
        "of",
        "offer",
        "offers",
        "on",
        "or",
        "our",
        "please",
        "recommend",
        "recommended",
        "should",
        "some",
        "than",
        "that",
        "the",
        "their",
        "there",
        "these",
        "they",
        "this",
        "those",
        "to",
        "top",
        "us",
        "us",
        "we",
        "well",
        "what",
        "whats",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
    ]
)
_WORD: Final = re.compile(r"[^\W_]+(?:[-'][^\W_]+)*")
_PLACE_WORDS: Final = 3


def head_phrase(text: str) -> str | None:
    """The head phrase of a prompt's text; None when no informative word is left."""
    words = _WORD.findall(text.casefold())
    place: list[str] = []
    for index in range(len(words) - 1, -1, -1):
        if words[index] == "in":
            tail = [word for word in words[index + 1 :] if word not in _FILLER]
            if 0 < len(tail) <= _PLACE_WORDS:
                place = tail
                words = words[:index]
            break
    head = [word for word in words if word not in _FILLER]
    phrase = [*head[: MAX_WORDS - len(place)], *place]
    return " ".join(phrase) or None
