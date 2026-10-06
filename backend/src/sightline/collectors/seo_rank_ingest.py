"""Reading fetched rank checks into facts (plan decisions R5, R17 to R22 of
docs/superpowers/plans/2026-10-05-rank-ingest.md).

One stored answer is one task is one SERP snapshot, with its features, the rank of each own and
competitor entity, the keyword's state, the current top 20 and the rank events, all written in
one transaction and once: the snapshot is unique per task, so ingesting a task twice writes
nothing the second time. Every read and write names the workspace, because the worker bypasses
row-level security.
"""

from __future__ import annotations

import uuid
from dataclasses import fields
from datetime import datetime, timedelta
from typing import Any, Final

import structlog
from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.ingest_waits import IngestReport, not_now
from sightline.collectors.ledger import FetchedTask
from sightline.collectors.raw_payloads import load_raw_payload
from sightline.collectors.seo_rank import parse_subject
from sightline.collectors.seo_rank_context import RankContext, load_context
from sightline.collectors.seo_rank_rows import (
    KeywordRef,
    SerpRows,
    TaskFacts,
    UnusableCheckError,
    build_rows,
    echo_of,
    own_check,
    snapshot_time,
    urls_of,
)
from sightline.db import dictionaries
from sightline.db.tables import (
    domain_rank_observations,
    projects,
    rank_events,
    serp_current_results,
    serp_feature_types,
    serp_features,
    serp_snapshots,
    tracked_keyword_state,
    tracked_keywords,
    urls,
)
from sightline.domain.workloads import TaskWorkload
from sightline.providers.dataforseo.serp_parse import (
    NormalizedSerp,
    SerpSchemaMismatchError,
    parse_serp,
)
from sightline.ranks.events import EventDraft, overtake_events, own_events
from sightline.ranks.resolve import ResolvedSerp, own_side, resolve_serp, target_url_match
from sightline.ranks.state import KeywordState, apply_check
from sightline.storage.raw import ObjectStore, RawStorageError

WORKLOAD: Final = TaskWorkload.SEO_RANK
# Fetched tasks one pass reads.
INGEST_LIMIT: Final = 2000
# An answer that could not be ingested is tried again after `INGEST_RETRY`; its task fails once it
# has waited `INGEST_GIVE_UP` since it was fetched, so its run can finish.
INGEST_RETRY: Final = timedelta(minutes=5)
INGEST_GIVE_UP: Final = timedelta(days=1)
UNREADABLE: Final = "unreadable_answer"
NOT_READ: Final = "answer_not_read"
NOT_WRITTEN: Final = "answer_not_written"
NOT_STORABLE: Final = "answer_not_storable"
# The SQLSTATE classes of an error that repeats: bad data (22), a broken constraint (23), a
# statement the database refuses (42). Deadlocks (40) and lost connections (08) do not.
_PERMANENT_SQLSTATES: Final = ("22", "23", "42")
_NO_PARTITION: Final = "no partition"


def repeats(error: BaseException) -> bool:
    """Whether the same write would fail the same way on the next try. Only the database's own
    verdict on the data counts: an exception of our code (a bug a deploy can fix) waits like a
    lost connection, and so does a month with no partition yet, which an operator can add."""
    if not isinstance(error, DBAPIError):
        return False
    state = getattr(error.orig, "sqlstate", None)
    if not isinstance(state, str) or not state.startswith(_PERMANENT_SQLSTATES):
        return False
    return _NO_PARTITION not in str(error.orig)


_log = structlog.get_logger(__name__)
_STATE_FIELDS: Final = tuple(field.name for field in fields(KeywordState))


