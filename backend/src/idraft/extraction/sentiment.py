"""Stage 10 of docs/13-ai-extraction-engine.md: the tone of the sentences that name the own brand.

Lexicon rules, no model. Each sentence (`answer_text.sentence_at`; a list item is one) that holds
an own-brand span is scored: a positive word or phrase adds to `positive`, a negative one to
`negative`, and a negator (`not`, `never`, `no`, `without`, `n't`) within the three words before
one turns it round. The answer's label comes from the totals over those sentences: both kinds
present is `mixed`, only positive is `positive`, only negative is `negative`, none is `neutral`.
A label is a coarse signal, shown as shares and never as one score (doc 13 stage 10). Own
brand only (decision D-44).

Known limits: irony, comparison ("better than Rival" counts as one positive word), and a tone
that sits in a sentence next to the mention instead of in it.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Final, Literal

from idraft.extraction.answer_text import sentence_at

# Raise it with every change to the lexicon, so facts can be derived again.
SENTIMENT_VERSION: Final = 1
Sentiment = Literal["positive", "neutral", "negative", "mixed"]

_POSITIVE_WORDS: Final = frozenset(
    [
        "best",
        "better",
        "strong",
        "strongest",
        "excellent",
        "great",
        "good",
        "solid",
        "reliable",
        "trusted",
        "leading",
        "leader",
        "reputable",
        "respected",
        "renowned",
        "praised",
        "recommended",
        "robust",
        "comprehensive",
        "mature",
        "proven",
        "established",
        "experienced",
        "skilled",
        "expert",
        "effective",
        "efficient",
        "fast",
        "responsive",
        "innovative",
        "popular",
        "favored",
        "favoured",
        "top",
        "premier",
        "ideal",
        "impressive",
        "outstanding",
        "standout",
        "affordable",
        "flexible",
        "scalable",
        "thorough",
        "transparent",
        "secure",
        "valued",
        "advanced",
        "notable",
        "acclaimed",
        "well-regarded",
        "well-known",
        "highly-rated",
        "top-rated",
        "cost-effective",
        "award-winning",
    ]
)
_NEGATIVE_WORDS: Final = frozenset(
    [
        "worst",
        "worse",
        "weak",
        "weaker",
        "poor",
        "expensive",
        "costly",
        "pricey",
        "slow",
        "limited",
        "lacks",
        "lacking",
        "lack",
        "complaints",
        "complaint",
        "criticized",
        "criticised",
        "concerns",
        "concern",
        "drawback",
        "drawbacks",
        "downside",
        "downsides",
        "unreliable",
        "avoid",
        "risky",
        "outdated",
        "rigid",
        "inflexible",
        "complex",
        "complicated",
        "confusing",
        "unresponsive",
        "overpriced",
        "mixed-reviews",
        "controversial",
        "breach",
        "breached",
        "fined",
        "failed",
        "failure",
        "inconsistent",
        "overrated",
        "disappointing",
        "bad",
        "inadequate",
        "unproven",
    ]
)
_POSITIVE_PHRASES: Final = tuple(
    re.compile(pattern)
    for pattern in (
        r"highly (?:rated|regarded|recommended)",
        r"well (?:regarded|known|suited)",
        r"go-to",
        r"stands? out",
        r"market leader",
        r"best[- ]in[- ]class",
        r"great (?:for|choice)",
        r"good (?:fit|choice)",
        r"strong (?:track record|reputation)",
    )
)
_NEGATED_POSITIVE_PHRASES: Final = tuple(
    re.compile(r"\b(?:not|never|no|without|\w+n't)\s+(?:\w+\s+){0,2}?(?:a |an |the )?" + p.pattern)
    for p in _POSITIVE_PHRASES
)
_NEGATIVE_PHRASES: Final = tuple(
    re.compile(pattern)
    for pattern in (
        r"falls? short",
        r"not recommended",
        r"too expensive",
        r"lack of",
        r"mixed reviews",
        r"poor reviews",
        r"less suitable",
    )
)
_NEGATORS: Final = frozenset(
    [
        "not",
        "no",
        "never",
        "without",
        "isn't",
        "aren't",
        "wasn't",
        "don't",
        "doesn't",
        "cannot",
        "can't",
    ]
)
_WORD: Final = re.compile(r"[a-z][a-z'-]*")
_NEGATION_REACH: Final = 3


def classify_sentiment(text: str, own_spans: Sequence[tuple[int, int]]) -> Sentiment | None:
    """The tone of the sentences that hold an own span, or None when no span is given. `text` should
    have its link targets blanked, so that a URL word is not a sentiment word."""
    if not own_spans:
        return None
    positive = negative = 0
    for begin, stop in {sentence_at(text, start) for start, _ in own_spans}:
        more, less = _score(text[begin:stop].lower())
        positive += more
        negative += less
    if positive and negative:
        return "mixed"
    if positive:
        return "positive"
    if negative:
        return "negative"
    return "neutral"


def _score(unit: str) -> tuple[int, int]:
    positive = negative = 0
    remaining = unit
    for pattern in _NEGATED_POSITIVE_PHRASES:
        negative += len(pattern.findall(remaining))
        remaining = pattern.sub(" ", remaining)
    for pattern in _POSITIVE_PHRASES:
        positive += len(pattern.findall(remaining))
        remaining = pattern.sub(" ", remaining)
    for pattern in _NEGATIVE_PHRASES:
        found = pattern.findall(remaining)
        negative += len(found)
        remaining = pattern.sub(" ", remaining)
    words = _WORD.findall(remaining)
    for index, word in enumerate(words):
        if word in _POSITIVE_WORDS:
            polarity = 1
        elif word in _NEGATIVE_WORDS:
            polarity = -1
        else:
            continue
        before = words[max(0, index - _NEGATION_REACH) : index]
        if any(prior in _NEGATORS or prior.endswith("n't") for prior in before):
            polarity = -polarity
        if polarity > 0:
            positive += 1
        else:
            negative += 1
    return positive, negative
