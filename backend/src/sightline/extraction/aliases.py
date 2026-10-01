"""Alias matching and disambiguation, stages 4 and 5 (docs/13-ai-extraction-engine.md).

One Aho-Corasick pass over the normalized text finds every alias; user-entered patterns run
through RE2, which is linear in the text whatever the pattern. Spans inside a negative alias
are dropped, the longest of overlapping spans wins, a product's span also counts toward its
parent brand, and each span is scored from what the text alone can tell (plan decision D6):
the signals that need answer structure, citations or the prompt arrive with extraction.

Offsets are into the text as given, in code points.
"""

from __future__ import annotations

import bisect
import re
import uuid
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Final, Literal

import ahocorasick
import idna
import re2

from sightline.extraction.text import NormalizedText, normalize

MatchMode = Literal["word_boundary", "exact_case", "substring", "regex"]
MatchMethod = Literal[
    "alias_word", "alias_exact", "alias_substring", "alias_regex", "alias_domain", "via_product"
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
    "alias_domain": 4,
    "via_product": 5,
}
# What may follow a word-boundary alias before the boundary: possessives and plurals.
_SUFFIXES: Final = ("'s", "'", "es", "s")

# Stage 5 (D6).
_BASE_PLAIN: Final = 0.95
_BASE_NEEDS_CONTEXT: Final = 0.30
_HINT_NEAR: Final = 0.35
_CAPITALIZED: Final = 0.15
_LOWERCASE: Final = -0.25
_HINT_WINDOW_TOKENS: Final = 40
_ACCEPTED_FROM: Final = 0.70
_UNCERTAIN_FROM: Final = 0.40
_MAX_CONFIDENCE: Final = 0.99
# What may stand between a sentence (or list item) start and a name that opens it.
_OPENERS: Final = " \t\"'([*#>-\N{BULLET}"
_SENTENCE_ENDS: Final = ".!?:\n"

_TOKEN: Final = re.compile(r"[^\W_]+")


class InvalidAliasPatternError(ValueError):
    """A regex alias RE2 cannot compile (it has no backreferences or lookaround, by design)."""


@dataclass(frozen=True, slots=True)
class EntityRule:
    id: uuid.UUID
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
    alias_id: uuid.UUID | None  # None for a domain-shaped alias
    match_method: MatchMethod
    score: float


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
    mentions: tuple[EntityMention, ...]  # in order of first span
    negatives_applied: tuple[NegativeSpan, ...]  # the negative spans that dropped a match


@dataclass(frozen=True, slots=True)
class _Pattern:
    """What one automaton key (or one regex) stands for."""

    entity_id: uuid.UUID
    alias: AliasRule | None  # None for a domain-shaped alias
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


def check_pattern(pattern: str) -> None:
    """Raises `InvalidAliasPatternError` when RE2 cannot compile `pattern`."""
    _compile(pattern, case_sensitive=True)


