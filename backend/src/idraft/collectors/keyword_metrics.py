"""Keyword metrics from DataForSEO Labs (docs/08-seo-keyword-system.md section 6; plan
decisions D6 to D9): the workload that plans and builds the tasks, the ingester that reads the
stored answers into snapshots, and the tick that asks about new keywords at once.

A task is one keyword at one location and language: subject type `keyword`, subject id
`<keyword_id>:<language_code>`, the location in its column. Every read and write names the
workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Final
from uuid import UUID

import structlog
from sqlalchemy import ColumnElement, and_, exists, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import ledger
from idraft.collectors.ingest_waits import IngestReport, not_now
from idraft.collectors.ledger import FetchedTask, LedgerTask, NewRun, NewTask, TaskRef
from idraft.collectors.raw_payloads import load_raw_payload
from idraft.collectors.registry import Plan, ScheduleWindow
from idraft.db.tables import (
    collection_runs,
    collection_tasks,
    keyword_group_members,
    keyword_metric_snapshots,
    keyword_metrics_current,
    keywords,
    projects,
    provider_location_map,
    provider_price_book,
    tracked_keyword_terms,
    tracked_keywords,
    workspaces,
)
from idraft.domain.keyword_metrics import MetricsReading, is_material_change
from idraft.domain.workloads import TaskWorkload
from idraft.keywords.trees import descendants
from idraft.providers.contract import CanonicalRequest
from idraft.providers.dataforseo import labs
from idraft.providers.dataforseo.labs import KeywordOverview, KeywordOverviewParams
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO
from idraft.storage.raw import ObjectStore, RawStorageError

WORKLOAD: Final = TaskWorkload.KEYWORD_METRICS
SOURCE: Final = "dataforseo_labs"
SUBJECT_TYPE: Final = "keyword"
# A keyword's metrics are asked for again once they are this old (plan decision D8).
STALE_DAYS: Final = 25
# A new keyword is not asked about while a task for it is this recent, finished or not, so a
# keyword whose task failed is not paid for every minute (plan decision D8).
NEW_KEYWORD_QUIET: Final = timedelta(hours=24)
# How long a run the tick or a person starts has to send its tasks.
MANUAL_WINDOW: Final = timedelta(hours=1)
# Fetched tasks one ingest pass reads.
INGEST_LIMIT: Final = 5000
# An answer that could not be ingested (not read from storage, or not written) is tried again
# after `INGEST_RETRY`, and its tasks fail once they have waited `INGEST_GIVE_UP` since they
# were fetched, so their run can finish.
INGEST_RETRY: Final = timedelta(minutes=5)
INGEST_GIVE_UP: Final = timedelta(days=1)
UNREADABLE: Final = "unreadable_answer"
NOT_READ: Final = "answer_not_read"
NOT_WRITTEN: Final = "answer_not_written"
ADAPTER: Final = "dataforseo_labs_keyword_overview@1"
_log = structlog.get_logger(__name__)


def subject_id(keyword_id: UUID, language_code: str) -> str:
    return f"{keyword_id}:{language_code}"


def parse_subject(subject: str) -> tuple[UUID, str] | None:
    """The keyword and language of a subject id; None for one this workload did not make."""
    keyword, _, language = subject.partition(":")
    try:
        return UUID(keyword), language
    except ValueError:
        return None


@dataclass(frozen=True, slots=True)
class Subject:
    keyword_id: UUID
    location_id: int
    language_code: str


# Planning.


def _selected(
    workspace_id: UUID, project_id: UUID, selector: Mapping[str, Any], *, now: datetime
) -> Any:
    """The project's actively tracked keywords the selector names, at each of their locations
    and languages, once each. Keywords Labs would not take are left out (`labs.accepts`).

    `keyword_ids`: those keywords, however fresh their metrics. `new`: keywords with no
    metrics yet and no task in `NEW_KEYWORD_QUIET`. Otherwise, or with `stale_days` beside
    `keyword_ids`, those whose metrics are older than `stale_days` (default `STALE_DAYS`) or
    missing; `all` takes every one. `groups` and `terms` narrow any of these to keywords in one
    of the groups or with one of the terms, those under them included; given both, a keyword
    needs both."""
    t, k = tracked_keywords.c, keywords.c
    statement = (
        select(t.keyword_id, t.location_id, t.language_code)
        .distinct()
        .select_from(
            tracked_keywords.join(
                keywords, and_(k.id == t.keyword_id, k.workspace_id == t.workspace_id)
            ).join(
                projects,
                and_(projects.c.id == t.project_id, projects.c.workspace_id == t.workspace_id),
            )
        )
        .where(
            t.workspace_id == workspace_id,
            t.project_id == project_id,
            t.deleted_at.is_(None),
            t.is_active,
            projects.c.deleted_at.is_(None),
            func.char_length(k.text) <= labs.KEYWORD_MAX,
        )
    )
    keyword_ids = selector.get("keyword_ids")
    if keyword_ids is not None:
        statement = statement.where(t.keyword_id.in_(_uuids(keyword_ids)))
    groups = selector.get("groups")
    if groups:
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
    if selector.get("new"):
        return statement.where(~_has_snapshot(), ~_recent_task(now))
    stale_days = selector.get("stale_days")
    if selector.get("all") or (keyword_ids is not None and stale_days is None):
        return statement
    days = STALE_DAYS if stale_days is None else int(stale_days)
    return statement.where(~_fresh(now - timedelta(days=days)))


def _uuids(values: Any) -> list[UUID]:
    """Ids a stored selector holds, as JSON strings."""
    return [UUID(str(value)) for value in values]


def _same_key(table_columns: Any) -> ColumnElement[bool]:
    t = tracked_keywords.c
    return and_(
        table_columns.keyword_id == t.keyword_id,
        table_columns.location_id == t.location_id,
        table_columns.language_code == t.language_code,
        table_columns.workspace_id == t.workspace_id,
        table_columns.source == SOURCE,
    )


def _fresh(cutoff: datetime) -> ColumnElement[bool]:
    current = keyword_metrics_current.c
    return exists().where(_same_key(current), current.fetched_at >= cutoff)


def _has_snapshot() -> ColumnElement[bool]:
    return exists().where(_same_key(keyword_metric_snapshots.c))


def _recent_task(now: datetime) -> ColumnElement[bool]:
    """A task for the keyword from a run made within `NEW_KEYWORD_QUIET`. The run's time, not
    the task's: the ledger sets a task's `created_at` to the start of its window's month (its
    partition key), which is more than a day old from the second day of the month on."""
    t, task, run = tracked_keywords.c, collection_tasks.c, collection_runs.c
    return exists().where(
        task.workload == WORKLOAD.value,
        task.subject_type == SUBJECT_TYPE,
        task.subject_id == func.concat(t.keyword_id, ":", t.language_code),
        task.location_id == t.location_id,
        task.workspace_id == t.workspace_id,
        run.id == task.run_id,
        run.workspace_id == task.workspace_id,
        run.created_at >= now - NEW_KEYWORD_QUIET,
    )


async def select_subjects(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    selector: Mapping[str, Any],
    *,
    now: datetime,
) -> list[Subject]:
    rows = await db.execute(_selected(workspace_id, project_id, selector, now=now))
    found = [Subject(row.keyword_id, row.location_id, row.language_code) for row in rows]
    return sorted(found, key=lambda s: (s.location_id, s.language_code, str(s.keyword_id)))


async def estimate(db: AsyncSession, subjects: Sequence[Subject], *, on: date) -> Decimal:
    """What the subjects cost by the price book: a call for each 700 keywords at one location
    and language, and the price of each keyword. Zero, and a warning, without prices."""
    if not subjects:
        return Decimal(0)
    p = provider_price_book.c
    rows = await db.execute(
        select(p.price_unit, p.unit_price_usd).where(
            p.provider_code == DATAFORSEO,
            p.endpoint == labs.KEYWORD_OVERVIEW,
            p.valid_from <= on,
            (p.valid_to.is_(None)) | (p.valid_to > on),
        )
    )
    prices = {row.price_unit: Decimal(row.unit_price_usd) for row in rows}
    if not prices:
        _log.warning("no price for Labs keyword overview", on=on.isoformat())
        return Decimal(0)
    per_place: dict[tuple[int, str], int] = {}
    for subject in subjects:
        place = (subject.location_id, subject.language_code)
        per_place[place] = per_place.get(place, 0) + 1
    calls = sum(math.ceil(count / labs.BATCH_SIZE) for count in per_place.values())
    return calls * prices.get("request", Decimal(0)) + len(subjects) * prices.get(
        "item", Decimal(0)
    )


def new_tasks(subjects: Sequence[Subject], *, at: datetime) -> list[NewTask]:
    """One task per subject, all due at once: a Labs call takes 700 keywords, and tasks spread
    over the window would go in many small calls, each paying the call's price."""
    return [
        NewTask(
            subject_type=SUBJECT_TYPE,
            subject_id=subject_id(subject.keyword_id, subject.language_code),
            engine_code=None,
            location_id=subject.location_id,
            replicate_index=1,
            depth=None,
            request_fingerprint=hashlib.sha256(
                f"{subject.keyword_id}:{subject.language_code}:{subject.location_id}:{SOURCE}".encode()
            ).digest(),
            provider_code=DATAFORSEO,
            provider_endpoint=labs.KEYWORD_OVERVIEW,
            scheduled_for=at,
        )
        for subject in subjects
    ]


