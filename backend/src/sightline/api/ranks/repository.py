"""Reads of the rank history and SERP tables (docs/19 section 3.6.4).

The API role reads under row-level security, and every query also names the workspace. A
snapshot is found by its id, its workspace and the project of the path, so a snapshot of another
project is not found. Partitioned tables are read with a time range wherever the route has one,
so PostgreSQL leaves out the months it cannot hold.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.api.keywords.rank_repository import FeatureRecord, urls_by_id
from sightline.api.keywords.repository import CompetitorRecord, UrlRecord, entity_refs
from sightline.db.tables import (
    collection_tasks,
    domain_rank_observations,
    domains,
    entities,
    keyword_group_members,
    keywords,
    project_entities,
    projects,
    rank_events,
    serp_current_results,
    serp_features,
    serp_snapshots,
    tracked_keyword_state,
    tracked_keyword_terms,
    tracked_keywords,
)
from sightline.keywords.trees import descendants

OBS = domain_rank_observations.c
SNAP = serp_snapshots.c


@dataclass(frozen=True, slots=True)
class Observation:
    entity_id: UUID
    role: str
    observed_at: datetime
    snapshot_id: int
    organic_rank: int | None
    absolute_rank: int | None
    ranking_url_id: int | None
    depth_requested: int
    all_url_ids: list[int]
    ranking_title: str | None
    ranking_snippet: str | None
    cited_in_ai_overview: bool | None
    citation_position: int | None


@dataclass(frozen=True, slots=True)
class ProjectZone:
    timezone: str
    deep_check_weekday: int


@dataclass(frozen=True, slots=True)
class EventRow:
    id: int
    occurred_at: datetime
    tracked_keyword_id: UUID
    keyword: str
    entity_id: UUID
    event_type: str
    feature_type: str | None
    from_rank: int | None
    to_rank: int | None
    from_url_id: int | None
    to_url_id: int | None
    other_entity_id: UUID | None
    snapshot_id: int


@dataclass(frozen=True, slots=True)
class SnapshotRow:
    id: int
    observed_at: datetime
    observed_date: Any
    workspace_id: UUID
    project_id: UUID
    tracked_keyword_id: UUID
    config_version: int
    collection_task_id: int | None
    provider_code: str
    provider_endpoint: str
    provider_task_id: str | None
    se_domain: str | None
    location_id: int
    language_code: str
    device: str
    os: str | None
    depth_requested: int
    depth_returned: int
    se_results_count: int | None
    item_types: list[str]
    organic_url_ids: list[int]
    organic_domain_ids: list[int]
    organic_abs_positions: list[int | None]
    has_ai_overview: bool
    ai_overview_state: str | None
    has_ai_mode_link: bool | None
    raw_payload_id: int
    parser_version: int
    canonicalizer_version: int
    cost_usd: Any
    served_from_cache: bool


_SNAPSHOT_COLUMNS = (
    SNAP.id,
    SNAP.observed_at,
    SNAP.observed_date,
    SNAP.workspace_id,
    SNAP.project_id,
    SNAP.tracked_keyword_id,
    SNAP.config_version,
    SNAP.collection_task_id,
    SNAP.provider_code,
    SNAP.provider_endpoint,
    SNAP.provider_task_id,
    SNAP.se_domain,
    SNAP.location_id,
    SNAP.language_code,
    SNAP.device,
    SNAP.os,
    SNAP.depth_requested,
    SNAP.depth_returned,
    SNAP.se_results_count,
    SNAP.item_types,
    SNAP.organic_url_ids,
    SNAP.organic_domain_ids,
    SNAP.organic_abs_positions,
    SNAP.has_ai_overview,
    SNAP.ai_overview_state,
    SNAP.has_ai_mode_link,
    SNAP.raw_payload_id,
    SNAP.parser_version,
    SNAP.canonicalizer_version,
    SNAP.cost_usd,
    SNAP.served_from_cache,
)


def _snapshot(row: Any) -> SnapshotRow:
    return SnapshotRow(**{name: getattr(row, name) for name in SnapshotRow.__dataclass_fields__})


async def project_zone(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> ProjectZone | None:
    row = (
        await db.execute(
            select(projects.c.timezone, projects.c.deep_check_weekday).where(
                projects.c.workspace_id == workspace_id,
                projects.c.id == project_id,
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    return None if row is None else ProjectZone(row.timezone, row.deep_check_weekday)


async def entities_by_ids(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, entity_ids: Collection[UUID]
) -> dict[UUID, CompetitorRecord]:
    """The entities with their live role in the project, if any."""
    if not entity_ids:
        return {}
    rows = await db.execute(
        entity_refs(project_id).where(
            entities.c.workspace_id == workspace_id, entities.c.id.in_(sorted(entity_ids))
        )
    )
    return {
        row.id: CompetitorRecord(
            row.id, row.canonical_name, row.entity_type, row.role, row.color_index
        )
        for row in rows
    }


async def primary_own_entity(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> UUID | None:
    found: UUID | None = (
        await db.execute(
            select(project_entities.c.entity_id).where(
                project_entities.c.workspace_id == workspace_id,
                project_entities.c.project_id == project_id,
                project_entities.c.role == "own",
                project_entities.c.is_primary,
                project_entities.c.removed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return found


async def observations(
    db: AsyncSession,
    workspace_id: UUID,
    tracked_keyword_id: UUID,
    *,
    since: datetime,
    until: datetime,
    entity_ids: Collection[UUID] | None = None,
    snapshot_ids: Collection[int] | None = None,
    roles: Sequence[str] | None = None,
) -> list[Observation]:
    """The rank observations of a keyword in a time range, oldest first."""
    statement = select(domain_rank_observations).where(
        OBS.workspace_id == workspace_id,
        OBS.tracked_keyword_id == tracked_keyword_id,
        OBS.observed_at >= since,
        OBS.observed_at < until,
        OBS.is_valid,
    )
    if entity_ids is not None:
        statement = statement.where(OBS.entity_id.in_(sorted(entity_ids)))
    if snapshot_ids is not None:
        statement = statement.where(OBS.serp_snapshot_id.in_(sorted(snapshot_ids)))
    if roles is not None:
        statement = statement.where(OBS.role.in_(list(roles)))
    rows = await db.execute(
        statement.order_by(OBS.observed_at, OBS.serp_snapshot_id, OBS.entity_id)
    )
    return [
        Observation(
            entity_id=row.entity_id,
            role=row.role,
            observed_at=row.observed_at,
            snapshot_id=row.serp_snapshot_id,
            organic_rank=row.organic_rank,
            absolute_rank=row.absolute_rank,
            ranking_url_id=row.ranking_url_id,
            depth_requested=row.depth_requested,
            all_url_ids=list(row.all_url_ids or []),
            ranking_title=row.ranking_title,
            ranking_snippet=row.ranking_snippet,
            cited_in_ai_overview=row.cited_in_ai_overview,
            citation_position=row.ai_overview_citation_position,
        )
        for row in rows
    ]


async def failed_checks(
    db: AsyncSession,
    workspace_id: UUID,
    tracked_keyword_id: UUID,
    *,
    since: datetime,
    until: datetime,
) -> list[datetime]:
    """When the checks that failed for good were scheduled."""
    t = collection_tasks.c
    rows = await db.execute(
        select(t.scheduled_for)
        .where(
            t.workspace_id == workspace_id,
            t.workload == "seo_rank",
            t.subject_type == "tracked_keyword",
            func.split_part(t.subject_id, ":", 1) == str(tracked_keyword_id),
            t.status.in_(("failed", "dead")),
            t.scheduled_for >= since,
            t.scheduled_for < until,
        )
        .order_by(t.scheduled_for)
    )
    return [row.scheduled_for for row in rows]


async def events_of(
    db: AsyncSession,
    workspace_id: UUID,
    tracked_keyword_id: UUID,
    *,
    entity_ids: Collection[UUID],
    since: datetime,
    until: datetime,
) -> list[EventRow]:
    return await _events(
        db,
        workspace_id,
        [
            rank_events.c.tracked_keyword_id == tracked_keyword_id,
            rank_events.c.entity_id.in_(sorted(entity_ids)),
            rank_events.c.occurred_at >= since,
            rank_events.c.occurred_at < until,
        ],
        order=[rank_events.c.occurred_at, rank_events.c.id],
        limit=5000,
    )


async def _events(
    db: AsyncSession,
    workspace_id: UUID,
    conditions: Sequence[ColumnElement[bool]],
    *,
    order: Sequence[ColumnElement[Any]],
    limit: int,
) -> list[EventRow]:
    e = rank_events.c
    rows = await db.execute(
        select(
            e.id,
            e.occurred_at,
            e.tracked_keyword_id,
            keywords.c.text.label("keyword_text"),
            e.entity_id,
            e.event_type,
            e.feature_type,
            e.from_rank,
            e.to_rank,
            e.from_url_id,
            e.to_url_id,
            e.other_entity_id,
            e.serp_snapshot_id,
        )
        .select_from(
            rank_events.join(
                tracked_keywords,
                and_(
                    tracked_keywords.c.id == e.tracked_keyword_id,
                    tracked_keywords.c.workspace_id == e.workspace_id,
                ),
            ).join(
                keywords,
                and_(
                    keywords.c.id == tracked_keywords.c.keyword_id,
                    keywords.c.workspace_id == tracked_keywords.c.workspace_id,
                ),
            )
        )
        .where(e.workspace_id == workspace_id, *conditions)
        .order_by(*order)
        .limit(limit)
    )
    return [
        EventRow(
            id=row.id,
            occurred_at=row.occurred_at,
            tracked_keyword_id=row.tracked_keyword_id,
            keyword=row.keyword_text,
            entity_id=row.entity_id,
            event_type=row.event_type,
            feature_type=row.feature_type,
            from_rank=row.from_rank,
            to_rank=row.to_rank,
            from_url_id=row.from_url_id,
            to_url_id=row.to_url_id,
            other_entity_id=row.other_entity_id,
            snapshot_id=row.serp_snapshot_id,
        )
        for row in rows
    ]


async def project_events(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    *,
    since: datetime | None,
    until: datetime | None,
    event_types: Sequence[str] | None,
    tracked_keyword_id: UUID | None,
    entity_id: UUID | None,
    group_id: UUID | None,
    term_id: UUID | None,
    after: tuple[datetime, int] | None,
    limit: int,
) -> list[EventRow]:
    """A page of the project's rank events, newest first."""
    e = rank_events.c
    found: list[ColumnElement[bool]] = [e.project_id == project_id]
    if since is not None:
        found.append(e.occurred_at >= since)
    if until is not None:
        found.append(e.occurred_at < until)
    if event_types is not None:
        found.append(e.event_type.in_(list(event_types)))
    if tracked_keyword_id is not None:
        found.append(e.tracked_keyword_id == tracked_keyword_id)
    if entity_id is not None:
        found.append(e.entity_id == entity_id)
    if group_id is not None:
        found.append(
            e.tracked_keyword_id.in_(
                select(keyword_group_members.c.tracked_keyword_id).where(
                    keyword_group_members.c.workspace_id == workspace_id,
                    keyword_group_members.c.group_id.in_(
                        descendants("group", [group_id], workspace_id, "event_groups")
                    ),
                )
            )
        )
    if term_id is not None:
        found.append(
            e.tracked_keyword_id.in_(
                select(tracked_keyword_terms.c.tracked_keyword_id).where(
                    tracked_keyword_terms.c.workspace_id == workspace_id,
                    tracked_keyword_terms.c.term_id.in_(
                        descendants("term", [term_id], workspace_id, "event_terms")
                    ),
                )
            )
        )
    if after is not None:
        found.append(
            or_(e.occurred_at < after[0], and_(e.occurred_at == after[0], e.id < after[1]))
        )
    return await _events(
        db,
        workspace_id,
        found,
        order=[e.occurred_at.desc(), e.id.desc()],
        limit=limit,
    )


