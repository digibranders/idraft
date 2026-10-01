"""Writing tracked keywords: by the API (single, bulk) and by imports in the worker.

Runs inside the caller's transaction. The worker bypasses row-level security, so every
statement names the workspace. Writers of one workspace take a lock first, so they count and
write one after the other (plan decision D4).
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, time
from decimal import Decimal
from typing import Final, Literal
from uuid import UUID

from sqlalchemy import and_, func, insert, literal, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import (
    keywords,
    projects,
    schedules,
    tracked_keyword_config_history,
    tracked_keywords,
    workspace_quotas,
)
from sightline.domain.schedules import Cadence, ScheduleRule, next_occurrence
from sightline.keywords.text import normalize

Device = Literal["desktop", "mobile"]
DeviceChoice = Literal["desktop", "mobile", "both"]
Source = Literal["manual", "csv_import", "api", "gsc_import", "discovery", "bulk_paste"]
ExistingState = Literal["live", "archived"]


@dataclass(frozen=True, slots=True)
class MetricsSchedule:
    """The project's monthly metrics refresh (plan decision D8; docs/06 section 7.2): on the
    20th, after Google's mid-month update, for keywords whose metrics are 25 days old."""

    name: str = "Keyword metrics"
    month_day: int = 20
    window_start_local: time = time(3, 0)
    window_hours: int = 2
    stale_days: int = 25


METRICS_SCHEDULE: Final = MetricsSchedule()
# `core.workspace_quotas.max_tracked_keywords` when a workspace has no row yet; a test keeps
# the two equal.
DEFAULT_TRACKED_KEYWORD_LIMIT: Final = 5000
# Items per call: an insert of 1,000 rows stays well under the 32,767 parameters a statement
# may carry. Imports write in batches of this size.
WRITE_MAX: Final = 1000


@dataclass(frozen=True, slots=True)
class NewTrackedKeyword:
    """One tracked keyword to add; the caller has checked its text (`check_keyword`)."""

    text: str
    location_id: int
    language_code: str
    device: Device
    search_engine: str = "google"
    os: str | None = None
    depth_profile: str = "standard"
    target_url_id: int | None = None
    intent: str = "unknown"
    intent_source: str | None = None
    funnel_stage: str = "unknown"
    priority: int = 3
    business_value: Decimal | None = None
    frequency: str = "daily"
    schedule_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class Created:
    index: int  # into the items given
    tracked_keyword_id: UUID
    keyword_id: UUID
    restored: bool  # a deleted identity brought back (plan decision D3)


@dataclass(frozen=True, slots=True)
class Existing:
    index: int
    tracked_keyword_id: UUID
    state: ExistingState


@dataclass(frozen=True, slots=True)
class WriteResult:
    created: list[Created]
    existing: list[Existing]


class ProjectGoneError(LookupError):
    """The project does not exist in the workspace, or was deleted; nothing was written."""

    def __init__(self, project_id: UUID) -> None:
        super().__init__(f"no live project {project_id}")
        self.project_id = project_id


class QuotaExceededError(Exception):
    """Writing would take the workspace over its tracked keyword limit; nothing was written."""

    def __init__(self, *, limit: int, used: int, requested: int) -> None:
        super().__init__(f"{used} of {limit} tracked keywords used; {requested} more requested")
        self.limit = limit
        self.used = used
        self.requested = requested