class KeywordMetricsWorkload:
    """Plans keyword metrics tasks for a schedule's window or a manual run, and builds their
    Labs requests."""

    name: Final = WORKLOAD

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        subjects = await select_subjects(
            db, window.workspace_id, window.project_id, window.selector, now=window.window_start
        )
        return Plan(
            tasks=new_tasks(subjects, at=window.window_start),
            estimated_cost_usd=await estimate(db, subjects, on=window.window_start.date()),
            config_snapshot={
                "adapter": ADAPTER,
                "provider_mode": "live",
                "source": SOURCE,
                "selector": dict(window.selector),
            },
        )

    def batch_key(self, task: LedgerTask) -> str:
        """One Labs call asks about one location and language."""
        parsed = parse_subject(task.subject_id)
        language = parsed[1] if parsed is not None else ""
        return f"{task.location_id}:{language}"

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        """Each task's keyword, as entered, at its location's DataForSEO code. A task whose
        keyword is gone is left out."""
        wanted = {}
        for task in tasks:
            parsed = parse_subject(task.subject_id)
            if parsed is not None and task.location_id is not None:
                wanted[task.ref] = (task, parsed)
        texts = await _texts(
            db, {(parsed[0], task.workspace_id) for task, parsed in wanted.values()}
        )
        codes = await _location_codes(db, {task.location_id for task, _ in wanted.values()})
        requests: dict[TaskRef, CanonicalRequest] = {}
        for ref, (task, (keyword_id, language)) in wanted.items():
            text = texts.get((keyword_id, task.workspace_id))
            if text is None or task.location_id is None:
                continue
            requests[ref] = CanonicalRequest(
                task_id=str(task.ref.id),
                run_id=task.run_id,
                priority="high" if task.priority == "high" else "standard",
                params=KeywordOverviewParams(
                    keyword=text,
                    location_code=codes.get(task.location_id, task.location_id),
                    language_code=language,
                ),
            )
        return requests


