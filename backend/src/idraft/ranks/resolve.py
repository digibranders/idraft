"""Who ranks where on one SERP (docs/09 sections 1 and 2; docs/12 section 3).

A project's entity domains are resolved with `DomainResolver`; each organic result, each feature
source and each AI Overview citation takes the role of the most specific rule it matches. The
result is one `EntityRank` per own or competitor entity of the keyword, the ownership of every
feature, and the AI Overview verdict. Ranks beyond the depth requested are never read: a rank the
check did not look for is unknown, not absent (docs/09 section 3).
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Final, Literal

from idraft.extraction.domains import DomainResolver
from idraft.extraction.urls import CanonicalUrl
from idraft.providers.dataforseo.serp_parse import NormalizedSerp, SerpFeature

EntityRole = Literal["own", "competitor"]
AioState = Literal["absent", "present_not_cited", "present_cited", "not_loaded", "unknown"]

_PRESENT: Final = frozenset({"present", "present_async_loaded"})
# Features are followed on the first page of results, which every depth profile sees (the
# lightest looks at ten results).
PAGE_ONE: Final = 10


@dataclass(frozen=True, slots=True)
class RankedEntity:
    """An entity of the keyword's project whose rank is kept: own, or a competitor."""

    entity_id: uuid.UUID
    role: EntityRole


@dataclass(frozen=True, slots=True)
class EntityRank:
    entity_id: uuid.UUID
    role: EntityRole
    organic_rank: int | None  # the best organic rank; None when no result is within the depth
    absolute_rank: int | None  # of the result at that rank
    ranking_url: CanonicalUrl | None  # the URL at that rank
    ranking_title: str | None
    ranking_snippet: str | None
    # Every rank an organic result of the entity holds, once for each of its URLs there: a
    # grouped sub-result shares its parent's rank and is another URL at that rank.
    all_organic_ranks: tuple[int, ...]
    all_urls: tuple[CanonicalUrl, ...]  # the URL for each of those ranks, in the same order
    owned_feature_types: tuple[str, ...]  # sorted; not the AI Overview, which is cited, not owned
    # The same, for the features on the first page of results only: the part of the page every
    # depth profile sees, which keeps the state from changing with the depth of the check.
    page_one_feature_types: tuple[str, ...]
    cited_in_ai_overview: bool | None  # None when there is no loaded AI Overview to cite from
    ai_overview_citation_position: int | None  # 1-based, in the order the block lists them

    @property
    def result_count(self) -> int:
        """How many results the entity has: a rank with grouped URLs is still one."""
        return len(set(self.all_organic_ranks))


@dataclass(frozen=True, slots=True)
class FeatureOwnership:
    """Who a feature of the page names: `features[index]` of the SERP."""

    index: int
    owned_by_project: bool
    owned_position: int | None  # 1-based position of the first own source URL
    competitor_entity_ids: tuple[uuid.UUID, ...]  # sorted
    on_page_one: bool  # within the first page of results, or in the right column


@dataclass(frozen=True, slots=True)
class ResolvedSerp:
    depth_requested: int
    entities: tuple[EntityRank, ...]  # own first, then competitors, each by entity id
    features: tuple[FeatureOwnership, ...]
    aio_state: AioState
    has_ai_overview: bool


@dataclass(frozen=True, slots=True)
class OwnSide:
    """The project's own entities taken together (the own side is one): its rank is the best
    organic rank among them."""

    entity_id: uuid.UUID | None  # the own entity holding the best rank
    organic_rank: int | None
    absolute_rank: int | None
    ranking_url: CanonicalUrl | None
    feature_types_present: tuple[str, ...]
    owned_feature_types: tuple[str, ...]
    has_ai_overview: bool
    aio_state: AioState
    cited_in_ai_overview: bool | None
    aio_citation_position: int | None