async def lock_quota(db: AsyncSession, workspace_id: UUID) -> tuple[int, int]:
    """The workspace's tracked keyword limit and its active tracked keywords. Writers of one
    workspace wait for each other until the transaction ends (an advisory lock, since the
    worker may read the quota row but not lock it). A workspace without a quota row has the
    default limit."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"tracked_keywords:{workspace_id}"), 0)
            )
        )
    )
    stored: int | None = (
        await db.execute(
            select(workspace_quotas.c.max_tracked_keywords).where(
                workspace_quotas.c.workspace_id == workspace_id
            )
        )
    ).scalar_one_or_none()
    limit = DEFAULT_TRACKED_KEYWORD_LIMIT if stored is None else stored
    # A deleted project's keywords are gone for the count; an archived project's still hold
    # their place, so bringing a project back never takes the workspace over its limit.
    used: int = (
        await db.execute(
            select(func.count())
            .select_from(
                tracked_keywords.join(
                    projects,
                    and_(
                        projects.c.id == tracked_keywords.c.project_id,
                        projects.c.workspace_id == tracked_keywords.c.workspace_id,
                    ),
                )
            )
            .where(
                tracked_keywords.c.workspace_id == workspace_id,
                tracked_keywords.c.deleted_at.is_(None),
                tracked_keywords.c.is_active,
                projects.c.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    return limit, used


def devices(choice: DeviceChoice) -> tuple[Device, ...]:
    """`both` is two measurements, so two tracked keywords: desktop, then mobile."""
    if choice == "both":
        return ("desktop", "mobile")
    return (choice,)


def check_quota(limit: int, used: int, requested: int) -> None:
    if requested and used + requested > limit:
        raise QuotaExceededError(limit=limit, used=used, requested=requested)


type KeywordKey = tuple[str, str]  # (normalized text, language)
type Identity = tuple[UUID, str, int, str, str]  # keyword, engine, location, language, device


def _keyword_key(item: NewTrackedKeyword) -> KeywordKey:
    return (normalize(item.text), item.language_code)


async def _known_keywords(
    db: AsyncSession, workspace_id: UUID, wanted: Collection[KeywordKey]
) -> dict[KeywordKey, UUID]:
    """The workspace's keywords among `wanted`; read only."""
    rows = await db.execute(
        select(keywords.c.id, keywords.c.normalized_text, keywords.c.language_code).where(
            keywords.c.workspace_id == workspace_id,
            tuple_(keywords.c.normalized_text, keywords.c.language_code).in_(list(wanted)),
        )
    )
    return {(row.normalized_text, row.language_code): row.id for row in rows}


async def _create_keywords(
    db: AsyncSession, workspace_id: UUID, first_text: Mapping[KeywordKey, str]
) -> dict[KeywordKey, UUID]:
    """Keywords for these keys, with the text entered first. Writers of the workspace hold its
    lock, so none of them exists yet; the conflict clause is a second guard."""
    if not first_text:
        return {}
    await db.execute(
        upsert(keywords)
        .values(
            [
                {
                    "workspace_id": workspace_id,
                    "text": text,
                    "normalized_text": normalized,
                    "language_code": language,
                }
                for (normalized, language), text in first_text.items()
            ]
        )
        .on_conflict_do_nothing()
    )
    return await _known_keywords(db, workspace_id, first_text)


async def _rows_of(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, identities: Collection[Identity]
) -> dict[Identity, tuple[UUID, bool, bool]]:
    """The project's rows for these identities, deleted ones included: id, active, deleted."""
    if not identities:
        return {}
    t = tracked_keywords.c
    key = tuple_(t.keyword_id, t.search_engine, t.location_id, t.language_code, t.device)
    rows = await db.execute(
        select(
            t.id,
            t.keyword_id,
            t.search_engine,
            t.location_id,
            t.language_code,
            t.device,
            t.is_active,
            t.deleted_at,
        ).where(
            t.workspace_id == workspace_id, t.project_id == project_id, key.in_(list(identities))
        )
    )
    return {
        (row.keyword_id, row.search_engine, row.location_id, row.language_code, row.device): (
            row.id,
            row.is_active,
            row.deleted_at is not None,
        )
        for row in rows
    }