async def ingest(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = INGEST_LIMIT
) -> IngestReport:
    """Read fetched rank tasks into snapshots, one task at a time, each in its own transaction.
    Safe to run twice. An answer that is not a readable SERP fails its task with the payload
    kept; one that cannot be read from storage or written now waits, so it holds up neither the
    other answers nor its run."""
    async with sessions() as db:
        now = await ledger.transaction_time(db)
        fetched = await ledger.fetched_tasks(db, workload=WORKLOAD, limit=limit, now=now)
    ingested = failed = waiting = 0
    # The tasks come ordered by payload, so tasks sharing one are next to each other and only the
    # last body needs to be held.
    last_id: int | None = None
    last_body: bytes | None = None
    for task in fetched:
        if task.raw_payload_id != last_id:
            last_id = task.raw_payload_id
            try:
                last_body = await load_raw_payload(sessions, store, last_id)
            except RawStorageError as error:
                _log.warning("stored answer not read", payload=last_id, error=str(error))
                last_body = None
        if last_body is None:
            later, gave_up = await _wait(
                sessions, task, NOT_READ, "The stored answer could not be read."
            )
            waiting, failed = waiting + later, failed + gave_up
            continue
        try:
            serp = parse_serp(last_body)
        except SerpSchemaMismatchError as error:
            failed += await _fail(sessions, task, UNREADABLE, str(error))
            continue
        except Exception as error:
            # A parser fault is the same on every try, so the task fails with its payload kept
            # instead of holding up the pass.
            _log.exception("stored answer not parsed", task=task.ref.id)
            failed += await _fail(sessions, task, UNREADABLE, f"{type(error).__name__}")
            continue
        try:
            async with sessions() as db, db.begin():
                now = await ledger.transaction_time(db)
                await _keep(db, task, serp)
                ingested += await ledger.mark_ingested(db, task.ref, now=now)
        except UnusableCheckError as error:
            failed += await _fail(sessions, task, UNREADABLE, str(error))
        except Exception as error:
            if repeats(error):
                # The answer cannot be stored as it is, and will not be on the next try.
                _log.exception("stored answer cannot be stored", task=task.ref.id)
                failed += await _fail(sessions, task, NOT_STORABLE, type(error).__name__)
                continue
            # Rolled back as a whole: nothing of this answer is kept, and the next answers are
            # still ingested.
            _log.exception("stored answer not ingested", task=task.ref.id)
            later, gave_up = await _wait(
                sessions, task, NOT_WRITTEN, "The answer could not be written."
            )
            waiting, failed = waiting + later, failed + gave_up
    return IngestReport(ingested=ingested, failed=failed, waiting=waiting)


async def _wait(
    sessions: async_sessionmaker[AsyncSession], task: FetchedTask, code: str, message: str
) -> tuple[int, int]:
    return await not_now(
        sessions, [task], code=code, message=message, retry=INGEST_RETRY, give_up=INGEST_GIVE_UP
    )


async def _fail(
    sessions: async_sessionmaker[AsyncSession], task: FetchedTask, code: str, message: str
) -> int:
    _log.error("stored answer not ingested for good", task=task.ref.id, code=code, error=message)
    async with sessions() as db, db.begin():
        now = await ledger.transaction_time(db)
        return int(await ledger.ingest_failed(db, task.ref, code=code, message=message, now=now))


