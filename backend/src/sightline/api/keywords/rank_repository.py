"""What the rank tables say about a page of tracked keywords (docs/19 section 3.6.1; plan
decisions R23 to R27 of docs/superpowers/plans/2026-10-05-rank-collection.md).

Every read names the workspace and the tracked keywords it is asked about; the state of a
keyword says which snapshot is its latest, and the other tables are read at that snapshot.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.api.keywords.repository import CompetitorRecord, UrlRecord, entity_refs
from sightline.db.tables import (
    domain_rank_observations,
    domains,
    entities,
    serp_features,
    tracked_keyword_state,
    urls,
)
from sightline.keywords.trees import among_ids

SPARKLINE_POINTS: Final = 30
# How far back the sparkline looks: a keyword checked weekly has 30 checks in under 210 days.
SPARKLINE_WINDOW: Final = timedelta(days=210)


@dataclass(frozen=True, slots=True)
class StateRecord:
    last_snapshot_id: int | None
    last_observed_at: datetime | None
    current_rank: int | None
    current_absolute_rank: int | None
    current_url: UrlRecord | None
    current_depth_requested: int | None
    previous_rank: int | None
    previous_observed_at: datetime | None
    previous_depth_requested: int | None
    best_rank: int | None
    best_rank_at: datetime | None
    worst_rank: int | None
    first_ranked_at: datetime | None
    feature_types_present: list[str]
    owned_feature_types: list[str]
    aio_state: str | None
    aio_citation_position: int | None
    aio_observation_id: int | None
    target_url_match: bool | None
    url_changed_at: datetime | None
    consecutive_failures: int
    is_stale: bool
    ranking_url_count: int


@dataclass(frozen=True, slots=True)
class SparkPoint:
    observed_at: datetime
    rank: int | None
    depth: int


@dataclass(frozen=True, slots=True)
class CompetitorRank:
    entity: CompetitorRecord
    rank: int | None
    absolute_rank: int | None
    depth_requested: int
    url: UrlRecord | None
    observed_at: datetime
    snapshot_id: int
    previous_rank: int | None
    previous_depth_requested: int | None
    previous_observed_at: datetime | None


@dataclass(frozen=True, slots=True)
class FeatureRecord:
    feature_type: str
    ordinal: int
    rank_absolute: int | None
    owned_by_project: bool
    owned_position: int | None


def _url(
    row_url_id: int | None, canonical: str, host: str, registrable: str, path: str
) -> UrlRecord:
    assert row_url_id is not None
    return UrlRecord(
        url_id=row_url_id,
        canonical_url=canonical,
        host=host,
        registrable_domain=registrable,
        path=path,
    )


async def states_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, StateRecord]:
    """The state of each of these keywords that has a row, and how many of the project's own
    URLs ranked at its last check."""
    if not tracked_ids:
        return {}
    s = tracked_keyword_state.c
    rows = await db.execute(
        select(
            tracked_keyword_state,
            urls.c.canonical_url,
            urls.c.path.label("url_path"),
            domains.c.host.label("url_host"),
            domains.c.registrable_domain.label("url_registrable_domain"),
        )
        .select_from(
            tracked_keyword_state.outerjoin(urls, urls.c.id == s.current_url_id).outerjoin(
                domains, domains.c.id == urls.c.domain_id
            )
        )
        .where(s.workspace_id == workspace_id, among_ids(s.tracked_keyword_id, tracked_ids))
    )
    counts = await _own_url_counts(db, workspace_id, tracked_ids)
    found: dict[UUID, StateRecord] = {}
    for row in rows:
        fields = row._mapping
        found[row.tracked_keyword_id] = StateRecord(
            last_snapshot_id=row.last_snapshot_id,
            last_observed_at=row.last_observed_at,
            current_rank=row.current_rank,
            current_absolute_rank=row.current_absolute_rank,
            current_url=None
            if row.current_url_id is None
            else _url(
                row.current_url_id,
                fields["canonical_url"],
                fields["url_host"],
                fields["url_registrable_domain"],
                fields["url_path"],
            ),
            current_depth_requested=row.current_depth_requested,
            previous_rank=row.previous_rank,
            previous_observed_at=row.previous_observed_at,
            previous_depth_requested=row.previous_depth_requested,
            best_rank=row.best_rank,
            best_rank_at=row.best_rank_at,
            worst_rank=row.worst_rank,
            first_ranked_at=row.first_ranked_at,
            feature_types_present=list(row.feature_types_present or []),
            owned_feature_types=list(row.owned_feature_types or []),
            aio_state=row.aio_state,
            aio_citation_position=row.aio_citation_position,
            aio_observation_id=row.aio_observation_id,
            target_url_match=row.target_url_match,
            url_changed_at=row.url_changed_at,
            consecutive_failures=row.consecutive_failures,
            is_stale=row.is_stale,
            ranking_url_count=counts.get(row.tracked_keyword_id, 0),
        )
    return found


def _at_last_check() -> object:
    """The join of a rank table to the state: the rows of the keyword's last snapshot."""
    s, o = tracked_keyword_state.c, domain_rank_observations.c
    return and_(
        s.tracked_keyword_id == o.tracked_keyword_id,
        s.workspace_id == o.workspace_id,
        s.last_snapshot_id == o.serp_snapshot_id,
        s.last_observed_at == o.observed_at,
    )


