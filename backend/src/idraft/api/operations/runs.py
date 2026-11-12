"""Rules for collection runs the API asks for (docs/19-api-specification.md section 3.11.4;
plan decision D9).

A manual run is recorded as `planned` with its selector; the worker's planner plans it, judges
it against the budget and starts it. A project has `MANUAL_RUNS_PER_DAY` runs people ask for
each day (UTC); runs the system starts for new keywords do not count.

A planned or running run can be cancelled: by whoever holds `schedules:write`, and by the
person who asked for a manual run if they hold `runs:trigger`. The reconciler cancels its
pending tasks; tasks the provider already has are still fetched (they are paid for).
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Final
from uuid import UUID

import structlog
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai import run_repository as ai_runs
from idraft.api.keywords import check_status
from idraft.api.keywords import repository as keywords
from idraft.api.operations import runs_repository as runs
from idraft.api.operations.runs_repository import RunFilter, RunRecord
from idraft.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from idraft.api.permissions import Permission
from idraft.api.problems import (
    CheckPendingError,
    FieldError,
    ForbiddenError,
    InvalidStateTransitionError,
    ManualRunLimitError,
    NotFoundError,
    NothingToRunError,
    ProviderPausedError,
    QuotaExceededError,
    invalid_field,
    invalid_fields,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai import RunNow
from idraft.api.schemas.ai_bulk import RunBulk
from idraft.api.schemas.keywords import MetricsRefresh
from idraft.api.schemas.ranks import CheckNow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors import ai_prompt
from idraft.collectors.ai_prompt import Skipped, Subject
from idraft.collectors.registry import ScheduleWindow
from idraft.db.engine import workspace_transaction
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO
from idraft.providers.pauses import RedisPauses

# docs/24 section 8.
MANUAL_RUNS_PER_DAY: Final = 20
# How long a manual run has to send its tasks.
MANUAL_WINDOW: Final = timedelta(hours=1)
KEYWORD_METRICS: Final = "keyword_metrics"
SEO_RANK: Final = "seo_rank"
AI_PROMPT: Final = "ai_prompt"
# What a refused check now tells the caller to wait; a pause lasts at most fifteen minutes.
PAUSED_RETRY_SECONDS: Final = 300
CANCELLED_BY_USER: Final = "cancelled_by_user"
_OPEN: Final = frozenset({"planned", "running"})
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class RunPage:
    runs: list[RunRecord]
    next_cursor: str | None
    manual_runs_today: int


@dataclass(frozen=True, slots=True)
class RunDetail:
    run: RunRecord
    tasks_by_status: dict[str, int]


async def _now(db: AsyncSession) -> datetime:
    """The database clock."""
    now: datetime = (await db.execute(select(func.now()))).scalar_one()
    return now


async def _today(db: AsyncSession) -> datetime:
    """The start of the day (UTC) by the database clock."""
    return (await _now(db)).astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


async def _month_start(db: AsyncSession) -> datetime:
    """The start of the month (UTC) by the database clock."""
    return (await _today(db)).replace(day=1)


async def _live_project(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> None:
    """A deleted project has no runs to show or cancel."""
    if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
        raise NotFoundError


_NOT_ASKED_WHY: Final = {
    "engine_not_enabled": "The engine is not turned on for the project.",
    "prompt_too_long": "The prompt is longer than this engine takes.",
    "location_not_enabled": "The engine has no location in the prompt's country.",
}


def _manual_window(
    access: WorkspaceAccess,
    project_id: UUID,
    prompt_ids: Sequence[str],
    engines: Sequence[str],
    now: datetime,
) -> ScheduleWindow:
    """The window the worker will plan a manual AI run in, with its selector."""
    return ScheduleWindow(
        schedule_id=None,
        workspace_id=access.workspace_id,
        project_id=project_id,
        workload=ai_prompt.WORKLOAD,
        provider_mode="live",
        selector={"prompt_ids": list(prompt_ids), "engine_codes": list(engines)},
        window_start=now,
        window_end=now + MANUAL_WINDOW,
        window_hours=1,
    )


async def _ai_subjects(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, prompt_id: UUID, engines: list[str]
) -> list[Subject]:
    """The tasks the planner will make for this run, by the planner's own rules. An engine that
    would get none (not on, switched off, no location in the prompt's country, a prompt over its
    limit) or an endpoint without a price is refused now, not planned into a run with nothing in
    it."""
    now = await _now(db)
    window = _manual_window(access, project_id, [str(prompt_id)], engines, now)
    subjects, skipped = await ai_prompt.select_subjects(db, window)
    asked = {subject.engine_code for subject in subjects}
    why = {item.engine_code: item.reason for item in skipped}
    refused = [
        FieldError(
            "engine_codes",
            why.get(code, "engine_not_enabled"),
            f"{code}: {_NOT_ASKED_WHY[why.get(code, 'engine_not_enabled')]}",
        )
        for code in engines
        if code not in asked
    ]
    if refused:
        raise invalid_fields(refused)
    cost = await ai_prompt.estimate(db, subjects, queue="standard", on=now.astimezone(UTC).date())
    if cost is None:
        raise invalid_field(
            "engine_codes",
            code="price_unavailable",
            message="The price book has no price for these engines today.",
        )
    return subjects


def _scope(project_id: UUID, given: RunFilter) -> dict[str, object]:
    """What a cursor is bound to: the project and the filter."""
    return {
        "project_id": str(project_id),
        "schedule_id": None if given.schedule_id is None else str(given.schedule_id),
        "workloads": sorted(given.workloads),
        "statuses": sorted(given.statuses),
        "triggers": sorted(given.triggers),
        "from": None if given.created_from is None else given.created_from.isoformat(),
        "to": None if given.created_to is None else given.created_to.isoformat(),
    }


def _after(cursor: str, scope: dict[str, object]) -> tuple[datetime, UUID]:
    key = decode_cursor(cursor, scope=scope)
    if len(key) != 2 or not all(isinstance(part, str) for part in key):
        raise invalid_cursor()
    try:
        created_at = datetime.fromisoformat(str(key[0]))
        run_id = UUID(str(key[1]))
    except ValueError:
        raise invalid_cursor() from None
    if created_at.tzinfo is None:
        raise invalid_cursor()
    return created_at, run_id


@dataclass(frozen=True, slots=True)
class Skip:
    prompt_id: UUID
    engine_code: str
    reason: str


@dataclass(frozen=True, slots=True)
class BulkRun:
    run: RunRecord
    prompts: int
    answers: int
    estimated_cost_usd: Decimal
    skipped: list[Skip]
    manual_runs_today: int


def _left_out(
    skipped: Sequence[Skipped], pending: set[tuple[UUID, str]], engines: Sequence[str]
) -> list[Skip]:
    """What a bulk run leaves out and why, by prompt and engine: the planner's own skips, and
    every asked engine of a prompt with an answer on its way, `check_pending` where it is pending
    and `prompt_pending` on its other engines (a run's selector asks every prompt it names on
    every engine it names, so such a prompt cannot be asked on some engines only)."""
    reasons: dict[tuple[UUID, str], str] = {
        (item.prompt_id, item.engine_code): item.reason for item in skipped
    }
    for prompt_id in {prompt for prompt, _ in pending}:
        for code in engines:
            if (prompt_id, code) in pending:
                reasons[(prompt_id, code)] = "check_pending"
            else:
                reasons.setdefault((prompt_id, code), "prompt_pending")
    return [
        Skip(prompt_id, code, reason)
        for (prompt_id, code), reason in sorted(
            reasons.items(), key=lambda item: (str(item[0][0]), item[0][1])
        )
    ]


class RunService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], pauses: RedisPauses | None = None
    ) -> None:
        self._sessions = sessions
        self._pauses = pauses

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def refresh_metrics(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: MetricsRefresh,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual keyword metrics run: the given keywords (tracked by the project), else
        the project's keywords whose metrics are older than `stale_days`."""
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            selector: dict[str, object] = {}
            if body.keyword_ids is not None:
                tracked = await runs.tracked_keyword_ids(
                    db, access.workspace_id, project_id, body.keyword_ids
                )
                if any(keyword_id not in tracked for keyword_id in body.keyword_ids):
                    raise invalid_field(
                        "keyword_ids",
                        code="keyword_unknown",
                        message="A keyword the project does not track, or has archived.",
                    )
                selector["keyword_ids"] = sorted(
                    str(keyword_id) for keyword_id in set(body.keyword_ids)
                )
            if body.stale_days is not None:
                selector["stale_days"] = body.stale_days
            await runs.lock_manual_runs(db, project_id)
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=KEYWORD_METRICS,
                user_id=access.user_id,
                request_id=info.request_id,
                selector=selector,
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": KEYWORD_METRICS,
                    "keyword_count": len(body.keyword_ids or ()),
                    "stale_days": body.stale_days,
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created

    async def _provider_paused(self) -> bool:
        """Whether the provider is being left alone. Redis being out is not a reason to refuse:
        the dispatcher looks at the pause again before it sends anything."""
        if self._pauses is None:
            return False
        try:
            return DATAFORSEO in await self._pauses.paused([DATAFORSEO])
        except RedisError:
            _log.warning("provider pause not read; the check goes ahead", exc_info=True)
            return False

    async def check_now(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: CheckNow,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual rank run of the given tracked keywords, asked through the provider's standard
        queue, the same path a schedule uses, so a manual and a scheduled check read the same
        SERP. `409 check_pending` when a keyword already has a check queued or under way,
        `422 quota_exceeded` when the month's checks would pass the workspace's limit,
        `503 provider_paused` while the provider is refusing everyone."""
        if await self._provider_paused():
            raise ProviderPausedError(
                "The data provider is not being asked just now. Try again in a few minutes.",
                headers={"Retry-After": str(PAUSED_RETRY_SECONDS)},
            )
        wanted = sorted(set(body.tracked_keyword_ids))
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            tracked = await runs.active_tracked_ids(db, access.workspace_id, project_id, wanted)
            if len(tracked) != len(wanted):
                raise invalid_field(
                    "tracked_keyword_ids",
                    code="keyword_unknown",
                    message="A keyword the project does not track, or has archived.",
                )
            await runs.lock_manual_runs(db, project_id)
            # Under the lock, so two requests cannot both pass: a keyword with a check on its
            # way is not paid for twice.
            progress = await check_status.progress_of(db, access.workspace_id, wanted)
            pending = [
                str(tracked_id)
                for tracked_id in wanted
                if progress.get(tracked_id, check_status.IDLE).status in check_status.PENDING
            ]
            if pending:
                raise CheckPendingError(
                    "These keywords already have a check queued or under way. Wait for it to end.",
                    tracked_keyword_ids=pending,
                )
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            limit = await runs.lock_serp_check_limit(db, access.workspace_id)
            checks = await runs.manual_serp_checks_since(
                db, access.workspace_id, await _month_start(db)
            )
            if checks + len(wanted) > limit:
                raise QuotaExceededError(
                    f"The workspace has made {checks} of its {limit} manual checks this month "
                    f"(UTC); {len(wanted)} more do not fit.",
                    limit=limit,
                    used=checks,
                    requested=len(wanted),
                    quota="max_serp_checks_per_month",
                )
            # No `live` flag: the planner sends these through the standard queue.
            selector: dict[str, object] = {
                "tracked_keyword_ids": [str(tracked_id) for tracked_id in wanted],
            }
            if body.depth is not None:
                selector["depth"] = body.depth
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=SEO_RANK,
                user_id=access.user_id,
                request_id=info.request_id,
                selector=selector,
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": SEO_RANK,
                    "keyword_count": len(wanted),
                    "depth": body.depth,
                    "queue": "standard",
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created

    async def ai_run_now(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        prompt_id: UUID,
        body: RunNow,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual AI run of one prompt on the given engines, asked through the provider's
        standard queue, the path a schedule uses. `409 check_pending` when an answer of the
        prompt is already queued or under way on one of them, `422 quota_exceeded` when the
        month's AI answers would pass the workspace's limit, `503 provider_paused` while the
        provider is refusing every request."""
        if await self._provider_paused():
            raise ProviderPausedError(
                "The data provider is not being asked just now. Try again in a few minutes.",
                headers={"Retry-After": str(PAUSED_RETRY_SECONDS)},
            )
        engines = sorted({str(code) for code in body.engine_codes})
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            prompt = await ai_runs.runnable_prompt(db, access.workspace_id, project_id, prompt_id)
            if prompt is None:
                raise NotFoundError
            subjects = await _ai_subjects(db, access, project_id, prompt_id, engines)
            await runs.lock_manual_runs(db, project_id)
            # Under the lock, so two requests cannot both pass: an answer on its way is not
            # paid for twice.
            pending = await ai_runs.pending_engines(
                db, access.workspace_id, project_id, prompt, engines
            )
            if pending:
                raise CheckPendingError(
                    "This prompt already has an answer queued or under way on these engines. "
                    "Wait for it to end.",
                    engine_codes=pending,
                )
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            limit = await ai_runs.lock_ai_observation_limit(db, access.workspace_id)
            asked = await ai_runs.ai_tasks_since(db, access.workspace_id, await _month_start(db))
            if asked + len(subjects) > limit:
                raise QuotaExceededError(
                    f"The workspace has asked for {asked} of its {limit} AI answers this month "
                    f"(UTC); {len(subjects)} more do not fit.",
                    limit=limit,
                    used=asked,
                    requested=len(subjects),
                    quota="max_ai_observations_per_month",
                )
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=AI_PROMPT,
                user_id=access.user_id,
                request_id=info.request_id,
                selector={"prompt_ids": [str(prompt_id)], "engine_codes": engines},
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": AI_PROMPT,
                    "prompt_id": str(prompt_id),
                    "engine_codes": engines,
                    "queue": "standard",
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created

    async def ai_bulk_run(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: RunBulk,
        info: RequestInfo,
    ) -> BulkRun:
        """A manual AI run of many prompts through the standard queue, the path a schedule uses:
        one of the project's manual runs of the day, each of its tasks one of the month's AI
        answers. What the planner would skip, and every engine of a prompt with an answer on
        its way, is left out and listed; the rest runs. `409 check_pending` when nothing is left
        and something was pending, `422 nothing_to_run` when nothing is left otherwise."""
        if await self._provider_paused():
            raise ProviderPausedError(
                "The data provider is not being asked just now. Try again in a few minutes.",
                headers={"Retry-After": str(PAUSED_RETRY_SECONDS)},
            )
        wanted = sorted(set(body.prompt_ids))
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            known = await ai_runs.runnable_prompts(db, access.workspace_id, project_id, wanted)
            if len(known) != len(wanted):
                raise invalid_field(
                    "prompt_ids",
                    code="prompt_unknown",
                    message="A prompt the project does not ask: archived, deleted or of another "
                    "project.",
                )
            askable = await ai_runs.askable_engines(db, access.workspace_id, project_id)
            engines = (
                askable
                if body.engine_codes is None
                else sorted({str(code) for code in body.engine_codes})
            )
            refused = [
                FieldError(
                    "engine_codes",
                    "engine_not_enabled",
                    f"{code}: {_NOT_ASKED_WHY['engine_not_enabled']}",
                )
                for code in engines
                if code not in askable
            ]
            if refused:
                raise invalid_fields(refused)
            if not engines:
                raise invalid_field(
                    "engine_codes",
                    code="engine_not_enabled",
                    message="The project has no engine turned on.",
                )
            now = await _now(db)
            subjects, skipped = await ai_prompt.select_subjects(
                db,
                _manual_window(
                    access, project_id, [str(prompt_id) for prompt_id in wanted], engines, now
                ),
            )
            await runs.lock_manual_runs(db, project_id)
            # Under the lock, so two requests cannot both pass: an answer on its way is not
            # paid for twice.
            pending = await ai_runs.pending_pairs(
                db, access.workspace_id, project_id, list(known.values()), engines
            )
            held = {prompt_id for prompt_id, _ in pending}
            left = [subject for subject in subjects if subject.prompt_id not in held]
            out = _left_out(skipped, pending, engines)
            if not left:
                listed = [
                    {
                        "prompt_id": str(item.prompt_id),
                        "engine_code": item.engine_code,
                        "reason": item.reason,
                    }
                    for item in out
                ]
                if held:
                    raise CheckPendingError(
                        "These prompts already have an answer queued or under way. Wait for it "
                        "to end.",
                        prompt_ids=sorted(str(prompt_id) for prompt_id in held),
                        skipped=listed,
                    )
                raise NothingToRunError(
                    "Every prompt is skipped on every engine asked.", skipped=listed
                )
            cost = await ai_prompt.estimate(
                db, left, queue="standard", on=now.astimezone(UTC).date()
            )
            if cost is None:
                raise invalid_field(
                    "engine_codes",
                    code="price_unavailable",
                    message="The price book has no price for these engines today.",
                )
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            limit = await ai_runs.lock_ai_observation_limit(db, access.workspace_id)
            asked = await ai_runs.ai_tasks_since(db, access.workspace_id, await _month_start(db))
            if asked + len(left) > limit:
                raise QuotaExceededError(
                    f"The workspace has asked for {asked} of its {limit} AI answers this month "
                    f"(UTC); {len(left)} more do not fit.",
                    limit=limit,
                    used=asked,
                    requested=len(left),
                    quota="max_ai_observations_per_month",
                )
            prompt_ids = sorted({str(subject.prompt_id) for subject in left})
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=AI_PROMPT,
                user_id=access.user_id,
                request_id=info.request_id,
                selector={"prompt_ids": prompt_ids, "engine_codes": engines},
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": AI_PROMPT,
                    "prompt_count": len(prompt_ids),
                    "engine_codes": engines,
                    "answers": len(left),
                    "skipped_total": len(out),
                    "queue": "standard",
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return BulkRun(
            run=created,
            prompts=len(prompt_ids),
            answers=len(left),
            estimated_cost_usd=cost,
            skipped=out,
            manual_runs_today=used + 1,
        )

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        given: RunFilter,
        *,
        cursor: str | None,
        limit: int,
    ) -> RunPage:
        """The project's runs newest first, and how many manual runs people asked for today."""
        scope = _scope(project_id, given)
        after = None if cursor is None else _after(cursor, scope)
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            found = await runs.list_runs(
                db, access.workspace_id, project_id, given, after=after, limit=limit + 1
            )
            used = await runs.manual_runs_since(
                db, access.workspace_id, project_id, await _today(db)
            )
        shown = found[:limit]
        next_cursor = None
        if len(found) > limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.created_at.isoformat(), str(last.id)], scope=scope)
        return RunPage(runs=shown, next_cursor=next_cursor, manual_runs_today=used)

    async def detail(self, access: WorkspaceAccess, project_id: UUID, run_id: UUID) -> RunDetail:
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            found = await runs.get_run(db, access.workspace_id, project_id, run_id)
            if found is None:
                raise NotFoundError
            counts = await runs.task_counts(db, access.workspace_id, run_id)
        return RunDetail(run=found, tasks_by_status=counts)

    async def cancel(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        run_id: UUID,
        reason: str | None,
        info: RequestInfo,
    ) -> RunRecord:
        """`409 invalid_state_transition` for a run that has ended."""
        if not (access.holds(Permission.SCHEDULES_WRITE) or access.holds(Permission.RUNS_TRIGGER)):
            # Refused before the run is locked: a reader holds up nothing.
            raise ForbiddenError("Cancelling a run needs schedules:write or runs:trigger.")
        async with self._transaction(access) as db:
            await _live_project(db, access, project_id)
            found = await runs.lock_run(db, access.workspace_id, project_id, run_id)
            if found is None:
                raise NotFoundError
            asked_for_it = (
                found.trigger == "manual"
                and found.created_by_type == "user"
                and found.created_by_id == str(access.user_id)
            )
            if not (
                access.holds(Permission.SCHEDULES_WRITE)
                or (asked_for_it and access.holds(Permission.RUNS_TRIGGER))
            ):
                raise ForbiddenError(
                    "Cancelling a run needs schedules:write, or runs:trigger for a manual run "
                    "you asked for."
                )
            if found.status not in _OPEN:
                raise InvalidStateTransitionError(f"The run has ended ({found.status}).")
            await runs.cancel_run(db, access.workspace_id, run_id, reason=CANCELLED_BY_USER)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.cancelled",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                before={"status": found.status},
                after={"status": "cancelled", "reason": reason},
            )
            cancelled = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if cancelled is None:  # pragma: no cover - locked by this transaction
            raise NotFoundError
        return cancelled
