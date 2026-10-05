"""Rank checks from Google organic SERPs (docs/06-dataforseo-seo-integration.md sections 2 and 3;
docs/21-scheduler-workers.md section 3): the workload that plans a task for each tracked keyword
due in a window and builds its `task_post` request, and the tick that checks new keywords at
once.

A task is one tracked keyword at one depth: subject type `tracked_keyword`, subject id
`<tracked_keyword_id>:<depth>`, the location in its column. The depth is in the subject because
the ledger keeps no other copy of it, and the request is built from the task alone. Every read
names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Final
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from pydantic import ValidationError
from sqlalchemy import ColumnElement, Text, and_, cast, exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ledger import LedgerTask, NewRun, NewTask, TaskRef
from sightline.collectors.registry import Plan, ScheduleWindow
from sightline.db.tables import (
    collection_runs,
    collection_tasks,
    keyword_group_members,
    keywords,
    projects,
    provider_location_map,
    provider_price_book,
    serp_snapshots,
    tracked_keyword_terms,
    tracked_keywords,
    workspaces,
)
from sightline.domain.tasks import scheduled_for
from sightline.domain.workloads import TaskWorkload
from sightline.keywords.trees import descendants
from sightline.providers.contract import CanonicalRequest
from sightline.providers.dataforseo.provider import CODE as DATAFORSEO
from sightline.providers.dataforseo.serp import SERP_ORGANIC, SerpOrganicParams
from sightline.ranks.depth import UNAVAILABLE, depth_for, pages

WORKLOAD: Final = TaskWorkload.SEO_RANK
SUBJECT_TYPE: Final = "tracked_keyword"
ADAPTER: Final = "dataforseo_serp_google_organic_task@1"
KEYWORD_MAX: Final = 700
# A new keyword is not checked again at once while a task for it is this recent, finished or
# not, so a keyword whose task failed is not paid for every minute (as for metrics, plan D8).
NEW_KEYWORD_QUIET: Final = timedelta(hours=24)
# How long a run the tick starts has to send its tasks.
MANUAL_WINDOW: Final = timedelta(hours=1)
# A keyword's check on a day is kept by every run but these.
_NOT_CHECKED: Final = ("cancelled", "failed", "dead")
_log = structlog.get_logger(__name__)


def subject_id(tracked_keyword_id: UUID, depth: int) -> str:
    return f"{tracked_keyword_id}:{depth}"


def parse_subject(subject: str) -> tuple[UUID, int] | None:
    """The tracked keyword and depth of a subject id; None for one this workload did not make."""
    keyword, _, depth = subject.partition(":")
    try:
        parsed = int(depth)
        return UUID(keyword), parsed
    except ValueError:
        return None


@dataclass(frozen=True, slots=True)
class Subject:
    tracked_keyword_id: UUID
    location_id: int
    depth: int


@dataclass(frozen=True, slots=True)
class _Zone:
    timezone: str
    deep_check_weekday: int


# Planning.


def local_day(zone: str, at: datetime) -> tuple[date, datetime, datetime]:
    """The project-local day `at` falls on, as its date and the UTC instants it starts and ends."""
    tz = ZoneInfo(zone)
    day = at.astimezone(tz).date()
    # In UTC: two datetimes of one zone subtract as wall clocks, which a clock change makes wrong.
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)
    return day, start, end


def is_deep_day(day: date, deep_check_weekday: int) -> bool:
    """Whether the project's deep check falls on this local day (0 is Sunday)."""
    return day.isoweekday() % 7 == deep_check_weekday


def _recent_task(now: datetime) -> ColumnElement[bool]:
    """A task for the keyword from a run made within `NEW_KEYWORD_QUIET`. The run's time, not
    the task's: the ledger gives a task the start of its window's month as `created_at`."""
    t, task, run = tracked_keywords.c, collection_tasks.c, collection_runs.c
    return exists().where(
        task.workload == WORKLOAD.value,
        task.subject_type == SUBJECT_TYPE,
        func.split_part(task.subject_id, ":", 1) == cast(t.id, Text),
        task.workspace_id == t.workspace_id,
        run.id == task.run_id,
        run.workspace_id == task.workspace_id,
        run.created_at >= now - NEW_KEYWORD_QUIET,
    )