async def _own_url_counts(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, int]:
    o = domain_rank_observations.c
    rows = await db.execute(
        select(o.tracked_keyword_id, o.all_url_ids)
        .select_from(domain_rank_observations.join(tracked_keyword_state, _at_last_check()))  # type: ignore[arg-type]
        .where(
            o.workspace_id == workspace_id,
            among_ids(o.tracked_keyword_id, tracked_ids),
            o.role == "own",
        )
    )
    distinct: dict[UUID, set[int]] = {}
    for row in rows:
        distinct.setdefault(row.tracked_keyword_id, set()).update(row.all_url_ids or [])
    return {tracked_id: len(url_ids) for tracked_id, url_ids in distinct.items()}


async def sparklines_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[SparkPoint]]:
    """The last `SPARKLINE_POINTS` checks of each keyword, oldest first: in each, the best rank
    of the own entities and the depth of the check."""
    if not tracked_ids:
        return {}
    o = domain_rank_observations.c
    per_check = (
        select(
            o.tracked_keyword_id,
            o.observed_at,
            o.serp_snapshot_id,
            func.min(o.organic_rank).label("rank"),
            func.max(o.depth_requested).label("depth"),
        )
        .where(
            o.workspace_id == workspace_id,
            among_ids(o.tracked_keyword_id, tracked_ids),
            o.role == "own",
            o.observed_at >= func.now() - SPARKLINE_WINDOW,
        )
        .group_by(o.tracked_keyword_id, o.observed_at, o.serp_snapshot_id)
        .subquery("per_check")
    )
    numbered = select(
        per_check,
        func.row_number()
        .over(partition_by=per_check.c.tracked_keyword_id, order_by=per_check.c.observed_at.desc())
        .label("n"),
    ).subquery("numbered")
    rows = await db.execute(
        select(numbered)
        .where(numbered.c.n <= SPARKLINE_POINTS)
        .order_by(numbered.c.tracked_keyword_id, numbered.c.observed_at)
    )
    found: dict[UUID, list[SparkPoint]] = {}
    for row in rows:
        found.setdefault(row.tracked_keyword_id, []).append(
            SparkPoint(row.observed_at, row.rank, row.depth)
        )
    return found