async def _check_project(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> None:
    found = await db.execute(
        select(projects.c.id).where(
            projects.c.workspace_id == workspace_id,
            projects.c.id == project_id,
            projects.c.deleted_at.is_(None),
        )
    )
    if found.first() is None:
        raise ProjectGoneError(project_id)


async def write_tracked_keywords(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    items: Sequence[NewTrackedKeyword],
    source: Source,
    created_by: UUID | None,
    now: datetime,
) -> WriteResult:
    """Adds the items that are new and brings back deleted ones, under the quota; reports the
    ones the project tracks already (live or archived), an identity repeated in `items`
    included.

    Raises `QuotaExceededError` when they would not fit and `ProjectGoneError` for a project
    that does not exist or was deleted; nothing is written before either is raised. At most
    `WRITE_MAX` items per call (a statement carries a bounded number of parameters)."""
    if not items:
        return WriteResult(created=[], existing=[])
    if len(items) > WRITE_MAX:
        raise ValueError(f"at most {WRITE_MAX} tracked keywords are written per call")
    limit, used = await lock_quota(db, workspace_id)
    await _check_project(db, workspace_id, project_id)
    keys = [_keyword_key(item) for item in items]
    known = await _known_keywords(db, workspace_id, set(keys))

    # Classified before anything is written: a keyword the workspace does not have yet is a
    # new identity in this project.
    stored = await _rows_of(
        db,
        workspace_id,
        project_id,
        {
            _identity(known[key], item)
            for key, item in zip(keys, items, strict=True)
            if key in known
        },
    )
    existing: dict[int, Existing] = {}
    to_restore: list[tuple[int, UUID]] = []
    to_insert: list[int] = []
    first_of: dict[tuple[KeywordKey, str, int, str], int] = {}
    repeats: list[tuple[int, int]] = []  # (index, index of the first item with its identity)
    for index, (key, item) in enumerate(zip(keys, items, strict=True)):
        same = (key, item.search_engine, item.location_id, item.device)
        if same in first_of:
            repeats.append((index, first_of[same]))
            continue
        first_of[same] = index
        row = stored.get(_identity(known[key], item)) if key in known else None
        if row is None:
            to_insert.append(index)
        elif row[2]:
            to_restore.append((index, row[0]))
        else:
            existing[index] = Existing(index, row[0], "live" if row[1] else "archived")
    check_quota(limit, used, len(to_insert) + len(to_restore))

    first_text: dict[KeywordKey, str] = {}
    for index in to_insert:
        if keys[index] not in known:
            first_text.setdefault(keys[index], items[index].text)
    keyword_of = {**known, **await _create_keywords(db, workspace_id, first_text)}

    created_ids: dict[int, UUID] = {}
    if to_restore:
        await db.execute(
            update(tracked_keywords)
            .where(
                tracked_keywords.c.workspace_id == workspace_id,
                tracked_keywords.c.id.in_([row_id for _, row_id in to_restore]),
            )
            .values(deleted_at=None, is_active=True, updated_at=now)
        )
        created_ids.update(dict(to_restore))
    if to_insert:
        created_ids.update(
            await _insert(
                db,
                {index: (items[index], keyword_of[keys[index]]) for index in to_insert},
                workspace_id=workspace_id,
                project_id=project_id,
                source=source,
                created_by=created_by,
                now=now,
            )
        )
        await ensure_metrics_schedule(db, workspace_id=workspace_id, project_id=project_id, now=now)

    restored = {index for index, _ in to_restore}
    created = [
        Created(index, created_ids[index], keyword_of[keys[index]], index in restored)
        for index in sorted(created_ids)
    ]
    for index, first in repeats:
        if first in created_ids:
            existing[index] = Existing(index, created_ids[first], "live")
        else:
            existing[index] = Existing(
                index, existing[first].tracked_keyword_id, existing[first].state
            )
    return WriteResult(created=created, existing=[existing[index] for index in sorted(existing)])


def _identity(keyword_id: UUID, item: NewTrackedKeyword) -> Identity:
    return (keyword_id, item.search_engine, item.location_id, item.language_code, item.device)


async def _insert(
    db: AsyncSession,
    new: Mapping[int, tuple[NewTrackedKeyword, UUID]],
    *,
    workspace_id: UUID,
    project_id: UUID,
    source: Source,
    created_by: UUID | None,
    now: datetime,
) -> dict[int, UUID]:
    """Inserts the new rows and their first configuration version; their ids by item index.
    Rows are matched back by identity: RETURNING promises no order."""
    t = tracked_keywords.c
    inserted = await db.execute(
        insert(tracked_keywords)
        .values(
            [
                _row(
                    item,
                    keyword_id,
                    workspace_id=workspace_id,
                    project_id=project_id,
                    source=source,
                    created_by=created_by,
                    now=now,
                )
                for item, keyword_id in new.values()
            ]
        )
        .returning(t.id, t.keyword_id, t.search_engine, t.location_id, t.language_code, t.device)
    )
    by_identity = {
        (row.keyword_id, row.search_engine, row.location_id, row.language_code, row.device): row.id
        for row in inserted
    }
    ids = {
        index: by_identity[_identity(keyword_id, item)] for index, (item, keyword_id) in new.items()
    }
    await db.execute(
        insert(tracked_keyword_config_history).values(
            [
                {
                    "tracked_keyword_id": ids[index],
                    "workspace_id": workspace_id,
                    "config_version": 1,
                    "depth_profile": item.depth_profile,
                    "target_url_id": item.target_url_id,
                    "valid_from": now,
                    "changed_by": created_by,
                }
                for index, (item, _) in new.items()
            ]
        )
    )
    return ids


def _row(
    item: NewTrackedKeyword,
    keyword_id: UUID,
    *,
    workspace_id: UUID,
    project_id: UUID,
    source: Source,
    created_by: UUID | None,
    now: datetime,
) -> dict[str, object]:
    return {
        "workspace_id": workspace_id,
        "project_id": project_id,
        "keyword_id": keyword_id,
        "search_engine": item.search_engine,
        "location_id": item.location_id,
        "language_code": item.language_code,
        "device": item.device,
        "os": item.os,
        "depth_profile": item.depth_profile,
        "target_url_id": item.target_url_id,
        "intent": item.intent,
        "intent_source": item.intent_source,
        "funnel_stage": item.funnel_stage,
        "priority": item.priority,
        "business_value": item.business_value,
        "frequency": item.frequency,
        "schedule_id": item.schedule_id,
        "source": source,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }


async def ensure_metrics_schedule(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, now: datetime
) -> None:
    """The project's monthly keyword metrics schedule, made with its first tracked keyword
    (plan decision D8). One a person paused or changed is left as it is."""
    found = await db.execute(
        select(schedules.c.id).where(
            schedules.c.workspace_id == workspace_id,
            schedules.c.project_id == project_id,
            schedules.c.workload == "keyword_metrics",
        )
    )
    if found.first() is not None:
        return
    timezone: str = (
        await db.execute(
            select(projects.c.timezone).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).scalar_one()
    rule = ScheduleRule(
        cadence=Cadence.MONTHLY,
        timezone=timezone,
        window_start_local=METRICS_SCHEDULE.window_start_local,
        month_day=METRICS_SCHEDULE.month_day,
    )
    await db.execute(
        insert(schedules).values(
            workspace_id=workspace_id,
            project_id=project_id,
            workload="keyword_metrics",
            name=METRICS_SCHEDULE.name,
            cadence=rule.cadence.value,
            month_day=METRICS_SCHEDULE.month_day,
            timezone=timezone,
            window_start_local=METRICS_SCHEDULE.window_start_local,
            window_hours=METRICS_SCHEDULE.window_hours,
            provider_mode="live",
            selector={"stale_days": METRICS_SCHEDULE.stale_days},
            next_run_at=next_occurrence(rule, now),
        )
    )
