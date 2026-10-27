"""Alias matching and disambiguation, stages 4 and 5 (docs/13-ai-extraction-engine.md).

One Aho-Corasick pass over the normalized text finds every alias; user-entered patterns run
through RE2, which is linear in the text whatever the pattern. Spans inside a negative alias are
dropped, each span is scored from what the text alone can tell (plan decision D6: the signals
that need answer structure, citations or the prompt arrive with extraction), the longest of
overlapping spans wins among those not discarded, and a product's span also counts toward its
parent brand.

Offsets are into the text as given, in code points.
"""

from __future__ import annotations

import bisect
import itertools
import re
import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, replace
from typing import Final, Literal

import ahocorasick
import idna
import re2

from idraft.extraction.text import (
    NormalizedText,
    is_word_character,
    normalize,
    normalize_pattern,
)

MatchMode = Literal["word_boundary", "exact_case", "substring", "regex"]
MatchMethod = Literal[
    "alias_word",
    "alias_exact",
    "alias_substring",
    "alias_regex",
    "alias_name",
    "alias_domain",
    "via_product",
]
MentionStatus = Literal["accepted", "uncertain", "discarded"]

_METHOD: Final[dict[MatchMode, MatchMethod]] = {
    "word_boundary": "alias_word",
    "exact_case": "alias_exact",
    "substring": "alias_substring",
    "regex": "alias_regex",
}
# When one entity is matched twice on the same span, the more specific method is kept.
_METHOD_RANK: Final[dict[MatchMethod, int]] = {
    "alias_exact": 0,
    "alias_word": 1,
    "alias_substring": 2,
    "alias_regex": 3,
    "alias_name": 4,
    "alias_domain": 5,
    "via_product": 6,
}
# Plurals allowed before the closing boundary of a word alias. A possessive needs no entry:
# its apostrophe is already a boundary.
_SUFFIXES: Final = ("es", "s")

# More matches than this in one text is refused rather than held in memory: 250,000 is far
# beyond any answer and allows the 100 KB alias test with overlapping one-letter aliases.
MAX_HITS: Final = 250_000
# The largest RE2 program a pattern may compile to. Matching is linear in the text, but its
# constant grows with the program; `[a-z]{1000}` repeated would cost seconds per 100 KB.
MAX_PROGRAM_SIZE: Final = 2_000

# Stage 5 (D6).
_BASE_PLAIN: Final = 0.95
_BASE_NEEDS_CONTEXT: Final = 0.30
_HINT_NEAR: Final = 0.35
_CAPITALIZED: Final = 0.15
_LOWERCASE: Final = -0.25
_HINT_WINDOW_TOKENS: Final = 40
_ACCEPTED_FROM: Final = 0.70
_UNCERTAIN_FROM: Final = 0.40
# What may stand between the start of a sentence or list item and a name that opens it, besides
# whitespace and opening brackets and quotes; and what ends a sentence.
_OPENERS: Final = "\"'*#>-_`|\N{BULLET}"
_OPENING_CATEGORIES: Final = frozenset({"Ps", "Pi"})
_SENTENCE_ENDS: Final = ".!?:\n\N{HORIZONTAL ELLIPSIS}"

_TOKEN: Final = re.compile(r"[^\W_]+")


class InvalidAliasPatternError(ValueError):
    """A regex alias RE2 cannot compile (no backreferences or lookaround, by design), or one
    that compiles to too large a program."""


class TooManyMatchesError(ValueError):
    """The text matched more than `MAX_HITS` times."""


@dataclass(frozen=True, slots=True)
class EntityRule:
    id: uuid.UUID
    # Matched by itself, as a word alias that ignores case (`alias_name`), so an entity with no
    # aliases is still found by its name. A stored alias of the same text, in any mode, takes
    # its place: that is how a name is made case-sensitive, context-bound or negative.
    canonical_name: str
    parent_entity_id: uuid.UUID | None = None
    is_ambiguous: bool = False
    hints: tuple[str, ...] = ()
    # Hosts of the entity's host and registrable domain rules, as `core.domains` stores them;
    # each becomes a domain-shaped alias (`acme.io`), `www.` left off.
    domains: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AliasRule:
    id: uuid.UUID
    entity_id: uuid.UUID
    alias: str
    match_mode: MatchMode = "word_boundary"
    case_sensitive: bool = False
    is_negative: bool = False
    requires_context: bool = False


@dataclass(frozen=True, slots=True)
class Span:
    start: int
    end: int
    alias_id: uuid.UUID | None  # None for the canonical name and a domain-shaped alias
    match_method: MatchMethod
    score: float
    status: MentionStatus
    via_entity_id: uuid.UUID | None = None  # the product, for a `via_product` span