def _has_snapshot() -> ColumnElement[bool]:
    s, t = serp_snapshots.c, tracked_keywords.c
    return exists().where(s.tracked_keyword_id == t.id, s.workspace_id == t.workspace_id)


def _checked_today_elsewhere(
    schedule_id: UUID | None, start: datetime, end: datetime
) -> ColumnElement[bool]:
    """Another schedule's run of the same project-local day has a task for the keyword (a
    keyword is planned once a day across `seo_rank` schedules)."""
    t, task, run = tracked_keywords.c, collection_tasks.c, collection_runs.c
    return exists().where(
        task.workload == WORKLOAD.value,
        task.subject_type == SUBJECT_TYPE,
        func.split_part(task.subject_id, ":", 1) == cast(t.id, Text),
        task.workspace_id == t.workspace_id,
        # By the task, not the run: a cancelled run still pays for the tasks it had sent.
        task.status.not_in(_NOT_CHECKED),
        run.id == task.run_id,
        run.workspace_id == task.workspace_id,
        run.window_start >= start,
        run.window_start < end,
        run.schedule_id.is_distinct_from(schedule_id),
    )


def _uuids(values: Any) -> list[UUID]:
    return [UUID(str(value)) for value in values]


async def _zone(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> _Zone | None:
    row = (
        await db.execute(
            select(projects.c.timezone, projects.c.deep_check_weekday).where(
                projects.c.workspace_id == workspace_id, projects.c.id == project_id
            )
        )
    ).one_or_none()
    return None if row is None else _Zone(row.timezone, row.deep_check_weekday)


async def select_subjects(
    db: AsyncSession,
    window: ScheduleWindow,
) -> list[Subject]:
    """The project's actively tracked keywords the selector names that are due, once each, at
    the depth their profile gives for the window's project-local day.

    The selector: `all`, `groups`, `terms` (those under them included) and `priority_lte` narrow
    what is checked; `new` takes the keywords never checked and not asked about in the last
    `NEW_KEYWORD_QUIET`. A selector that names none of them selects nothing. A tracked keyword
    that names a schedule is left to it by every other schedule, and is planned once a
    project-local day across schedules. A profile with no check that day (`weekly` away from the
    deep-check weekday) plans nothing."""
    selector, workspace_id, project_id = window.selector, window.workspace_id, window.project_id
    zone = await _zone(db, workspace_id, project_id)
    if zone is None:
        return []
    day, day_start, day_end = local_day(zone.timezone, window.window_start)
    t, k, p = tracked_keywords.c, keywords.c, projects.c
    statement = (
        select(t.id, t.location_id, t.depth_profile)
        .select_from(
            tracked_keywords.join(
                keywords, and_(k.id == t.keyword_id, k.workspace_id == t.workspace_id)
            )
            .join(projects, and_(p.id == t.project_id, p.workspace_id == t.workspace_id))
            .join(workspaces, workspaces.c.id == t.workspace_id)
        )
        .where(
            t.workspace_id == workspace_id,
            t.project_id == project_id,
            t.deleted_at.is_(None),
            t.is_active,
            t.search_engine == "google",
            p.deleted_at.is_(None),
            func.char_length(k.text) <= KEYWORD_MAX,
            t.depth_profile.not_in(sorted(UNAVAILABLE)),
        )
    )
    new = bool(selector.get("new"))
    narrowed = False
    groups = selector.get("groups")
    if groups:
        narrowed = True
        members = keyword_group_members.c
        statement = statement.where(
            exists().where(
                members.tracked_keyword_id == t.id,
                members.workspace_id == workspace_id,
                members.group_id.in_(
                    descendants("group", _uuids(groups), workspace_id, "selected_groups")
                ),
            )
        )
    terms = selector.get("terms")
    if terms:
        narrowed = True
        assigned = tracked_keyword_terms.c
        statement = statement.where(
            exists().where(
                assigned.tracked_keyword_id == t.id,
                assigned.workspace_id == workspace_id,
                assigned.term_id.in_(
                    descendants("term", _uuids(terms), workspace_id, "selected_terms")
                ),
            )
        )
    priority_lte = selector.get("priority_lte")
    if priority_lte is not None:
        narrowed = True
        statement = statement.where(t.priority <= int(priority_lte))
    if not (new or selector.get("all") or narrowed):
        return []
    if new:
        statement = statement.where(~_has_snapshot(), ~_recent_task(window.window_start))
    else:
        if window.schedule_id is not None:
            statement = statement.where(
                or_(t.schedule_id.is_(None), t.schedule_id == window.schedule_id)
            )
        statement = statement.where(
            ~_checked_today_elsewhere(window.schedule_id, day_start, day_end)
        )

    deep_day = is_deep_day(day, zone.deep_check_weekday)
    found: list[Subject] = []
    for row in await db.execute(statement):
        depth = depth_for(row.depth_profile, deep_day=deep_day)
        if depth is None and new:
            # A keyword with no check today (a weekly profile) still gets its first one now.
            depth = depth_for(row.depth_profile, deep_day=True)
        if depth is not None:
            found.append(Subject(row.id, row.location_id, depth))
    return sorted(found, key=lambda s: (s.location_id, str(s.tracked_keyword_id)))


def queue_of(provider_mode: str) -> str:
    """The DataForSEO queue a window's tasks go to: the priority queue only when the schedule
    chose it. A manual run, whatever its mode, is a standard task."""
    return "priority" if provider_mode == "priority_queue" else "standard"


async def estimate(
    db: AsyncSession, subjects: Sequence[Subject], *, queue: str, on: date
) -> Decimal | None:
    """What the subjects cost by the price book: the pages of each depth at the queue's price,
    and the asynchronous AI Overview each task adds (its own price row, else the queue's price of
    a page: the additive reading of doc 06 section 6.2). None, and an error in the log, when the
    book has no page price: a run is never planned on a guess of zero."""
    if not subjects:
        return Decimal(0)
    p = provider_price_book.c
    rows = await db.execute(
        select(p.price_unit, p.unit_price_usd, p.conditions)
        .where(
            p.provider_code == DATAFORSEO,
            p.endpoint == SERP_ORGANIC,
            p.valid_from <= on,
            (p.valid_to.is_(None)) | (p.valid_to > on),
        )
        # The newest row for a price wins, whatever order the database returns them in.
        .order_by(p.valid_from, p.unit_price_usd)
    )
    page = surcharge = None
    for row in rows:
        conditions = row.conditions or {}
        if conditions.get("queue") != queue:
            continue
        if row.price_unit == "page" and not conditions.get("async_ai_overview"):
            page = Decimal(row.unit_price_usd)
        elif row.price_unit == "task" and conditions.get("async_ai_overview"):
            surcharge = Decimal(row.unit_price_usd)
    if page is None:
        _log.error("no price for SERP pages", queue=queue, on=on.isoformat())
        return None
    total = sum((pages(s.depth) for s in subjects), 0) * page
    return total + len(subjects) * (page if surcharge is None else surcharge)


def _due(window: ScheduleWindow, subject: Subject) -> datetime:
    """When a task is due. A schedule's tasks are spread over its window; a manual run (the
    first check of a new keyword) has someone waiting, so its tasks are due at once."""
    if window.schedule_id is None:
        return window.window_start
    return scheduled_for(
        window_start=window.window_start,
        subject_id=str(subject.tracked_keyword_id),
        workload=WORKLOAD.value,
        window_hours=window.window_hours,
    )


def new_tasks(subjects: Sequence[Subject], window: ScheduleWindow) -> list[NewTask]:
    """One task per subject, each at its own place in the window: the same place every run, so
    a keyword is checked at about the same local time every day."""
    queue = queue_of(window.provider_mode)
    return [
        NewTask(
            subject_type=SUBJECT_TYPE,
            subject_id=subject_id(subject.tracked_keyword_id, subject.depth),
            engine_code=None,
            location_id=subject.location_id,
            replicate_index=1,
            depth=subject.depth,
            request_fingerprint=hashlib.sha256(
                f"{subject.tracked_keyword_id}:{subject.depth}:{subject.location_id}:{queue}".encode()
            ).digest(),
            provider_code=DATAFORSEO,
            provider_endpoint=SERP_ORGANIC,
            scheduled_for=_due(window, subject),
        )
        for subject in subjects
    ]


class SeoRankWorkload:
    """Plans rank tasks for a schedule's window or a manual run, and builds their SERP
    requests."""

    name: Final = WORKLOAD

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        subjects = await select_subjects(db, window)
        queue = queue_of(window.provider_mode)
        cost = await estimate(db, subjects, queue=queue, on=window.window_start.date())
        snapshot: dict[str, Any] = {
            "adapter": ADAPTER,
            "provider_mode": window.provider_mode,
            "queue": queue,
            "selector": dict(window.selector),
        }
        if cost is None:
            # Nothing is planned without a price to check the budget against.
            return Plan(tasks=[], estimated_cost_usd=Decimal(0), config_snapshot=snapshot)
        return Plan(
            tasks=new_tasks(subjects, window), estimated_cost_usd=cost, config_snapshot=snapshot
        )

    def batch_key(self, task: LedgerTask) -> str:
        """Any rank tasks may go in one `task_post`."""
        return ""

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        """Each task's keyword, as entered, at its location's DataForSEO code and its depth. A
        task whose keyword is gone is left out."""
        wanted = {}
        for task in tasks:
            parsed = parse_subject(task.subject_id)
            if parsed is not None and task.location_id is not None:
                wanted[task.ref] = (task, parsed)
        rows = await _keywords(
            db, {(parsed[0], task.workspace_id) for task, parsed in wanted.values()}
        )
        codes = await _location_codes(db, {task.location_id for task, _ in wanted.values()})
        queues = await _queues(db, {task.run_id for task, _ in wanted.values()})
        requests: dict[TaskRef, CanonicalRequest] = {}
        for ref, (task, (tracked_id, depth)) in wanted.items():
            row = rows.get((tracked_id, task.workspace_id))
            if row is None or task.location_id is None:
                continue
            try:
                params = SerpOrganicParams(
                    keyword=row.text,
                    location_code=codes.get(task.location_id, task.location_id),
                    language_code=row.language_code,
                    device=row.device,
                    os=row.os,
                    depth=depth,
                    queue="priority" if queues.get(task.run_id) == "priority" else "standard",
                )
            except ValidationError as error:
                # One keyword the provider would refuse (an operating system of the other
                # device) must not take the tasks it is batched with down: it is left out and
                # its outcome recorded as a request that could not be built.
                _log.warning("rank request not built", task=task.ref.id, error=str(error)[:200])
                continue
            requests[ref] = CanonicalRequest(
                task_id=str(task.ref.id),
                run_id=task.run_id,
                priority="high" if task.priority == "high" else "standard",
                params=params,
            )
        return requests


@dataclass(frozen=True, slots=True)
class _KeywordRow:
    text: str
    language_code: str
    device: str
    os: str | None


async def _keywords(
    db: AsyncSession, keys: Collection[tuple[UUID, UUID]]
) -> dict[tuple[UUID, UUID], _KeywordRow]:
    """The keyword of each (tracked keyword, workspace) that is not deleted."""
    if not keys:
        return {}
    t, k = tracked_keywords.c, keywords.c
    rows = await db.execute(
        select(t.id, t.workspace_id, k.text, t.language_code, t.device, t.os)
        .select_from(
            tracked_keywords.join(
                keywords, and_(k.id == t.keyword_id, k.workspace_id == t.workspace_id)
            )
        )
        .where(
            tuple_(t.id, t.workspace_id).in_(list(keys)),
            t.deleted_at.is_(None),
            # Archived since it was planned: not sent, not paid for.
            t.is_active,
        )
    )
    return {
        (row.id, row.workspace_id): _KeywordRow(row.text, row.language_code, row.device, row.os)
        for row in rows
    }


async def _location_codes(db: AsyncSession, location_ids: Collection[int | None]) -> dict[int, int]:
    """DataForSEO's code for each location, where the provider map gives one. Locations are
    synced from DataForSEO's list, so a location's id is its code otherwise."""
    ids = [location_id for location_id in location_ids if location_id is not None]
    if not ids:
        return {}
    m = provider_location_map.c
    rows = await db.execute(
        select(m.location_id, m.provider_value).where(
            m.provider_code == DATAFORSEO, m.location_id.in_(ids)
        )
    )
    return {
        row.location_id: int(row.provider_value) for row in rows if row.provider_value.isdigit()
    }


async def _queues(db: AsyncSession, run_ids: Collection[UUID]) -> dict[UUID, str]:
    """The queue each run was planned for."""
    if not run_ids:
        return {}
    r = collection_runs.c
    rows = await db.execute(select(r.id, r.config_snapshot).where(r.id.in_(list(run_ids))))
    return {row.id: str((row.config_snapshot or {}).get("queue", "standard")) for row in rows}


# The new-keyword tick.


async def queue_new_keywords(sessions: async_sessionmaker[AsyncSession], *, now: datetime) -> int:
    """A planned run for each collecting project with keywords never checked, once (plan
    decision R1): trigger `manual`, made by the system, selector `{"new": true}`. The planner
    plans it on the same tick. A project with a rank run still waiting gets no other, nor does
    one whose run a budget blocked in the last `NEW_KEYWORD_QUIET`: the blocked run made no task
    and would otherwise be made again every minute. Returns how many runs were made."""
    t, k, p, w, r = (
        tracked_keywords.c,
        keywords.c,
        projects.c,
        workspaces.c,
        collection_runs.c,
    )
    waiting = exists().where(
        r.project_id == t.project_id,
        r.workspace_id == t.workspace_id,
        r.workload == WORKLOAD.value,
        or_(
            r.status == "planned",
            and_(r.status == "budget_blocked", r.created_at >= now - NEW_KEYWORD_QUIET),
            # A run that found nothing to check (no price, say) would be made again every minute.
            and_(r.tasks_total == 0, r.created_at >= now - NEW_KEYWORD_QUIET),
        ),
    )
    async with sessions() as db, db.begin():
        rows = await db.execute(
            select(t.workspace_id, t.project_id)
            .distinct()
            .select_from(
                tracked_keywords.join(
                    keywords, and_(k.id == t.keyword_id, k.workspace_id == t.workspace_id)
                )
                .join(projects, and_(p.id == t.project_id, p.workspace_id == t.workspace_id))
                .join(workspaces, w.id == p.workspace_id)
            )
            .where(
                t.deleted_at.is_(None),
                t.is_active,
                t.search_engine == "google",
                t.depth_profile.not_in(sorted(UNAVAILABLE)),
                p.deleted_at.is_(None),
                p.status == "active",
                w.status == "active",
                func.char_length(k.text) <= KEYWORD_MAX,
                ~_has_snapshot(),
                ~_recent_task(now),
                ~waiting,
            )
        )
        made = 0
        for row in rows:
            run_id = await ledger.create_run(
                db,
                NewRun(
                    workspace_id=row.workspace_id,
                    project_id=row.project_id,
                    schedule_id=None,
                    workload=WORKLOAD,
                    window_start=now,
                    window_end=now + MANUAL_WINDOW,
                    trigger="manual",
                    config_snapshot={"selector": {"new": True}},
                ),
                now=now,
            )
            made += run_id is not None
    return made