async def _keep(db: AsyncSession, task: FetchedTask, serp: NormalizedSerp) -> None:
    """One task's rows. A keyword deleted since, or a task that names none, gets nothing."""
    parsed = parse_subject(task.subject_id)
    if parsed is None:
        return
    tracked_keyword_id = parsed[0]
    keyword = await _keyword(db, task, tracked_keyword_id)
    if keyword is None:
        return
    echo = echo_of(serp)
    context = await load_context(
        db,
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        tracked_keyword_id=tracked_keyword_id,
    )
    observed_at = snapshot_time(serp.observed_at, task.fetched_at)
    resolved = resolve_serp(serp, context.resolver, context.entities, depth_requested=echo.depth)
    url_rows = await dictionaries.urls_for(db, urls_of(serp, resolved))
    rows = build_rows(
        serp,
        resolved,
        url_rows,
        keyword=keyword,
        task=TaskFacts(
            task_id=task.ref.id,
            raw_payload_id=task.raw_payload_id,
            fetched_at=task.fetched_at,
            provider_code=task.provider_code,
            provider_endpoint=task.provider_endpoint,
            provider_task_id=task.provider_task_id,
            location_id=task.location_id,
            cost_usd=task.cost_usd,
        ),
        observed_at=observed_at,
    )
    await _ensure_feature_types(db, rows.feature_codes)
    snapshot_id = await _insert_snapshot(db, rows)
    if snapshot_id is None:
        return  # this task has its snapshot already
    feature_rows, observation_rows = rows.children(snapshot_id)
    if feature_rows:
        await db.execute(insert(serp_features), feature_rows)
    if observation_rows:
        await db.execute(insert(domain_rank_observations), observation_rows)

    side = own_side(resolved, serp)
    check = own_check(
        side,
        serp,
        url_rows,
        snapshot_id=snapshot_id,
        observed_at=observed_at,
        target_matches=target_url_match(side, keyword.target_url_hash),
    )
    await db.execute(
        upsert(tracked_keyword_state)
        .values(
            tracked_keyword_id=tracked_keyword_id,
            workspace_id=task.workspace_id,
            project_id=task.project_id,
        )
        .on_conflict_do_nothing(index_elements=[tracked_keyword_state.c.tracked_keyword_id])
    )
    before = await _locked_state(db, task.workspace_id, tracked_keyword_id)
    transition = apply_check(before, check)
    if not transition.applied:
        return  # older than the state: history only (R22)

    now = await ledger.transaction_time(db)
    await db.execute(
        update(tracked_keyword_state)
        .where(
            tracked_keyword_state.c.tracked_keyword_id == tracked_keyword_id,
            tracked_keyword_state.c.workspace_id == task.workspace_id,
        )
        .values(
            {**{name: getattr(transition.state, name) for name in _STATE_FIELDS}, "updated_at": now}
        )
    )
    await _replace_current(db, task, tracked_keyword_id, snapshot_id, rows)
    drafts = list(own_events(before, check, transition))
    drafts.extend(
        await _overtakes(db, task, tracked_keyword_id, before, check.rank, resolved, echo.depth)
    )
    await _insert_events(db, task, tracked_keyword_id, context, snapshot_id, observed_at, drafts)