@dataclass(frozen=True, slots=True)
class EntityMention:
    entity_id: uuid.UUID
    spans: tuple[Span, ...]  # in text order
    confidence: float  # the best span's score
    status: MentionStatus


@dataclass(frozen=True, slots=True)
class NegativeSpan:
    start: int
    end: int
    alias_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class MatchResult:
    mentions: tuple[EntityMention, ...]  # by first span that is not discarded, then the rest
    negatives_applied: tuple[NegativeSpan, ...]  # the negative spans that dropped a match


@dataclass(frozen=True, slots=True)
class _Pattern:
    """What one automaton key (or one regex) stands for."""

    entity_id: uuid.UUID
    alias: AliasRule | None  # None for the canonical name and a domain-shaped alias
    method: MatchMethod
    boundary: Literal["word", "domain", "none"]
    length: int = 0  # of the automaton key; the automaton reports only where a key ends

    @property
    def is_negative(self) -> bool:
        return self.alias is not None and self.alias.is_negative


@dataclass(frozen=True, slots=True)
class _Hit:
    start: int  # original offsets
    end: int
    pattern: _Pattern
    folded_start: int  # where the span starts in the case-folded text, for counting tokens


def check_pattern(pattern: str, *, case_sensitive: bool) -> None:
    """Raises `InvalidAliasPatternError` when the pattern is not one the matcher will run."""
    _compile(pattern, case_sensitive=case_sensitive)


class AliasMatcher:
    """The aliases of one project's entities, compiled once and matched against many texts.

    A stored pattern the matcher cannot run (one accepted under an older limit) is left out and
    named in `skipped_alias_ids`, so one alias cannot stop a whole project's matching.
    """

    def __init__(self, entities: Iterable[EntityRule], aliases: Iterable[AliasRule]) -> None:
        self._entities = {entity.id: entity for entity in entities}
        folded: defaultdict[str, list[_Pattern]] = defaultdict(list)
        cased: defaultdict[str, list[_Pattern]] = defaultdict(list)
        self._regexes: list[tuple[re2._Regexp, _Pattern]] = []
        skipped: list[uuid.UUID] = []
        # Entities with a stored alias of their name's text, in any mode: that alias's case,
        # context and negative rules stand for the name, which is then not matched by itself.
        restated: set[tuple[uuid.UUID, str]] = set()
        for alias in aliases:
            if alias.entity_id not in self._entities:
                raise ValueError(f"alias {alias.id} names an entity that is not given")
            method = _METHOD[alias.match_mode]
            if alias.match_mode == "regex":
                try:
                    compiled = _compile(alias.alias, case_sensitive=alias.case_sensitive)
                except InvalidAliasPatternError:
                    skipped.append(alias.id)
                    continue
                pattern = _Pattern(alias.entity_id, alias, method, boundary="none")
                self._regexes.append((compiled, pattern))
                continue
            restated.add((alias.entity_id, normalize(alias.alias, fold_case=True).text.strip()))
            sensitive = alias.case_sensitive or alias.match_mode == "exact_case"
            key = normalize(alias.alias, fold_case=not sensitive).text.strip()
            if key:
                boundary: Literal["word", "none"] = (
                    "none" if alias.match_mode == "substring" else "word"
                )
                pattern = _Pattern(alias.entity_id, alias, method, boundary, len(key))
                (cased if sensitive else folded)[key].append(pattern)
        for entity in self._entities.values():
            name = normalize(entity.canonical_name, fold_case=True).text.strip()
            if name and (entity.id, name) not in restated:
                folded[name].append(_Pattern(entity.id, None, "alias_name", "word", len(name)))
            for key in _domain_keys(entity.domains):
                pattern = _Pattern(entity.id, None, "alias_domain", "domain", len(key))
                folded[key].append(pattern)
        self.skipped_alias_ids = tuple(skipped)
        self._folded = _automaton(folded)
        self._cased = _automaton(cased)
        self._hint_tokens = {
            entity.id: [tokens for hint in entity.hints if (tokens := _tokens(hint))]
            for entity in self._entities.values()
        }

    def match(self, text: str) -> MatchResult:
        """Raises `TooManyMatchesError` past `MAX_HITS` matches."""
        folded = normalize(text, fold_case=True)
        cased = normalize(text, fold_case=False)
        found = itertools.chain(
            _automaton_hits(self._folded, folded, folded),
            _automaton_hits(self._cased, cased, folded),
            self._regex_hits(cased, folded),
        )
        hits = list(itertools.islice(found, MAX_HITS + 1))
        if len(hits) > MAX_HITS:
            raise TooManyMatchesError(f"the text matched more than {MAX_HITS} times")
        negatives = [
            (hit, hit.pattern.alias.id)
            for hit in hits
            if hit.pattern.alias is not None and hit.pattern.alias.is_negative
        ]
        positives = [hit for hit in hits if not hit.pattern.is_negative]
        kept, applied = _apply_negatives(positives, negatives)

        context = _Context(text, folded, self._hint_tokens)
        scored = [(hit, context.score(hit, self._entities[hit.pattern.entity_id])) for hit in kept]
        # Spans that would be discarded do not take text from spans that would count.
        counting = [(hit, score) for hit, score in scored if _status(score) != "discarded"]
        discarded = [(hit, score) for hit, score in scored if _status(score) == "discarded"]
        taken: list[tuple[int, int]] = []
        accepted = _resolve_overlaps(counting, taken) + _resolve_overlaps(discarded, taken)

        spans: defaultdict[uuid.UUID, dict[tuple[int, int], Span]] = defaultdict(dict)
        for hit, score in accepted:
            entity_id = hit.pattern.entity_id
            span = Span(
                start=hit.start,
                end=hit.end,
                alias_id=hit.pattern.alias.id if hit.pattern.alias else None,
                match_method=hit.pattern.method,
                score=score,
                status=_status(score),
            )
            _keep(spans[entity_id], span)
            parent = self._entities[entity_id].parent_entity_id
            if parent in self._entities:
                product = replace(span, match_method="via_product", via_entity_id=entity_id)
                _keep(spans[parent], product)
        return MatchResult(mentions=_mentions(spans), negatives_applied=applied)

    def _regex_hits(self, cased: NormalizedText, folded: NormalizedText) -> Iterator[_Hit]:
        for compiled, pattern in self._regexes:
            for found in compiled.finditer(cased.text):
                if found.end() > found.start():
                    yield _hit(pattern, cased, found.start(), found.end(), folded)


