"""The head search phrase of a prompt: the keyword its search volume is read from.

A prompt is a question to an AI platform ("Who are the best Managed SOC service providers in
India?"); the nearest thing people type into a search engine is its head phrase ("managed soc
service providers india"). It is derived by fixed rules, so no model is asked and nothing costs
money: lower case, question lead-ins and filler words dropped, the place after a last "in" kept,
at most `MAX_WORDS` words in all.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from typing import Final, NamedTuple

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


def _split(text: str) -> tuple[list[str], list[str]]:
    """The informative words of a prompt, as (words before the place, the place words)."""
    words = _WORD.findall(text.casefold())
    place: list[str] = []
    for index in range(len(words) - 1, -1, -1):
        if words[index] == "in":
            tail = [word for word in words[index + 1 :] if word not in _FILLER]
            if 0 < len(tail) <= _PLACE_WORDS:
                place = tail
                words = words[:index]
            break
    return [word for word in words if word not in _FILLER], place


def head_phrase(text: str) -> str | None:
    """The head phrase of a prompt's text; None when no informative word is left."""
    head, place = _split(text)
    phrase = [*head[: MAX_WORDS - len(place)], *place]
    return " ".join(phrase) or None


CORE_MIN_WORDS: Final = 2
CORE_MAX_WORDS: Final = 3
_STEM_MIN: Final = 4
# Words a short phrase can do without: generic verbs and nouns that say nothing about the topic.
_CORE_SKIP: Final = frozenset(
    [
        "companies",
        "company",
        "provide",
        "provides",
        "providing",
        "vs",
        "versus",
        "compare",
        "find",
        "much",
        "choose",
        "leading",
        "work",
        "worth",
        "build",
        "outsource",
    ]
)


def _stem(word: str) -> str:
    """A plural-blind form, for comparing words only: "services" meets "service"."""
    return word[:-1] if len(word) >= _STEM_MIN and word.endswith("s") else word


def informative_words(text: str) -> frozenset[str]:
    """The comparable informative words of a prompt or a keyword."""
    head, place = _split(text)
    return frozenset(_stem(word) for word in [*head, *place])


def core_phrase(text: str) -> str | None:
    """A short search phrase of 2 or 3 informative words: the first words of the subject, then the
    first place word when the prompt names one ("in India"). Numbers and generic words
    ("companies", "provide") are dropped. None when fewer than two words are left."""
    head, place = _split(text)
    head = [word for word in head if not word.isdigit() and word not in _CORE_SKIP]
    words = [*head[: CORE_MAX_WORDS - 1], place[0]] if place else head[:CORE_MAX_WORDS]
    return " ".join(words) if len(words) >= CORE_MIN_WORDS else None


class MeasuredKeyword(NamedTuple):
    """An existing keyword of the project that has a search volume."""

    text: str
    volume: int


def best_measured_keyword(text: str, candidates: Iterable[MeasuredKeyword]) -> str | None:
    """The candidate sharing the most informative words with the prompt: at least 2 shared words,
    or 1 when the keyword is that one word. Ties go to the higher volume, then the shorter one."""
    wanted = informative_words(text)
    best: tuple[tuple[int, int, int, int], str] | None = None
    for candidate in candidates:
        words = informative_words(candidate.text)
        shared = len(words & wanted)
        if shared < CORE_MIN_WORDS and not (len(words) == 1 and shared == 1):
            continue
        rank = (shared, candidate.volume, -len(words), -len(candidate.text))
        if best is None or rank > best[0]:
            best = (rank, candidate.text)
    return None if best is None else best[1]


class KeywordPick(NamedTuple):
    text: str
    """True when the text is an existing keyword that already has a volume."""
    measured: bool


def pick_keyword(text: str, candidates: Sequence[MeasuredKeyword]) -> KeywordPick | None:
    """The keyword a prompt is linked to: the best existing measured keyword, else the short core
    phrase, else None."""
    existing = best_measured_keyword(text, candidates)
    if existing is not None:
        return KeywordPick(existing, True)
    core = core_phrase(text)
    return None if core is None else KeywordPick(core, False)