class AliasMatcher:
    """The aliases of one project's entities, compiled once and matched against many texts."""

    def __init__(self, entities: Iterable[EntityRule], aliases: Iterable[AliasRule]) -> None:
        self._entities = {entity.id: entity for entity in entities}
        folded: defaultdict[str, list[_Pattern]] = defaultdict(list)
        cased: defaultdict[str, list[_Pattern]] = defaultdict(list)
        self._regexes: list[tuple[re2._Regexp, _Pattern]] = []
        for alias in aliases:
            if alias.entity_id not in self._entities:
                raise ValueError(f"alias {alias.id} names an entity that is not given")
            method = _METHOD[alias.match_mode]
            if alias.match_mode == "regex":
                compiled = _compile(alias.alias, case_sensitive=alias.case_sensitive)
                pattern = _Pattern(alias.entity_id, alias, method, boundary="none")
                self._regexes.append((compiled, pattern))
                continue
            sensitive = alias.case_sensitive or alias.match_mode == "exact_case"
            key = normalize(alias.alias, fold_case=not sensitive).text.strip()
            if key:
                boundary: Literal["word", "none"] = (
                    "none" if alias.match_mode == "substring" else "word"
                )
                pattern = _Pattern(alias.entity_id, alias, method, boundary, len(key))
                (cased if sensitive else folded)[key].append(pattern)
        for entity in self._entities.values():
            for key in _domain_keys(entity.domains):
                pattern = _Pattern(entity.id, None, "alias_domain", "domain", len(key))
                folded[key].append(pattern)
        self._folded = _automaton(folded)
        self._cased = _automaton(cased)
        self._hint_tokens = {
            entity.id: [tokens for hint in entity.hints if (tokens := _tokens(hint))]
            for entity in self._entities.values()
        }

    def match(self, text: str) -> MatchResult:
        folded = normalize(text, fold_case=True)
        cased = normalize(text, fold_case=False)
        hits = [
            *_automaton_hits(self._folded, folded, folded),
            *_automaton_hits(self._cased, cased, folded),
            *self._regex_hits(cased, folded),
        ]
        negatives = [hit for hit in hits if hit.pattern.is_negative]
        positives = [hit for hit in hits if not hit.pattern.is_negative]
        kept, applied = _apply_negatives(positives, negatives)
        accepted = _resolve_overlaps(kept)
        context = _Context(text, folded, self._hint_tokens)
        spans: defaultdict[uuid.UUID, dict[tuple[int, int], Span]] = defaultdict(dict)
        for hit in accepted:
            span = Span(
                start=hit.start,
                end=hit.end,
                alias_id=hit.pattern.alias.id if hit.pattern.alias else None,
                match_method=hit.pattern.method,
                score=context.score(hit, self._entities[hit.pattern.entity_id]),
            )
            _keep(spans[hit.pattern.entity_id], span)
            parent = self._entities[hit.pattern.entity_id].parent_entity_id
            if parent in self._entities:
                _keep(spans[parent], _replace_method(span, "via_product"))
        return MatchResult(mentions=_mentions(spans), negatives_applied=applied)

    def _regex_hits(self, cased: NormalizedText, folded: NormalizedText) -> Iterator[_Hit]:
        for compiled, pattern in self._regexes:
            for found in compiled.finditer(cased.text):
                if found.end() > found.start():
                    yield _hit(pattern, cased, found.start(), found.end(), folded)


def _compile(pattern: str, *, case_sensitive: bool) -> re2._Regexp:
    options = re2.Options()
    options.case_sensitive = case_sensitive
    options.log_errors = False
    try:
        return re2.compile(pattern, options)
    except re2.error as error:
        raise InvalidAliasPatternError(f"not a pattern RE2 accepts: {pattern!r}") from error


def _domain_keys(hosts: Iterable[str]) -> set[str]:
    """`www.acme.io` and `xn--bcher-kva.de` as they appear in text: `acme.io`, `bucher.de`."""
    keys = set()
    for host in hosts:
        try:
            readable = idna.decode(host)
        except idna.IDNAError:  # an underscore, which IDNA refuses and hosts may hold
            readable = host
        keys.add(normalize(readable.removeprefix("www."), fold_case=True).text)
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
    if text[start].isalnum() and start > 0 and text[start - 1].isalnum():
        return False
    if not text[end - 1].isalnum():
        return True
    for suffix in ("", *_SUFFIXES):
        after = end + len(suffix)
        if text.startswith(suffix, end) and (after == len(text) or not text[after].isalnum()):
            return True
    return False


def _domain_bounded(text: str, start: int, end: int) -> bool:
    """`www.acme.io` and `acme.io/pricing` hold the domain; `notacme.io` and `acme.io.evil.com`
    do not."""
    if start > 0 and (text[start - 1].isalnum() or text[start - 1] == "-"):
        return False
    if end < len(text):
        after = text[end]
        if after.isalnum() or after == "-":
            return False
        if after == "." and end + 1 < len(text) and text[end + 1].isalnum():
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
    positives: list[_Hit], negatives: list[_Hit]
) -> tuple[list[_Hit], tuple[NegativeSpan, ...]]:
    """Positive spans that lie inside a negative span are dropped (`Apple pie`)."""
    kept: list[_Hit] = []
    applied: set[NegativeSpan] = set()
    for hit in positives:
        covering = [
            NegativeSpan(negative.start, negative.end, negative.pattern.alias.id)
            for negative in negatives
            if negative.pattern.alias is not None
            and negative.start <= hit.start
            and hit.end <= negative.end
        ]
        if not covering:
            kept.append(hit)
        applied.update(covering)
    ordered = sorted(applied, key=lambda span: (span.start, span.end, span.alias_id))
    return kept, tuple(ordered)