async def _texts(
    db: AsyncSession, keys: Collection[tuple[UUID, UUID]]
) -> dict[tuple[UUID, UUID], str]:
    """The text of each (keyword, workspace)."""
    if not keys:
        return {}
    k = keywords.c
    rows = await db.execute(
        select(k.id, k.workspace_id, k.text).where(tuple_(k.id, k.workspace_id).in_(list(keys)))
    )
    return {(row.id, row.workspace_id): row.text for row in rows}


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
    codes: dict[int, int] = {}
    for row in rows:
        if row.provider_value.isdigit():
            codes[row.location_id] = int(row.provider_value)
    return codes


# The new-keyword tick.


async def queue_new_keywords(sessions: async_sessionmaker[AsyncSession], *, now: datetime) -> int:
    """A planned run for each collecting project with keywords that have no metrics yet, once
    (plan decision D8): trigger `manual`, made by the system, selector `{"new": true}`. The
    planner plans it on the same tick. A project with a keyword metrics run still waiting gets
    no other, nor does one whose run a budget blocked in the last `NEW_KEYWORD_QUIET`: the
    blocked run made no task, and would otherwise be made again every minute. Returns how many
    runs were made."""
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
                p.deleted_at.is_(None),
                p.status == "active",
                w.status == "active",
                func.char_length(k.text) <= labs.KEYWORD_MAX,
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


