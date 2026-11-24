"""Stage 9 of docs/13-ai-extraction-engine.md: does the answer recommend the own brand.

Rules over the units (`answer_text.split_units`) that hold an own-brand span. A unit speaks for the
brand when one of these holds:

- it is an item of a list that a suggestion line introduces ("the best providers:", "options to
  consider"), the brand opens the item, and the item is in the first three places of a numbered
  list, or is in an unnumbered one;
- it holds an endorsement cue that points at the brand: a verb cue before it ("we recommend",
  "go with", "our top pick is") or a predicate cue after it ("is a great choice", "ideal for",
  "best", "leading"), with no competitor in between unless the names are joined by "and" or a comma.

It speaks against the brand when it holds a negative cue ("avoid", "not recommended", "not a good
fit", "lacks", "too expensive for"), or when the brand only serves as the baseline of a comparison
("unlike", "compared with", "alternatives to", "instead of"). The answer recommends the brand when
a unit speaks for it and none speaks against it; a conflict is not a recommendation (the model
stage that would settle it, stage 11, is not built). An answer that does not name the brand does
not recommend it. A prompt that is itself about the brand ("Is Acme good?") is not told apart:
branded prompts are left out of the rates by default.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Final

from idraft.extraction.answer_text import Unit, split_units, unit_of

# Raise it with every change to the rules, so facts can be derived again.
RECOMMENDATION_VERSION: Final = 1
Span = tuple[int, int]

_TOP_PLACES: Final = 3
# How far from the start of the item the brand may sit and still be its subject.
_SUBJECT_REACH: Final = 60
# How far apart a cue and the brand may be.
_CUE_REACH: Final = 80
_INTRO: Final = re.compile(
    r"\b(?:best|top|recommended?|options?|alternatives?|consider|providers?|vendors?|companies|"
    r"firms?|services?|choices?|picks?|players?|solutions?|leading|tools?)\b",
    re.IGNORECASE,
)
_NEGATIVE: Final = re.compile(
    r"\bavoid\b|\bnot recommended\b|\b(?:wouldn't|would not|don't|do not) recommend\b|"
    r"\b(?:isn't|is not|aren't|are not|not)\s+(?:\w+\s+)?(?:a\s+|the\s+)?"
    r"(?:good|great|ideal|best|right|suitable|worth|recommended)\b|"
    r"\blacks?\b|\bfalls? short\b|\btoo (?:expensive|costly) for\b|\bshould(?:n't| not)\b",
    re.IGNORECASE,
)
_BASELINE: Final = re.compile(
    r"\b(?:unlike|compared (?:to|with)|alternatives? to|instead of|rather than|versus|vs\.?|than|"
    r"similar to|competitors? (?:such as|like)|outperforms?|beats?)\b[^.;:]*$",
    re.IGNORECASE,
)
_VERB_CUES: Final = re.compile(
    r"\b(?:(?:we|i)(?:'d|\s+would)?\s+(?:highly\s+|strongly\s+|also\s+)?(?:recommend|suggest)|"
    r"go(?:ing)? with|opt for|your best bet(?: is)?|"
    r"(?:our|my|the|a)\s+(?:top|best)\s+(?:pick|choice|option)s?\s+(?:is|are|would be)|"
    r"(?:my|our)\s+(?:pick|recommendation)s?\s+(?:is|are))\b",
    re.IGNORECASE,
)
_PREDICATE_CUES: Final = re.compile(
    r"\b(?:(?:is|are|remains)\s+(?:\w+\s+){0,2}?(?:a|an|the|our)\s+(?:\w+\s+){0,2}?"
    r"(?:top|best|great|solid|strong|good|excellent|leading|ideal|trusted|reliable|premier|"
    r"standout|preferred)|ideal for|best for|best suited|well suited|great for|stands? out|"
    r"(?:is|are) (?:highly )?recommended|highly (?:rated|recommended)|top[- ]rated|"
    r"best[- ]in[- ]class|market leader|best|leading|top)\b",
    re.IGNORECASE,
)
# What may lie between a name and its cue when the cue still speaks for both names.
_JOINT: Final = re.compile(
    r"^(?:[\s,&/*_()\-]|and|or|plus|as well as|both|are|is|the|a|an|also|all|these|those|our|"
    r"among|of|top|best)*$",
    re.IGNORECASE,
)


def is_recommended(
    text: str, own_spans: Sequence[Span], competitor_spans: Sequence[Span] = ()
) -> bool:
    """Whether `text` recommends the own brand named at `own_spans`. `text` should have its link
    targets blanked, so that a URL word is not a cue."""
    if not own_spans:
        return False
    units = split_units(text)
    spans_by_unit: dict[int, tuple[Unit, list[Span]]] = {}
    for span in own_spans:
        unit = unit_of(units, span[0])
        if unit is not None:
            spans_by_unit.setdefault(unit.start, (unit, []))[1].append(span)
    verdicts = [
        _verdict(text, unit, spans, competitor_spans) for unit, spans in spans_by_unit.values()
    ]
    return 1 in verdicts and -1 not in verdicts


def _verdict(text: str, unit: Unit, spans: list[Span], competitors: Sequence[Span]) -> int:
    """1 for the brand, -1 against, 0 neither, for one unit and the brand's spans in it."""
    if _NEGATIVE.search(unit.text):
        return -1
    if all(_BASELINE.search(text[unit.start : start]) for start, _ in spans):
        return 0
    inside = [c for c in competitors if unit.start <= c[0] < unit.end]
    if any(_endorsed(text, unit, span, inside) for span in spans):
        return 1
    if unit.kind == "item" and _suggested_item(unit, spans):
        return 1
    return 0


def _suggested_item(unit: Unit, spans: list[Span]) -> bool:
    if unit.intro is None or _INTRO.search(unit.intro) is None:
        return False
    if unit.place is not None and unit.place > _TOP_PLACES:
        return False
    return any(start - unit.content_start <= _SUBJECT_REACH for start, _ in spans)


def _endorsed(text: str, unit: Unit, span: Span, competitors: Sequence[Span]) -> bool:
    start, end = span
    before = text[unit.start : start]
    after = text[end : unit.end]
    for cue in _VERB_CUES.finditer(before):
        if start - cue.end() <= _CUE_REACH and _joined(text, cue.end(), start, competitors):
            return True
    for cue in _PREDICATE_CUES.finditer(after):
        if cue.start() <= _CUE_REACH and _joined(text, end, end + cue.start(), competitors):
            return True
    return False


def _joined(text: str, begin: int, stop: int, competitors: Sequence[Span]) -> bool:
    """Whether the stretch from `begin` to `stop` holds no competitor, or only competitors the
    own brand is listed with."""
    rest = text[begin:stop]
    between = [c for c in sorted(competitors, reverse=True) if begin <= c[0] and c[1] <= stop]
    if not between:
        return True
    for c_start, c_end in between:
        rest = rest[: c_start - begin] + " " + rest[c_end - begin :]
    return _JOINT.match(rest) is not None