def _compile(pattern: str, *, case_sensitive: bool) -> re2._Regexp:
    options = re2.Options()
    options.case_sensitive = case_sensitive
    options.never_capture = True  # only the whole match is used
    options.log_errors = False
    try:
        compiled = re2.compile(normalize_pattern(pattern), options)
    except re2.error as error:
        raise InvalidAliasPatternError(f"not a pattern RE2 accepts: {pattern!r}") from error
    if compiled.programsize > MAX_PROGRAM_SIZE:
        raise InvalidAliasPatternError(f"the pattern is too large to run: {pattern!r}")
    return compiled


def _domain_keys(hosts: Iterable[str]) -> set[str]:
    """`www.acme.io` and `xn--bcher-kva.de` as they appear in text: `acme.io`, `bucher.de`."""
    keys = set()
    for host in hosts:
        try:
            readable = idna.decode(host)
        except idna.IDNAError:  # an underscore, which IDNA refuses and hosts may hold
            readable = host
        if key := normalize(readable.removeprefix("www."), fold_case=True).text.strip():
            keys.add(key)
    return keys


def _automaton(patterns: dict[str, list[_Pattern]]) -> ahocorasick.Automaton[list[_Pattern]] | None:
    if not patterns:
        return None
    automaton: ahocorasick.Automaton[list[_Pattern]] = ahocorasick.Automaton()
    for key, found in patterns.items():
        automaton.add_word(key, found)
    automaton.make_automaton()
    return automaton


def _automaton_hits(
    automaton: ahocorasick.Automaton[list[_Pattern]] | None,
    normalized: NormalizedText,
    folded: NormalizedText,
) -> Iterator[_Hit]:
    if automaton is None:
        return
    text = normalized.text
    for last, patterns in automaton.iter(text):
        end = last + 1
        for pattern in patterns:
            start = end - pattern.length
            if _bounded(pattern, text, start, end):
                yield _hit(pattern, normalized, start, end, folded)


def _bounded(pattern: _Pattern, text: str, start: int, end: int) -> bool:
    if pattern.boundary == "none":
        return True
    if pattern.boundary == "domain":
        return _domain_bounded(text, start, end)
    # A side needs a boundary only where the alias itself ends in a word character (`C++`).
    if is_word_character(text[start]) and start > 0 and is_word_character(text[start - 1]):
        return False
    if not is_word_character(text[end - 1]):
        return True
    for suffix in ("", *_SUFFIXES):
        after = end + len(suffix)
        if text.startswith(suffix, end) and (
            after == len(text) or not is_word_character(text[after])
        ):
            return True
    return False