def resolve_serp(
    serp: NormalizedSerp,
    resolver: DomainResolver,
    entities: Collection[RankedEntity],
    *,
    depth_requested: int,
    excluded: Collection[uuid.UUID] = (),
) -> ResolvedSerp:
    """Resolve a SERP for the entities of one tracked keyword.

    `entities` are the project's own entities and the competitors the keyword compares; a
    competitor in `excluded` (the keyword's per-keyword exclusion) gets no row, and a result of an
    entity outside the set (a watched entity) counts for nobody."""
    if depth_requested < 1:
        raise ValueError(f"depth_requested must be at least 1, got {depth_requested}")
    kept = {
        entity.entity_id: entity for entity in entities if entity.entity_id not in set(excluded)
    }

    ranks: dict[uuid.UUID, list[tuple[int, int | None, CanonicalUrl, str | None, str | None]]] = {
        entity_id: [] for entity_id in kept
    }
    # A grouped sub-result shares its parent's rank and is not another rank; the observation
    # keeps one URL for each rank (docs/04, `all_url_ids`).
    for result in serp.organic:
        if result.organic_rank > depth_requested:
            continue  # beyond the depth requested: not looked for, never read
        owner = resolver.resolve_url(result.url).entity_id
        if owner is None or owner not in kept:
            continue
        ranks[owner].append(
            (result.organic_rank, result.absolute_rank, result.url, result.title, result.snippet)
        )
        for child in result.grouped_urls:
            if resolver.resolve_url(child).entity_id == owner:
                ranks[owner].append((result.organic_rank, result.absolute_rank, child, None, None))

    horizon = _page_one_limit(serp)
    features = tuple(
        _ownership(index, feature, resolver, kept, horizon)
        for index, feature in enumerate(serp.features)
    )
    owned_types: dict[uuid.UUID, set[str]] = {entity_id: set() for entity_id in kept}
    page_one_types: dict[uuid.UUID, set[str]] = {entity_id: set() for entity_id in kept}
    for feature, ownership in zip(serp.features, features, strict=True):
        if feature.feature_type == "ai_overview":
            continue  # its citations are followed as citations
        for owner in _owners(feature, resolver, kept):
            owned_types[owner].add(feature.feature_type)
            if ownership.on_page_one:
                page_one_types[owner].add(feature.feature_type)

    aio_loaded = serp.ai_overview.state in _PRESENT
    cited_at: dict[uuid.UUID, int] = {}
    if aio_loaded:
        for position, citation in enumerate(serp.ai_overview.citations, start=1):
            owner = resolver.resolve_url(citation.url).entity_id
            if owner is not None and owner in kept:
                cited_at.setdefault(owner, position)

    resolved: list[EntityRank] = []
    for entity_id, entity in kept.items():
        held = sorted(ranks[entity_id], key=lambda row: row[0])
        best = held[0] if held else None
        resolved.append(
            EntityRank(
                entity_id=entity_id,
                role=entity.role,
                organic_rank=best[0] if best else None,
                absolute_rank=best[1] if best else None,
                ranking_url=best[2] if best else None,
                ranking_title=best[3] if best else None,
                ranking_snippet=best[4] if best else None,
                all_organic_ranks=tuple(row[0] for row in held),
                all_urls=tuple(row[2] for row in held),
                owned_feature_types=tuple(sorted(owned_types[entity_id])),
                page_one_feature_types=tuple(sorted(page_one_types[entity_id])),
                cited_in_ai_overview=(entity_id in cited_at) if aio_loaded else None,
                ai_overview_citation_position=cited_at.get(entity_id),
            )
        )
    resolved.sort(key=lambda found: (found.role != "own", found.entity_id))

    return ResolvedSerp(
        depth_requested=depth_requested,
        entities=tuple(resolved),
        features=features,
        aio_state=_aio_state(serp, resolved),
        has_ai_overview=serp.ai_overview.state != "absent",
    )


