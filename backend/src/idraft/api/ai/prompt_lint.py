"""The lint rules that read a prompt's text alone (contract C1, `LintWarning.rule`): the
competitor name, leading wording, more than one question, the word count and the language.

Pure: no database, no matcher. The caller hands over the names the matcher found (offsets in
code points) and the language the prompt is set to; findings come back with spans in UTF-16 code
units, as a JavaScript string indexes the text.
"""

from __future__ import annotations

import math
import re
import unicodedata
from bisect import bisect_right
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Final

from idraft.api.schemas.ai import LintRule, LintSeverity

WORDS_MIN: Final = 5
WORDS_MAX: Final = 60
# A superlative this many words or fewer from a name leads the answer.
LEADING_DISTANCE: Final = 3
# A shorter text is too short to tell its language.
MISMATCH_MIN_WORDS: Final = 4
# Percent of the letters in scripts the language does not use.
FOREIGN_LETTERS_PERCENT: Final = 60
# Another language's function words must hit this many times more than the set language's, and
# so at least this many times.
FUNCTION_WORD_MARGIN: Final = 2

_TOKEN: Final = re.compile(r"\S+")
_QUESTION_RUN: Final = re.compile("[?\U0000ff1f\U0000061f]+")
_COMPARISON: Final = re.compile(r"(?<!\w)(?:vs\.?|versus)(?!\w)", re.IGNORECASE)
_SUPERLATIVE: Final = re.compile(
    r"(?<![\w#])(?:best|top|leading|greatest|number\s+one|#1)(?!\w)", re.IGNORECASE
)
# Sentence ending punctuation: ASCII, fullwidth, ideographic and Arabic.
_SENTENCE_END: Final = ".?!\U0000ff1f\U0000ff01\U00003002\U0000061f"
# "why is <words> the best" inside one sentence; the group is the superlative.
_WHY_IS_BEST: Final = re.compile(
    rf"(?<!\w)why\s+is\s+[^\s{_SENTENCE_END}][^{_SENTENCE_END}]*?\s+the\s+(best)(?!\w)",
    re.IGNORECASE,
)
_LETTERS: Final = re.compile(r"[^\W\d_]+")
_NAME_WORDS: Final = re.compile(r"[A-Z]+")

# Scripts whose words are not separated by spaces: a token counts half its characters.
_UNSPACED: Final = frozenset({"HAN", "HIRAGANA", "KATAKANA", "THAI", "LAO", "KHMER", "MYANMAR"})

# The scripts each language is written in; a language not listed is not checked.
_SCRIPTS: Final[Mapping[str, frozenset[str]]] = {
    code: frozenset(names.split())
    for codes, names in (
        ("en de fr es it pt nl sv da no nb fi pl cs sk hu ro tr id vi ca", "LATIN"),
        ("ru uk bg be mk kk", "CYRILLIC"),
        ("sr", "CYRILLIC LATIN"),
        ("ja", "HAN HIRAGANA KATAKANA"),
        ("zh", "HAN"),
        ("ko", "HANGUL HAN"),
        ("ar fa ur", "ARABIC"),
        ("he", "HEBREW"),
        ("el", "GREEK"),
        ("th", "THAI"),
        ("hi", "DEVANAGARI"),
    )
    for code in codes.split()
}

_LANGUAGES: Final[Mapping[str, str]] = {
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "ru": "Russian",
    "uk": "Ukrainian",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "ar": "Arabic",
    "he": "Hebrew",
    "el": "Greek",
    "th": "Thai",
    "hi": "Hindi",
}