def _domain_bounded(text: str, start: int, end: int) -> bool:
    """`www.acme.io` and `acme.io/pricing` hold the domain; `notacme.io` and `acme.io.evil.com`
    do not."""
    if start > 0 and (is_word_character(text[start - 1]) or text[start - 1] == "-"):
        return False
    if end < len(text):
        after = text[end]
        if is_word_character(after) or after == "-":
            return False
        if after == "." and end + 1 < len(text) and is_word_character(text[end + 1]):
            return False
    return True


def _hit(
    pattern: _Pattern, normalized: NormalizedText, start: int, end: int, folded: NormalizedText
) -> _Hit:
    original_start, original_end = normalized.original_span(start, end)
    # The first folded character that came from the span's first original character.
    folded_start = bisect.bisect_left(folded.starts, original_start)
    return _Hit(original_start, original_end, pattern, folded_start)


def _apply_negatives(
    positives: list[_Hit], negatives: list[tuple[_Hit, uuid.UUID]]
) -> tuple[list[_Hit], tuple[NegativeSpan, ...]]:
    """Positive spans that lie inside a negative span (each given with its alias id) are
    dropped (`Apple pie`); every negative span that holds one is reported. Sorting and range
    minimums keep this near linear."""
    if not negatives or not positives:
        return positives, ()
    by_start = sorted((hit for hit, _ in negatives), key=lambda hit: hit.start)
    negative_starts = [hit.start for hit in by_start]
    furthest = list(itertools.accumulate((hit.end for hit in by_start), max))
    kept = []
    for hit in positives:
        index = bisect.bisect_right(negative_starts, hit.start) - 1
        if index < 0 or furthest[index] < hit.end:
            kept.append(hit)

    ordered = sorted(positives, key=lambda hit: hit.start)
    positive_starts = [hit.start for hit in ordered]
    nearest_end = _RangeMinimum([hit.end for hit in ordered])
    applied = set()
    for negative, alias_id in negatives:
        low = bisect.bisect_left(positive_starts, negative.start)
        high = bisect.bisect_left(positive_starts, negative.end)
        if low < high and nearest_end.minimum(low, high) <= negative.end:
            applied.add(NegativeSpan(negative.start, negative.end, alias_id))
    return kept, tuple(sorted(applied, key=lambda span: (span.start, span.end, span.alias_id)))


class _RangeMinimum:
    """Minimum of any slice of a list in constant time, after an n log n build."""

    def __init__(self, values: Sequence[int]) -> None:
        self._levels = [list(values)]
        width = 1
        while 2 * width <= len(values):
            previous = self._levels[-1]
            self._levels.append(
                [min(previous[i], previous[i + width]) for i in range(len(previous) - width)]
            )
            width *= 2

    def minimum(self, low: int, high: int) -> int:
        """Of values[low:high], which is not empty."""
        level = (high - low).bit_length() - 1
        row = self._levels[level]
        return min(row[low], row[high - (1 << level)])


def _resolve_overlaps(
    candidates: list[tuple[_Hit, float]], taken: list[tuple[int, int]]
) -> list[tuple[_Hit, float]]:
    """The longest span wins; every entity matched on exactly that span keeps it. `taken`
    holds the ranges already won, sorted and never overlapping, and is extended in place."""
    by_range: defaultdict[tuple[int, int], list[tuple[_Hit, float]]] = defaultdict(list)
    for candidate in candidates:
        by_range[(candidate[0].start, candidate[0].end)].append(candidate)
    accepted: list[tuple[_Hit, float]] = []
    for start, end in sorted(by_range, key=lambda r: (r[0] - r[1], r[0])):
        index = bisect.bisect_left(taken, (start, end))
        if index > 0 and taken[index - 1][1] > start:
            continue
        if index < len(taken) and taken[index][0] < end:
            continue
        taken.insert(index, (start, end))
        accepted.extend(by_range[(start, end)])
    return accepted


def _keep(spans: dict[tuple[int, int], Span], span: Span) -> None:
    current = spans.get((span.start, span.end))
    if current is None or _METHOD_RANK[span.match_method] < _METHOD_RANK[current.match_method]:
        spans[(span.start, span.end)] = span