async def snapshots_of(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    tracked_keyword_id: UUID,
    *,
    since: datetime | None,
    until: datetime | None,
    depth_requested: int | None,
    has_ai_overview: bool | None,
    after: tuple[datetime, int] | None,
    limit: int,
) -> list[SnapshotRow]:
    """A page of a keyword's snapshots, newest first."""
    statement = select(*_SNAPSHOT_COLUMNS).where(
        SNAP.workspace_id == workspace_id,
        SNAP.project_id == project_id,
        SNAP.tracked_keyword_id == tracked_keyword_id,
    )
    if since is not None:
        statement = statement.where(SNAP.observed_at >= since)
    if until is not None:
        statement = statement.where(SNAP.observed_at < until)
    if depth_requested is not None:
        statement = statement.where(SNAP.depth_requested == depth_requested)
    if has_ai_overview is not None:
        statement = statement.where(SNAP.has_ai_overview.is_(has_ai_overview))
    if after is not None:
        statement = statement.where(
            or_(SNAP.observed_at < after[0], and_(SNAP.observed_at == after[0], SNAP.id < after[1]))
        )
    rows = await db.execute(
        statement.order_by(SNAP.observed_at.desc(), SNAP.id.desc()).limit(limit)
    )
    return [_snapshot(row) for row in rows]