# shortcut: function words cover English and six Latin languages (de, fr, es, it, pt, nl), and
# the superlatives are English; add a list per language when those markets are sold.
_FUNCTION_WORDS: Final[Mapping[str, frozenset[str]]] = {
    code: frozenset(words.split())
    for code, words in {
        "en": "the is are were of and to for with what which how why when where who that this "
        "these those does did can could should would you your we they it not be from by about "
        "than",
        "de": "der die das ist und zu nicht ein eine einer einen mit f\U000000fcr von welche "
        "welcher welches wie warum wer wo auf im den dem des sich wir ich oder bei aus sind "
        "kann wird",
        "fr": "le la les un une des du de et est sont pas pour dans que qui quoi quel quelle "
        "quels quelles comment pourquoi avec sur par au aux ce cette ces vous nous je il elle "
        "ou o\U000000f9 en",
        "es": "de y en lo mi el la los las un una unos unas es son para por con que "
        "qu\U000000e9 cu\U000000e1l cu\U000000e1les c\U000000f3mo qui\U000000e9n d\U000000f3nde "
        "cu\U000000e1ndo del al se su sus esta este",
        "it": "e il lo la le gli un una uno di del della dei che per con non sono come quale "
        "quali cosa \U000000e8 nel nella sul anche questo questa perch\U000000e9 dove quando chi",
        "pt": "e a o os um uma de do da dos das que para com n\U000000e3o por em mais como qual "
        "quais voc\U000000ea \U000000e9 s\U000000e3o ao na nos ele ela",
        "nl": "de het een en van voor niet met op dat die wat welke hoe waarom wie waar zijn ik je "
        "jij wij ook naar bij aan uit kan wordt deze",
    }.items()
}


@dataclass(frozen=True, slots=True)
class Named:
    """An own or competitor name the matcher found: its accepted places, as code point offsets in
    text order."""

    name: str
    is_competitor: bool
    spans: tuple[tuple[int, int], ...]


@dataclass(frozen=True, slots=True)
class Finding:
    rule: LintRule
    severity: LintSeverity
    message: str
    # UTF-16 code units.
    span: tuple[int, int] | None


@lru_cache(maxsize=4096)
def _script(char: str) -> str | None:
    """The script a character belongs to: the first word of its Unicode name."""
    words = _NAME_WORDS.findall(unicodedata.name(char, ""))
    if words and words[0] in {"FULLWIDTH", "HALFWIDTH"}:
        words = words[1:]
    if not words:
        return None
    return "HAN" if words[0] == "CJK" else words[0]


def count_words(text: str) -> int:
    """White space tokens; a token holding a character of a script written without spaces
    counts half its characters, rounded up."""
    return sum(
        math.ceil(len(token) / 2) if any(_script(char) in _UNSPACED for char in token) else 1
        for token in text.split()
    )


def is_comparison(text: str) -> bool:
    """A word bounded `vs`, `vs.` or `versus`."""
    return _COMPARISON.search(text) is not None


def _utf16(text: str, start: int, end: int) -> tuple[int, int]:
    """A span in code points as UTF-16 code units; each character past U+FFFF is two units."""
    wide_before_start = sum(1 for char in text[:start] if ord(char) > 0xFFFF)
    wide_inside = sum(1 for char in text[start:end] if ord(char) > 0xFFFF)
    return start + wide_before_start, end + wide_before_start + wide_inside


def _competitors(text: str, named: Sequence[Named]) -> list[Finding]:
    comparison = is_comparison(text)
    return [
        Finding(
            rule="contains_competitor_alias",
            severity="info" if comparison else "warning",
            message=f"Compares with {item.name}."
            if comparison
            else f"Names {item.name}. A competitor named in the prompt is likely to be named in "
            "the answer.",
            span=_utf16(text, *item.spans[0]),
        )
        for item in named
        if item.is_competitor and item.spans
    ]


