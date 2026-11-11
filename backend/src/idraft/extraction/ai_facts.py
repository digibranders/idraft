"""Light extraction of one AI answer (docs/13-ai-extraction-engine.md stages 1, 2, 4, 5 and 7, as
slice 1 of AI prompt tracking cuts them).

Given the answer text and its cited sources, the project's alias matcher, its domain resolver and
the role of each tracked entity, this says which sources are own, competitor or third party,
which tracked entities the text names and where, and the observation's fact row. Pure: no
database, no I/O. Offsets are into the text as given, in code points.

A mention the matcher is unsure of is kept as `uncertain` and left out of every rate (doc 13
section 1, principle 4). A domain written inside a markdown link target is the link, not a
mention (doc 13 principle 5): link targets are blanked before matching, offsets unchanged.
Recommendation, sentiment, prominence beyond the first offset and structured lists are later
slices: `had_structured_list` is always false.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal

from idraft.extraction.aliases import AliasMatcher, MatchMethod
from idraft.extraction.domains import DomainResolver, DomainRole, ProjectRole
from idraft.extraction.urls import CanonicalUrl

EXTRACTOR_VERSION: Final = 1
# `](https://...)`: the target of a markdown link or image.
_LINK_TARGET: Final = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
StoredStatus = Literal["accepted", "uncertain"]


@dataclass(frozen=True, slots=True)
class SourceIn:
    url: CanonicalUrl
    raw_url: str
    kind: str
    occurrences: int


@dataclass(frozen=True, slots=True)
class CitationFact:
    index: int  # 1-based, in the provider's order
    url: CanonicalUrl
    raw_url: str
    kind: str
    occurrences: int
    domain_role: DomainRole
    role_entity_id: uuid.UUID | None
    first_char_offset: int | None


@dataclass(frozen=True, slots=True)
class MentionFact:
    entity_id: uuid.UUID
    role: ProjectRole
    mention_count: int
    first_char_offset: int
    mention_order: int  # 1 = the first tracked entity the text names
    prominence: float  # 1 - first offset / text length (doc 16 section 6), four places
    evidence_spans: tuple[tuple[int, int], ...]  # half-open code point ranges
    match_method: MatchMethod
    status: StoredStatus
    confidence: float


@dataclass(frozen=True, slots=True)
class ObservationFact:
    is_valid: bool
    own_mentioned: bool
    own_domain_cited: bool
    own_mention_order: int | None
    own_prominence: float | None
    own_citation_count: int
    total_citation_count: int
    tracked_entities_mentioned: int
    competitor_mentions: tuple[uuid.UUID, ...]
    competitor_cited: tuple[uuid.UUID, ...]
    had_structured_list: bool


@dataclass(frozen=True, slots=True)
class AnswerFacts:
    citations: tuple[CitationFact, ...]
    mentions: tuple[MentionFact, ...]
    fact: ObservationFact


def extract_answer_facts(
    text: str | None,
    sources: Sequence[SourceIn],
    *,
    matcher: AliasMatcher,
    resolver: DomainResolver,
    roles: Mapping[uuid.UUID, ProjectRole],
    is_valid: bool,
) -> AnswerFacts:
    """The facts of one answer. `roles` holds the entities the project tracks in AI answers;
    a match of any other entity is not kept. Raises `TooManyMatchesError` from the matcher."""
    citations = tuple(_citation(i, source, text, resolver) for i, source in enumerate(sources, 1))
    mentions = _mentions(text, matcher, roles) if text else ()
    accepted = [mention for mention in mentions if mention.status == "accepted"]
    own = [mention for mention in accepted if mention.role == "own"]
    competitors = [mention for mention in accepted if mention.role == "competitor"]
    first_own = min(own, key=lambda mention: mention.first_char_offset, default=None)
    own_cited = [citation for citation in citations if citation.domain_role == "own"]
    cited_competitors = dict.fromkeys(
        citation.role_entity_id
        for citation in citations
        if citation.domain_role == "competitor"
        and citation.role_entity_id is not None
        and roles.get(citation.role_entity_id) == "competitor"
    )
    fact = ObservationFact(
        is_valid=is_valid,
        own_mentioned=bool(own),
        own_domain_cited=bool(own_cited),
        own_mention_order=None if first_own is None else first_own.mention_order,
        own_prominence=None if first_own is None else first_own.prominence,
        own_citation_count=len(own_cited),
        total_citation_count=len(citations),
        tracked_entities_mentioned=len(own) + len(competitors),
        competitor_mentions=tuple(mention.entity_id for mention in competitors),
        competitor_cited=tuple(cited_competitors),
        had_structured_list=False,
    )
    return AnswerFacts(citations=citations, mentions=mentions, fact=fact)


def blank_link_targets(text: str) -> str:
    """The text with each markdown link target replaced by spaces of its length."""
    return _LINK_TARGET.sub(lambda found: "](" + " " * (len(found.group(0)) - 3) + ")", text)


def _citation(
    index: int, source: SourceIn, text: str | None, resolver: DomainResolver
) -> CitationFact:
    resolution = resolver.resolve_url(source.url)
    offset = None
    if text:
        found = text.find(source.raw_url)
        if found < 0:
            found = text.find(source.url.url)
        offset = found if found >= 0 else None
    return CitationFact(
        index=index,
        url=source.url,
        raw_url=source.raw_url,
        kind=source.kind,
        occurrences=source.occurrences,
        domain_role=resolution.domain_role,
        role_entity_id=resolution.entity_id,
        first_char_offset=offset,
    )


def _mentions(
    text: str, matcher: AliasMatcher, roles: Mapping[uuid.UUID, ProjectRole]
) -> tuple[MentionFact, ...]:
    result = matcher.match(blank_link_targets(text))
    drafts = []
    for mention in result.mentions:
        role = roles.get(mention.entity_id)
        if role is None or mention.status == "discarded":
            continue
        spans = [span for span in mention.spans if span.status != "discarded"]
        if not spans:
            continue
        best = max(spans, key=lambda span: span.score)
        drafts.append((mention, role, spans, best))
    drafts.sort(key=lambda draft: (draft[2][0].start, str(draft[0].entity_id)))
    length = len(text)
    found = []
    for order, (mention, role, spans, best) in enumerate(drafts, 1):
        first = spans[0].start
        status: StoredStatus = "accepted" if mention.status == "accepted" else "uncertain"
        found.append(
            MentionFact(
                entity_id=mention.entity_id,
                role=role,
                mention_count=len(spans),
                first_char_offset=first,
                mention_order=order,
                prominence=round(1 - first / length, 4),
                evidence_spans=tuple((span.start, span.end) for span in spans),
                match_method=best.match_method,
                status=status,
                confidence=round(mention.confidence, 3),
            )
        )
    return tuple(found)