def _resolve_overlaps(hits: list[_Hit]) -> list[_Hit]:
    """The longest span wins; every entity matched on exactly that span keeps it."""
    by_range: defaultdict[tuple[int, int], list[_Hit]] = defaultdict(list)
    for hit in hits:
        by_range[(hit.start, hit.end)].append(hit)
    # Ranges taken so far never overlap, so sorted by start their ends are sorted too, and a
    # new range can only overlap its neighbours on either side.
    starts: list[int] = []
    ends: list[int] = []
    accepted: list[_Hit] = []
    for start, end in sorted(by_range, key=lambda r: (r[0] - r[1], r[0])):
        index = bisect.bisect_left(starts, start)
        if index > 0 and ends[index - 1] > start:
            continue
        if index < len(starts) and starts[index] < end:
            continue
        starts.insert(index, start)
        ends.insert(index, end)
        accepted.extend(by_range[(start, end)])
    return accepted


def _keep(spans: dict[tuple[int, int], Span], span: Span) -> None:
    current = spans.get((span.start, span.end))
    if current is None or _METHOD_RANK[span.match_method] < _METHOD_RANK[current.match_method]:
        spans[(span.start, span.end)] = span


def _replace_method(span: Span, method: MatchMethod) -> Span:
    return Span(span.start, span.end, span.alias_id, method, span.score)


def _mentions(spans: dict[uuid.UUID, dict[tuple[int, int], Span]]) -> tuple[EntityMention, ...]:
    mentions = []
    for entity_id, by_range in spans.items():
        ordered = tuple(sorted(by_range.values(), key=lambda span: (span.start, span.end)))
        confidence = max(span.score for span in ordered)
        mentions.append(EntityMention(entity_id, ordered, confidence, _status(confidence)))
    return tuple(sorted(mentions, key=lambda mention: (mention.spans[0].start, mention.entity_id)))


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
        self._hint_tokens = hint_tokens
        self._hint_positions: dict[uuid.UUID, list[int]] = {}

    def score(self, hit: _Hit, entity: EntityRule) -> float:
        alias = hit.pattern.alias
        needs_context = entity.is_ambiguous or (alias is not None and alias.requires_context)
        if alias is None or not needs_context:
            return _BASE_PLAIN
        score = _BASE_NEEDS_CONTEXT
        if self._hint_near(hit, entity.id):
            score += _HINT_NEAR
        surface = self._text[hit.start : hit.end]
        if entity.is_ambiguous and surface[:1].isupper() and not self._opens_sentence(hit.start):
            score += _CAPITALIZED
        if not any(char.isupper() for char in surface) and any(
            char.isupper() for char in entity.canonical_name
        ):
            score += _LOWERCASE
        return round(min(max(score, 0.0), _MAX_CONFIDENCE), 2)

    def _hint_near(self, hit: _Hit, entity_id: uuid.UUID) -> bool:
        positions = self._hint_positions.get(entity_id)
        if positions is None:
            positions = self._find_hints(entity_id)
            self._hint_positions[entity_id] = positions
        if not positions:
            return False
        # The index of the first token at or after the span's start.
        index = bisect.bisect_left(self._token_starts, hit.folded_start)
        return any(abs(position - index) <= _HINT_WINDOW_TOKENS for position in positions)

    def _find_hints(self, entity_id: uuid.UUID) -> list[int]:
        positions = []
        for hint in self._hint_tokens.get(entity_id, []):
            width = len(hint)
            for index in range(len(self._tokens) - width + 1):
                if tuple(self._tokens[index : index + width]) == hint:
                    positions.append(index)
        return positions

    def _opens_sentence(self, start: int) -> bool:
        before = self._text[:start].rstrip(_OPENERS)
        return not before or before[-1] in _SENTENCE_ENDS