async def snapshot_by_id(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    snapshot_id: int,
    observed_at: datetime | None,
) -> SnapshotRow | None:
    statement = select(*_SNAPSHOT_COLUMNS).where(
        SNAP.workspace_id == workspace_id,
        SNAP.project_id == project_id,
        SNAP.id == snapshot_id,
    )
    if observed_at is not None:
        statement = statement.where(SNAP.observed_at == observed_at)
    row = (await db.execute(statement.limit(1))).one_or_none()
    return None if row is None else _snapshot(row)


@dataclass(frozen=True, slots=True)
class FeatureRow:
    snapshot_id: int
    observed_at: datetime
    feature: FeatureRecord
    source_url_ids: list[int]
    competitor_entity_ids: list[UUID]
    payload: dict[str, object] | None


async def features_in(
    db: AsyncSession,
    workspace_id: UUID,
    tracked_keyword_id: UUID,
    snapshot_ids: Collection[int],
    *,
    since: datetime,
    until: datetime,
) -> list[FeatureRow]:
    if not snapshot_ids:
        return []
    f = serp_features.c
    rows = await db.execute(
        select(serp_features)
        .where(
            f.workspace_id == workspace_id,
            f.tracked_keyword_id == tracked_keyword_id,
            f.observed_at >= since,
            f.observed_at < until,
            f.serp_snapshot_id.in_(sorted(snapshot_ids)),
        )
        .order_by(f.observed_at, f.serp_snapshot_id, func.coalesce(f.rank_absolute, 10_000), f.id)
    )
    return [
        FeatureRow(
            snapshot_id=row.serp_snapshot_id,
            observed_at=row.observed_at,
            feature=FeatureRecord(
                row.feature_type,
                row.ordinal,
                row.rank_absolute,
                row.owned_by_project,
                row.owned_position,
            ),
            source_url_ids=list(row.source_url_ids or []),
            competitor_entity_ids=list(row.competitor_entity_ids or []),
            payload=row.payload,
        )
        for row in rows
    ]