def _leading(text: str, named: Sequence[Named]) -> Finding | None:
    """The first superlative within `LEADING_DISTANCE` words of a name, or the pattern "why is
    <words> the best"."""
    starts = [token.start() for token in _TOKEN.finditer(text)]

    def word(index: int) -> int:
        return bisect_right(starts, index) - 1

    def near_a_name(start: int, end: int) -> bool:
        for item in named:
            for name_start, name_end in item.spans:
                if name_start < end and start < name_end:
                    continue  # the superlative is part of the name
                gap = (
                    word(name_start) - word(end - 1)
                    if end <= name_start
                    else word(start) - word(name_end - 1)
                )
                if gap <= LEADING_DISTANCE:
                    return True
        return False

    spans = [
        found.span()
        for found in _SUPERLATIVE.finditer(text)
        if near_a_name(found.start(), found.end())
    ]
    pattern = _WHY_IS_BEST.search(text)
    if pattern is not None:
        spans.append(pattern.span(1))
    if not spans:
        return None
    return Finding(
        rule="leading_wording",
        severity="warning",
        message="The wording leads the answer. It measures agreement, not visibility.",
        span=_utf16(text, *min(spans)),
    )


def _questions(text: str) -> Finding | None:
    if len(_QUESTION_RUN.findall(text)) <= 1:
        return None
    return Finding(
        rule="multiple_questions",
        severity="warning",
        message="Asks more than one question. Answers to it will mix them.",
        span=None,
    )


def _length(text: str) -> Finding | None:
    words = count_words(text)
    if WORDS_MIN <= words <= WORDS_MAX:
        return None
    return Finding(
        rule="word_count",
        severity="warning",
        message=f"Has {words} {'word' if words == 1 else 'words'}. Prompts of {WORDS_MIN} to "
        f"{WORDS_MAX} words read like real questions.",
        span=None,
    )


def _foreign_script(text: str, scripts: frozenset[str]) -> str | None:
    """The most common script outside `scripts`, when those letters are at least
    `FOREIGN_LETTERS_PERCENT` of all."""
    letters: Counter[str] = Counter()
    for char in text:
        script = _script(char)
        if script is not None and unicodedata.category(char)[0] == "L":
            letters[script] += 1
    foreign = Counter({name: count for name, count in letters.items() if name not in scripts})
    if not foreign or sum(foreign.values()) * 100 < FOREIGN_LETTERS_PERCENT * letters.total():
        return None
    return foreign.most_common(1)[0][0]


def _foreign_language(text: str, language_code: str) -> str | None:
    """The language, of the seven with function words, whose words the text uses at least
    `FUNCTION_WORD_MARGIN` times more than the set language's, so at least that many times."""
    if language_code not in _FUNCTION_WORDS:
        return None
    seen = Counter(_LETTERS.findall(text.casefold()))
    hits = {
        code: sum(count for word, count in seen.items() if word in words)
        for code, words in _FUNCTION_WORDS.items()
    }
    other = max((code for code in hits if code != language_code), key=hits.__getitem__)
    return other if hits[other] >= hits[language_code] + FUNCTION_WORD_MARGIN else None


def _language(text: str, language_code: str | None) -> Finding | None:
    if language_code is None or count_words(text) < MISMATCH_MIN_WORDS:
        return None
    reads_as: str | None = None
    scripts = _SCRIPTS.get(language_code)
    if scripts is not None:
        script = _foreign_script(text, scripts)
        reads_as = None if script is None else script.title()
    if reads_as is None:
        other = _foreign_language(text, language_code)
        reads_as = None if other is None else _LANGUAGES[other]
    if reads_as is None:
        return None
    return Finding(
        rule="language_mismatch",
        severity="warning",
        message=f"Reads as {reads_as}, and the prompt is set to "
        f"{_LANGUAGES.get(language_code, language_code)}.",
        span=None,
    )


def check(text: str, named: Sequence[Named], language_code: str | None) -> list[Finding]:
    """The findings of the five rules, in the contract's order. `language_code` is the language
    the prompt is set to; left out, `language_mismatch` is not checked."""
    findings = _competitors(text, named)
    for found in (
        _leading(text, named),
        _questions(text),
        _length(text),
        _language(text, language_code),
    ):
        if found is not None:
            findings.append(found)
    return findings