async def competitor_ranks_of(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[CompetitorRank]]:
    """Each competitor's rank at the keyword's last check, and at the one before it."""
    if not tracked_ids:
        return {}
    c = domain_rank_observations.c
    previous = domain_rank_observations.alias("previous")
    p = previous.c
    s = tracked_keyword_state.c
    rows = await db.execute(
        entity_refs(project_id)
        .add_columns(
            c.tracked_keyword_id,
            c.organic_rank,
            c.absolute_rank,
            c.depth_requested,
            c.observed_at,
            c.serp_snapshot_id,
            c.ranking_url_id,
            p.organic_rank.label("previous_rank"),
            p.depth_requested.label("previous_depth"),
            p.observed_at.label("previous_at"),
            urls.c.canonical_url,
            urls.c.path.label("url_path"),
            domains.c.host.label("url_host"),
            domains.c.registrable_domain.label("url_registrable_domain"),
        )
        .join(
            domain_rank_observations,
            and_(c.entity_id == entities.c.id, c.workspace_id == entities.c.workspace_id),
        )
        .join(tracked_keyword_state, _at_last_check())  # type: ignore[arg-type]
        .outerjoin(
            previous,
            and_(
                p.tracked_keyword_id == c.tracked_keyword_id,
                p.entity_id == c.entity_id,
                p.workspace_id == c.workspace_id,
                p.observed_at == s.previous_observed_at,
            ),
        )
        .outerjoin(urls, urls.c.id == c.ranking_url_id)
        .outerjoin(domains, domains.c.id == urls.c.domain_id)
        .where(
            c.workspace_id == workspace_id,
            c.role == "competitor",
            among_ids(c.tracked_keyword_id, tracked_ids),
        )
        .order_by(c.tracked_keyword_id, func.lower(entities.c.canonical_name), c.entity_id)
    )
    found: dict[UUID, list[CompetitorRank]] = {}
    for row in rows:
        found.setdefault(row.tracked_keyword_id, []).append(
            CompetitorRank(
                entity=CompetitorRecord(
                    row.id, row.canonical_name, row.entity_type, row.role, row.color_index
                ),
                rank=row.organic_rank,
                absolute_rank=row.absolute_rank,
                depth_requested=row.depth_requested,
                url=None
                if row.ranking_url_id is None
                else _url(
                    row.ranking_url_id,
                    row.canonical_url,
                    row.url_host,
                    row.url_registrable_domain,
                    row.url_path,
                ),
                observed_at=row.observed_at,
                snapshot_id=row.serp_snapshot_id,
                previous_rank=row.previous_rank,
                previous_depth_requested=row.previous_depth,
                previous_observed_at=row.previous_at,
            )
        )
    return found


async def features_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> tuple[dict[UUID, list[FeatureRecord]], dict[UUID, list[UrlRecord]]]:
    """The features of each keyword's last snapshot in page order, and the URLs its AI Overview
    cites (the sources of its `ai_overview` feature)."""
    if not tracked_ids:
        return {}, {}
    f, s = serp_features.c, tracked_keyword_state.c
    rows = await db.execute(
        select(
            f.tracked_keyword_id,
            f.feature_type,
            f.ordinal,
            f.rank_absolute,
            f.owned_by_project,
            f.owned_position,
            f.source_url_ids,
        )
        .select_from(
            serp_features.join(
                tracked_keyword_state,
                and_(
                    s.tracked_keyword_id == f.tracked_keyword_id,
                    s.workspace_id == f.workspace_id,
                    s.last_snapshot_id == f.serp_snapshot_id,
                    s.last_observed_at == f.observed_at,
                ),
            )
        )
        .where(f.workspace_id == workspace_id, among_ids(f.tracked_keyword_id, tracked_ids))
        .order_by(f.tracked_keyword_id, func.coalesce(f.rank_absolute, 10_000), f.id)
    )
    features: dict[UUID, list[FeatureRecord]] = {}
    cited: dict[UUID, list[int]] = {}
    for row in rows:
        features.setdefault(row.tracked_keyword_id, []).append(
            FeatureRecord(
                row.feature_type,
                row.ordinal,
                row.rank_absolute,
                row.owned_by_project,
                row.owned_position,
            )
        )
        if row.feature_type == "ai_overview":
            cited[row.tracked_keyword_id] = list(row.source_url_ids or [])
    wanted = {url_id for ids in cited.values() for url_id in ids}
    refs = await _urls_by_id(db, wanted)
    return features, {
        tracked_id: [refs[url_id] for url_id in ids if url_id in refs]
        for tracked_id, ids in cited.items()
    }


async def _urls_by_id(db: AsyncSession, url_ids: Collection[int]) -> dict[int, UrlRecord]:
    if not url_ids:
        return {}
    rows = await db.execute(
        select(
            urls.c.id,
            urls.c.canonical_url,
            urls.c.path,
            domains.c.host,
            domains.c.registrable_domain,
        )
        .join(domains, domains.c.id == urls.c.domain_id)
        .where(urls.c.id.in_(sorted(url_ids)))
    )
    return {
        row.id: _url(row.id, row.canonical_url, row.host, row.registrable_domain, row.path)
        for row in rows
    }