@dataclass(frozen=True, slots=True)
class CurrentResult:
    organic_rank: int
    absolute_rank: int | None
    url_id: int
    domain_id: int
    title: str | None
    snippet: str | None
    snapshot_id: int


async def current_results(
    db: AsyncSession, workspace_id: UUID, tracked_keyword_id: UUID
) -> tuple[list[CurrentResult], datetime | None]:
    """The keyword's current top results and when they were observed."""
    c = serp_current_results.c
    rows = await db.execute(
        select(serp_current_results)
        .where(c.workspace_id == workspace_id, c.tracked_keyword_id == tracked_keyword_id)
        .order_by(c.organic_rank)
    )
    results = [
        CurrentResult(
            organic_rank=row.organic_rank,
            absolute_rank=row.absolute_rank,
            url_id=row.url_id,
            domain_id=row.domain_id,
            title=row.title,
            snippet=row.snippet,
            snapshot_id=row.serp_snapshot_id,
        )
        for row in rows
    ]
    observed_at = (
        await db.execute(
            select(tracked_keyword_state.c.last_observed_at).where(
                tracked_keyword_state.c.workspace_id == workspace_id,
                tracked_keyword_state.c.tracked_keyword_id == tracked_keyword_id,
            )
        )
    ).scalar_one_or_none()
    return results, observed_at


async def domains_by_id(
    db: AsyncSession, domain_ids: Collection[int]
) -> dict[int, tuple[str, str]]:
    if not domain_ids:
        return {}
    rows = await db.execute(
        select(domains.c.id, domains.c.host, domains.c.registrable_domain).where(
            domains.c.id.in_(sorted(domain_ids))
        )
    )
    return {row.id: (row.host, row.registrable_domain) for row in rows}


async def urls_for_ids(db: AsyncSession, url_ids: Collection[int]) -> dict[int, UrlRecord]:
    return await urls_by_id(db, url_ids)


async def raw_payload(db: AsyncSession, snapshot_id: int) -> Any:
    """The registry row of a snapshot's payload, through the function that checks the workspace."""
    return (
        await db.execute(
            text("SELECT * FROM seo.serp_snapshot_raw(:snapshot_id)"), {"snapshot_id": snapshot_id}
        )
    ).first()


async def effective_check_ids(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    tracked_keyword_id: UUID,
    *,
    since: datetime,
    until: datetime,
    limit: int,
) -> list[tuple[int, datetime, int]]:
    """The last `limit` snapshots of a keyword in a range, newest first, with their depth."""
    rows = await db.execute(
        select(SNAP.id, SNAP.observed_at, SNAP.depth_requested)
        .where(
            SNAP.workspace_id == workspace_id,
            SNAP.project_id == project_id,
            SNAP.tracked_keyword_id == tracked_keyword_id,
            SNAP.observed_at >= since,
            SNAP.observed_at < until,
        )
        .order_by(SNAP.observed_at.desc(), SNAP.id.desc())
        .limit(limit)
    )
    return [(row.id, row.observed_at, row.depth_requested) for row in rows]