# Ingesting.


async def ingest(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = INGEST_LIMIT
) -> IngestReport:
    """Read fetched keyword metrics tasks into snapshots (plan decision D7), one stored answer
    at a time, each in its own transaction. Safe to run twice: a task is ingested once, and a
    snapshot is written once per task. An answer that is not a Labs answer fails its tasks; one
    that cannot be read or written now waits (`INGEST_RETRY`, up to `INGEST_GIVE_UP`), so it
    holds up neither the other answers nor its run."""
    async with sessions() as db:
        now = await ledger.transaction_time(db)
        fetched = await ledger.fetched_tasks(db, workload=WORKLOAD, limit=limit, now=now)
    by_payload: dict[int, list[FetchedTask]] = {}
    for task in fetched:
        by_payload.setdefault(task.raw_payload_id, []).append(task)
    ingested = failed = waiting = 0
    for payload_id, tasks in by_payload.items():
        try:
            body = await load_raw_payload(sessions, store, payload_id)
        except RawStorageError as error:
            _log.warning("stored answer not read", payload_id=payload_id, error=str(error))
            later, gave_up = await _not_now(
                sessions, tasks, code=NOT_READ, message="The stored answer could not be read."
            )
            waiting, failed = waiting + later, failed + gave_up
            continue
        try:
            overviews = labs.read_overview(body)
        except labs.UnreadableAnswerError as error:
            _log.error("stored answer not readable", payload_id=payload_id, error=str(error))
            async with sessions() as db, db.begin():
                now = await ledger.transaction_time(db)
                for task in tasks:
                    failed += await ledger.ingest_failed(
                        db, task.ref, code=UNREADABLE, message=str(error), now=now
                    )
            continue
        try:
            async with sessions() as db, db.begin():
                now = await ledger.transaction_time(db)
                kept = 0
                for task in tasks:
                    await _keep(db, task, overviews)
                    kept += await ledger.mark_ingested(db, task.ref, now=now)
        except Exception:
            # Rolled back as a whole: nothing of this answer is kept, and the next answers
            # are still ingested.
            _log.exception("stored answer not ingested", payload_id=payload_id)
            later, gave_up = await _not_now(
                sessions, tasks, code=NOT_WRITTEN, message="The answer could not be written."
            )
            waiting, failed = waiting + later, failed + gave_up
            continue
        ingested += kept
    return IngestReport(ingested=ingested, failed=failed, waiting=waiting)


async def _not_now(
    sessions: async_sessionmaker[AsyncSession],
    tasks: Sequence[FetchedTask],
    *,
    code: str,
    message: str,
) -> tuple[int, int]:
    """Tasks whose answer could not be ingested: those fetched `INGEST_GIVE_UP` ago fail, the
    others wait `INGEST_RETRY`. Returns how many wait and how many failed."""
    return await not_now(
        sessions, tasks, code=code, message=message, retry=INGEST_RETRY, give_up=INGEST_GIVE_UP
    )