async def _keyword(
    db: AsyncSession, task: FetchedTask, tracked_keyword_id: uuid.UUID
) -> KeywordRef | None:
    row = (
        await db.execute(
            select(
                tracked_keywords.c.location_id,
                tracked_keywords.c.config_version,
                urls.c.url_hash,
                projects.c.timezone,
            )
            .select_from(
                tracked_keywords.join(
                    projects,
                    and_(
                        projects.c.id == tracked_keywords.c.project_id,
                        projects.c.workspace_id == tracked_keywords.c.workspace_id,
                    ),
                ).outerjoin(urls, urls.c.id == tracked_keywords.c.target_url_id)
            )
            .where(
                tracked_keywords.c.id == tracked_keyword_id,
                tracked_keywords.c.workspace_id == task.workspace_id,
                tracked_keywords.c.project_id == task.project_id,
                tracked_keywords.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return KeywordRef(
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        tracked_keyword_id=tracked_keyword_id,
        location_id=row.location_id,
        config_version=row.config_version,
        target_url_hash=row.url_hash,
        timezone=row.timezone,
    )


async def _ensure_feature_types(db: AsyncSession, codes: tuple[str, ...]) -> None:
    """A feature type the provider added becomes `other:<type>` in the registry."""
    unknown = [code for code in codes if code.startswith("other:")]
    if not unknown:
        return
    await db.execute(
        upsert(serp_feature_types)
        .values(
            [
                {"code": code, "label": code, "ownable": True, "tracked_by_default": True}
                for code in sorted(unknown)
            ]
        )
        .on_conflict_do_nothing(index_elements=[serp_feature_types.c.code])
    )


async def _insert_snapshot(db: AsyncSession, rows: SerpRows) -> int | None:
    inserted = await db.execute(
        upsert(serp_snapshots)
        .values(rows.snapshot)
        .on_conflict_do_nothing(index_elements=["collection_task_id", "observed_at"])
        .returning(serp_snapshots.c.id)
    )
    snapshot_id: int | None = inserted.scalar_one_or_none()
    return snapshot_id


async def _locked_state(
    db: AsyncSession, workspace_id: uuid.UUID, tracked_keyword_id: uuid.UUID
) -> KeywordState:
    row = (
        await db.execute(
            select(tracked_keyword_state)
            .where(
                tracked_keyword_state.c.tracked_keyword_id == tracked_keyword_id,
                tracked_keyword_state.c.workspace_id == workspace_id,
            )
            .with_for_update()
        )
    ).one()
    values: dict[str, Any] = {name: row._mapping[name] for name in _STATE_FIELDS}
    for name in ("feature_types_present", "owned_feature_types"):
        values[name] = tuple(values[name] or ())
    return KeywordState(**values)


async def _replace_current(
    db: AsyncSession,
    task: FetchedTask,
    tracked_keyword_id: uuid.UUID,
    snapshot_id: int,
    rows: SerpRows,
) -> None:
    """The keyword's top 20 as of this check."""
    table = serp_current_results
    await db.execute(
        delete(table).where(
            table.c.tracked_keyword_id == tracked_keyword_id,
            table.c.workspace_id == task.workspace_id,
        )
    )
    if rows.current:
        await db.execute(
            insert(table),
            [
                {
                    "tracked_keyword_id": tracked_keyword_id,
                    "workspace_id": task.workspace_id,
                    "project_id": task.project_id,
                    "serp_snapshot_id": snapshot_id,
                    **row,
                }
                for row in rows.current
            ],
        )


async def _overtakes(
    db: AsyncSession,
    task: FetchedTask,
    tracked_keyword_id: uuid.UUID,
    before: KeywordState,
    own_now: int | None,
    resolved: ResolvedSerp,
    depth: int,
) -> list[EventDraft]:
    """`overtaken_by` and `overtook` against the competitors' ranks in the previous check."""
    if before.last_snapshot_id is None or before.current_depth_requested is None:
        return []
    table = domain_rank_observations
    previous = {
        row.entity_id: row.organic_rank
        for row in await db.execute(
            select(table.c.entity_id, table.c.organic_rank).where(
                table.c.tracked_keyword_id == tracked_keyword_id,
                table.c.workspace_id == task.workspace_id,
                table.c.serp_snapshot_id == before.last_snapshot_id,
                table.c.observed_at == before.last_observed_at,
                table.c.role == "competitor",
            )
        )
    }
    return list(
        overtake_events(
            own_before=before.current_rank,
            own_now=own_now,
            competitors_before=previous,
            competitors_now={
                entity.entity_id: entity.organic_rank
                for entity in resolved.entities
                if entity.role == "competitor"
            },
            depth=min(depth, before.current_depth_requested),
        )
    )


async def _insert_events(
    db: AsyncSession,
    task: FetchedTask,
    tracked_keyword_id: uuid.UUID,
    context: RankContext,
    snapshot_id: int,
    occurred_at: datetime,
    drafts: list[EventDraft],
) -> None:
    """The events, attributed to the project's primary own entity; a project without one has no
    rank to speak of and writes none."""
    if not drafts or context.primary_own is None:
        return
    await db.execute(
        insert(rank_events),
        [
            {
                "occurred_at": occurred_at,
                "workspace_id": task.workspace_id,
                "project_id": task.project_id,
                "tracked_keyword_id": tracked_keyword_id,
                "entity_id": context.primary_own,
                "event_type": draft.event_type,
                "from_rank": draft.from_rank,
                "to_rank": draft.to_rank,
                "from_url_id": draft.from_url_id,
                "to_url_id": draft.to_url_id,
                "other_entity_id": draft.other_entity_id,
                "feature_type": draft.feature_type,
                "serp_snapshot_id": snapshot_id,
            }
            for draft in drafts
        ],
    )