def own_side(resolved: ResolvedSerp, serp: NormalizedSerp) -> OwnSide:
    """The own entities taken together."""
    own = [entity for entity in resolved.entities if entity.role == "own"]
    ranked = [entity for entity in own if entity.organic_rank is not None]
    best = min(ranked, key=lambda entity: entity.organic_rank or 0, default=None)
    positions = [
        entity.ai_overview_citation_position
        for entity in own
        if entity.ai_overview_citation_position is not None
    ]
    cited: bool | None
    if resolved.aio_state in ("absent", "not_loaded", "unknown"):
        cited = None
    else:
        cited = resolved.aio_state == "present_cited"
    return OwnSide(
        entity_id=best.entity_id if best else None,
        organic_rank=best.organic_rank if best else None,
        absolute_rank=best.absolute_rank if best else None,
        ranking_url=best.ranking_url if best else None,
        feature_types_present=tuple(
            sorted(
                {
                    feature.feature_type
                    for feature, ownership in zip(serp.features, resolved.features, strict=True)
                    if ownership.on_page_one
                }
            )
        ),
        owned_feature_types=tuple(
            sorted({t for entity in own for t in entity.page_one_feature_types})
        ),
        has_ai_overview=resolved.has_ai_overview,
        aio_state=resolved.aio_state,
        cited_in_ai_overview=cited,
        aio_citation_position=min(positions) if positions else None,
    )


def target_url_match(side: OwnSide, target_hash: bytes | None) -> bool | None:
    """Whether the ranking URL is the keyword's target URL (given by its hash); unknown without a
    target or a ranking URL."""
    if target_hash is None or side.ranking_url is None:
        return None
    return side.ranking_url.url_hash == target_hash


def _owners(
    feature: SerpFeature, resolver: DomainResolver, kept: Mapping[uuid.UUID, RankedEntity]
) -> list[uuid.UUID]:
    found: dict[uuid.UUID, None] = {}
    for url in feature.source_urls:
        owner = resolver.resolve_url(url).entity_id
        if owner is not None and owner in kept:
            found.setdefault(owner, None)
    return list(found)


def _ownership(
    index: int,
    feature: SerpFeature,
    resolver: DomainResolver,
    kept: Mapping[uuid.UUID, RankedEntity],
    horizon: int | None,
) -> FeatureOwnership:
    owned_position: int | None = None
    competitors: set[uuid.UUID] = set()
    for position, url in enumerate(feature.source_urls, start=1):
        owner = resolver.resolve_url(url).entity_id
        entity = kept.get(owner) if owner is not None else None
        if entity is None:
            continue
        if entity.role == "own":
            owned_position = owned_position or position
        else:
            competitors.add(entity.entity_id)
    return FeatureOwnership(
        index=index,
        owned_by_project=owned_position is not None,
        owned_position=owned_position,
        competitor_entity_ids=tuple(sorted(competitors)),
        on_page_one=horizon is None
        or feature.absolute_rank is None
        or feature.absolute_rank <= horizon,
    )


def _page_one_limit(serp: NormalizedSerp) -> int | None:
    """The absolute rank of the tenth organic result: features numbered after it are not on the
    first page. None when the page has no tenth result, and then all of it is page one. A tenth
    result with no absolute rank (the right column) gives way to the last of the first ten that
    has one."""
    first_page = [result for result in serp.organic if result.organic_rank <= PAGE_ONE]
    if len(first_page) < PAGE_ONE:
        return None
    numbered = [r.absolute_rank for r in first_page if r.absolute_rank is not None]
    return max(numbered) if numbered else None


def _aio_state(serp: NormalizedSerp, resolved: list[EntityRank]) -> AioState:
    """The AI Overview verdict for the own side (docs/superpowers/plans/2026-10-05-rank-
    collection.md, ruling 9)."""
    state = serp.ai_overview.state
    if state == "absent":
        return "absent"
    if state == "present_not_loaded":
        return "not_loaded"
    cited = any(entity.role == "own" and entity.cited_in_ai_overview for entity in resolved)
    return "present_cited" if cited else "present_not_cited"