def _mentions(spans: dict[uuid.UUID, dict[tuple[int, int], Span]]) -> tuple[EntityMention, ...]:
    mentions = []
    for entity_id, by_range in spans.items():
        ordered = tuple(sorted(by_range.values(), key=lambda span: (span.start, span.end)))
        confidence = max(span.score for span in ordered)
        mentions.append(EntityMention(entity_id, ordered, confidence, _status(confidence)))

    def order(mention: EntityMention) -> tuple[bool, int, uuid.UUID]:
        counting = [span.start for span in mention.spans if span.status != "discarded"]
        return (
            not counting,
            counting[0] if counting else mention.spans[0].start,
            mention.entity_id,
        )

    return tuple(sorted(mentions, key=order))


def _status(score: float) -> MentionStatus:
    if score >= _ACCEPTED_FROM:
        return "accepted"
    if score >= _UNCERTAIN_FROM:
        return "uncertain"
    return "discarded"


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(_TOKEN.findall(normalize(text, fold_case=True).text))


class _Context:
    """What stage 5 reads from the text around a span."""

    def __init__(
        self,
        text: str,
        folded: NormalizedText,
        hint_tokens: dict[uuid.UUID, list[tuple[str, ...]]],
    ) -> None:
        self._text = text
        found = list(_TOKEN.finditer(folded.text))
        self._tokens = [token.group() for token in found]
        self._token_starts = [token.start() for token in found]
        self._token_index: defaultdict[str, list[int]] = defaultdict(list)
        for index, token in enumerate(self._tokens):
            self._token_index[token].append(index)
        self._hint_tokens = hint_tokens
        # Per entity: the token windows around its hints, sorted by start, with the furthest
        # end reached so far, so one bisect answers "is this token near a hint".
        self._windows: dict[uuid.UUID, tuple[list[int], list[int]]] = {}

    def score(self, hit: _Hit, entity: EntityRule) -> float:
        alias = hit.pattern.alias
        needs_context = entity.is_ambiguous or (alias is not None and alias.requires_context)
        # A domain (`monday.com`) names the entity whatever its name means elsewhere.
        if hit.pattern.method == "alias_domain" or not needs_context:
            return _BASE_PLAIN
        score = _BASE_NEEDS_CONTEXT
        if self._hint_near(hit, entity.id):
            score += _HINT_NEAR
        surface = self._text[hit.start : hit.end]
        # The capital bonus is for common-word names (doc 13 stage 5); an alias that only
        # requires context is often an abbreviation, capitalized anyway.
        if entity.is_ambiguous and surface[:1].isupper() and not self._opens_sentence(hit.start):
            score += _CAPITALIZED
        if not any(char.isupper() for char in surface) and any(
            char.isupper() for char in entity.canonical_name
        ):
            score += _LOWERCASE
        return round(score, 2)

    def _hint_near(self, hit: _Hit, entity_id: uuid.UUID) -> bool:
        windows = self._windows.get(entity_id)
        if windows is None:
            windows = self._hint_windows(entity_id)
            self._windows[entity_id] = windows
        lows, furthest = windows
        index = bisect.bisect_left(self._token_starts, hit.folded_start)
        position = bisect.bisect_right(lows, index) - 1
        return position >= 0 and furthest[position] >= index

    def _hint_windows(self, entity_id: uuid.UUID) -> tuple[list[int], list[int]]:
        """Each hint occurrence widened by the window on both sides, from its first token to
        its last."""
        windows = []
        for hint in self._hint_tokens.get(entity_id, []):
            width = len(hint)
            for index in self._token_index.get(hint[0], []):
                if tuple(self._tokens[index : index + width]) == hint:
                    windows.append(
                        (index - _HINT_WINDOW_TOKENS, index + width - 1 + _HINT_WINDOW_TOKENS)
                    )
        windows.sort()
        lows = [low for low, _ in windows]
        furthest = list(itertools.accumulate((high for _, high in windows), max))
        return lows, furthest

    def _opens_sentence(self, start: int) -> bool:
        """Whether only whitespace, openers or a list marker stand between the span and the
        start of the text, a line, or a sentence."""
        index = start
        while index > 0:
            char = self._text[index - 1]
            if char == "\n":
                return True
            if (
                char.isspace()
                or char in _OPENERS
                or unicodedata.category(char) in _OPENING_CATEGORIES
            ):
                index -= 1
                continue
            break
        if index == 0:
            return True
        before = self._text[index - 1]
        if before in _SENTENCE_ENDS:
            return True
        if before == ")":  # a list marker such as `1)`
            digits = index - 1
            while digits > 0 and self._text[digits - 1].isdigit():
                digits -= 1
            return digits < index - 1 and (digits == 0 or self._text[digits - 1].isspace())
        return False