async def _keep(
    db: AsyncSession, task: FetchedTask, overviews: Mapping[str, KeywordOverview]
) -> None:
    """One task's snapshot, and the keyword's current metrics when it is the newest. A keyword
    Labs knew nothing of gets a snapshot with every metric null, so it is not asked about
    again until the next refresh; that empty reading is no material change and does not
    replace current metrics. A keyword deleted since gets nothing."""
    parsed = parse_subject(task.subject_id)
    if parsed is None or task.location_id is None:
        return
    keyword_id, language = parsed
    text: str | None = (
        await db.execute(
            select(keywords.c.text).where(
                keywords.c.id == keyword_id, keywords.c.workspace_id == task.workspace_id
            )
        )
    ).scalar_one_or_none()
    if text is None:
        return
    item = overviews.get(labs.match_key(text))
    if item is not None and _empty(item):
        item = None
    current = keyword_metrics_current.c
    s = keyword_metric_snapshots
    # The reading before this one, by when it was fetched: an older answer ingested late is
    # judged against what came before it, not against a newer one.
    before = (
        await db.execute(
            select(s.c.search_volume, s.c.keyword_difficulty, s.c.intent_main)
            .where(
                s.c.workspace_id == task.workspace_id,
                s.c.keyword_id == keyword_id,
                s.c.location_id == task.location_id,
                s.c.language_code == language,
                s.c.source == SOURCE,
                s.c.fetched_at < task.fetched_at,
                or_(
                    s.c.search_volume.is_not(None),
                    s.c.keyword_difficulty.is_not(None),
                    s.c.intent_main.is_not(None),
                ),
            )
            .order_by(s.c.fetched_at.desc(), s.c.id.desc())
            .limit(1)
        )
    ).one_or_none()
    reading = MetricsReading(
        search_volume=None if item is None else item.search_volume,
        keyword_difficulty=None if item is None else item.keyword_difficulty,
        intent_main=None if item is None else item.main_intent,
    )
    previous = (
        None
        if before is None
        else MetricsReading(before.search_volume, before.keyword_difficulty, before.intent_main)
    )
    snapshot = _snapshot(item, reading, previous)
    inserted = (
        await db.execute(
            upsert(s)
            .values(
                workspace_id=task.workspace_id,
                keyword_id=keyword_id,
                location_id=task.location_id,
                language_code=language,
                source=SOURCE,
                fetched_at=task.fetched_at,
                raw_payload_id=task.raw_payload_id,
                task_id=task.ref.id,
                **snapshot,
            )
            .on_conflict_do_nothing(constraint="keyword_metric_snapshots_one_per_task")
            .returning(s.c.id)
        )
    ).scalar_one_or_none()
    if inserted is None:
        return
    statement = upsert(keyword_metrics_current).values(
        keyword_id=keyword_id,
        location_id=task.location_id,
        language_code=language,
        source=SOURCE,
        workspace_id=task.workspace_id,
        snapshot_id=inserted,
        search_volume=reading.search_volume,
        cpc_usd=snapshot["cpc_usd"],
        keyword_difficulty=reading.keyword_difficulty,
        intent_main=reading.intent_main,
        fetched_at=task.fetched_at,
    )
    if item is None:
        # Labs knew nothing this time: a keyword with no metrics yet gets an empty current
        # row, saying when it was asked; one with metrics keeps them.
        await db.execute(statement.on_conflict_do_nothing())
        return
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[
                current.keyword_id,
                current.location_id,
                current.language_code,
                current.source,
            ],
            set_={
                "snapshot_id": statement.excluded.snapshot_id,
                "search_volume": statement.excluded.search_volume,
                "cpc_usd": statement.excluded.cpc_usd,
                "keyword_difficulty": statement.excluded.keyword_difficulty,
                "intent_main": statement.excluded.intent_main,
                "fetched_at": statement.excluded.fetched_at,
            },
            # An older answer ingested late does not replace a newer one.
            where=and_(
                current.workspace_id == statement.excluded.workspace_id,
                current.fetched_at <= statement.excluded.fetched_at,
            ),
        )
    )


def _snapshot(
    item: KeywordOverview | None, reading: MetricsReading, previous: MetricsReading | None
) -> dict[str, object]:
    months = () if item is None else item.monthly_searches
    newest = months[-1] if months else None
    return {
        "data_month": None if newest is None else date(newest.year, newest.month, 1),
        "search_volume": reading.search_volume,
        "monthly_searches": [
            {"year": m.year, "month": m.month, "search_volume": m.search_volume} for m in months
        ],
        "cpc_usd": None if item is None else item.cpc_usd,
        "competition": None if item is None else item.competition,
        "competition_level": None if item is None else item.competition_level,
        "keyword_difficulty": reading.keyword_difficulty,
        "intent_main": reading.intent_main,
        "intent_detail": None
        if item is None or item.main_intent is None
        else {"main": item.main_intent, "foreign": list(item.foreign_intents)},
        # An empty reading says Labs knew nothing this time, not that the keyword changed.
        "is_material_change": item is not None and is_material_change(previous, reading),
    }


def _empty(item: KeywordOverview) -> bool:
    """Labs named the keyword with no value at all: read as not knowing it."""
    return (
        item.search_volume is None
        and item.keyword_difficulty is None
        and item.main_intent is None
        and item.cpc_usd is None
        and item.competition is None
        and not item.monthly_searches
    )
