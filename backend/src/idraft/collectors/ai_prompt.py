"""AI answers from the ChatGPT scraper, the Gemini scraper and Google AI Mode (spec section 4.3;
docs/07-dataforseo-ai-integration.md; docs/21-scheduler-workers.md section 3): the workload that
plans a task for each active prompt, enabled engine and location of a window and builds its
`task_post` request.

A task is one prompt version on one engine at one location: subject type `prompt_version`,
subject id the version's id, the engine in `engine_code`, one replicate (spec section 8). A window
asks each of them once: the ledger's idempotency key makes a second planning of a run add nothing,
and a schedule's window leaves out what another schedule's run of an overlapping window has asked.
How often a window comes is the schedule's business; nothing here knows a cadence. Every read
names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal
from uuid import UUID

import structlog
from pydantic import ValidationError
from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.ai.pricing import task_prices
from idraft.collectors.ledger import LedgerTask, NewTask, TaskRef
from idraft.collectors.registry import Plan, ScheduleWindow
from idraft.collectors.seo_rank import location_codes, run_queues
from idraft.db.tables import (
    ai_engines,
    ai_project_engines,
    ai_prompt_versions,
    ai_prompts,
    collection_runs,
    collection_tasks,
    locations,
    projects,
)
from idraft.domain.ai_engines import (
    BASE_PLAN,
    DEFAULT_DEVICE,
    ENGINES,
    EngineCode,
    EngineDevice,
    Queue,
    device_of,
)
from idraft.domain.tasks import scheduled_for
from idraft.domain.workloads import TaskWorkload
from idraft.extraction.ai_facts import EXTRACTOR_VERSION
from idraft.providers.contract import CanonicalRequest
from idraft.providers.dataforseo.ai import ENGINE_ENDPOINTS, PROMPT_MAX, AiAnswerParams
from idraft.providers.dataforseo.ai_parse import PARSER_VERSION
from idraft.providers.dataforseo.provider import CODE as DATAFORSEO

WORKLOAD: Final = TaskWorkload.AI_PROMPT
SUBJECT_TYPE: Final = "prompt_version"
ADAPTER: Final = "dataforseo_ai_answers@1"
# What one manual run takes: every active prompt of the base plan (a bulk run names up to this
# many; Run now names one). A run naming more is refused, not priced and sent.
MANUAL_PROMPTS_MAX: Final = BASE_PLAN.max_prompts
# How many skipped subjects a run's snapshot lists; `skipped_total` always counts them all.
SKIPPED_KEPT: Final = 200
# A task the provider has not answered, or that no one has read yet. For the ingest and Run now.
UNSETTLED: Final = ("pending", "submit_unknown", "submitted", "ready", "fetched")
# A task of another run that has not asked, and will not ask, its prompt.
_NOT_ASKED: Final = ("cancelled", "failed", "dead")
SkipReason = Literal["prompt_too_long", "location_not_enabled"]
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Subject:
    prompt_id: UUID
    version_id: UUID
    engine_code: str
    location_id: int


@dataclass(frozen=True, slots=True)
class Skipped:
    prompt_id: UUID
    engine_code: str
    reason: SkipReason


@dataclass(frozen=True, slots=True)
class _Prompt:
    id: UUID
    version_id: UUID
    length: int
    country_iso: str | None


def _uuids(values: Any) -> list[UUID]:
    return [UUID(str(value)) for value in values]


async def _prompts(
    db: AsyncSession, window: ScheduleWindow, chosen: Sequence[UUID] | None
) -> list[_Prompt]:
    """The project's active prompts with their current version (only those chosen, when a
    manual run names them)."""
    p, v, pr = ai_prompts.c, ai_prompt_versions.c, projects.c
    statement = (
        select(
            p.id,
            p.current_version_id,
            p.country_iso,
            func.char_length(v.text).label("length"),
        )
        .select_from(
            ai_prompts.join(
                ai_prompt_versions,
                and_(v.id == p.current_version_id, v.workspace_id == p.workspace_id),
            ).join(projects, and_(pr.id == p.project_id, pr.workspace_id == p.workspace_id))
        )
        .where(
            p.workspace_id == window.workspace_id,
            p.project_id == window.project_id,
            p.deleted_at.is_(None),
            p.is_active,
            pr.deleted_at.is_(None),
        )
    )
    if chosen is not None:
        statement = statement.where(p.id.in_(list(chosen)))
    return [
        _Prompt(
            id=row.id,
            version_id=row.current_version_id,
            length=row.length,
            country_iso=None if row.country_iso is None else str(row.country_iso).strip(),
        )
        for row in await db.execute(statement)
    ]


async def _engines(
    db: AsyncSession, window: ScheduleWindow, chosen: Sequence[str] | None
) -> dict[str, tuple[int, ...]]:
    """The project's enabled engines this workload can ask, with their locations."""
    e, g = ai_project_engines.c, ai_engines.c
    statement = (
        select(e.engine_code, e.location_ids)
        .join(ai_engines, g.code == e.engine_code)
        .where(
            e.workspace_id == window.workspace_id,
            e.project_id == window.project_id,
            e.is_enabled,
            g.is_active,
            e.engine_code.in_(sorted(ENGINE_ENDPOINTS)),
        )
    )
    if chosen is not None:
        statement = statement.where(e.engine_code.in_(list(chosen)))
    return {row.engine_code: tuple(row.location_ids or ()) for row in await db.execute(statement)}


async def _location_countries(db: AsyncSession, location_ids: Collection[int]) -> dict[int, str]:
    """The country of each active location."""
    if not location_ids:
        return {}
    loc = locations.c
    rows = await db.execute(
        select(loc.id, loc.country_iso).where(loc.id.in_(sorted(location_ids)), loc.is_active)
    )
    return {row.id: str(row.country_iso).strip() for row in rows}


async def _asked_elsewhere(db: AsyncSession, window: ScheduleWindow) -> set[tuple[str, str | None]]:
    """(version id, engine) pairs another schedule's run of an overlapping window has asked or
    will ask. A manual run is never held back by them: a person asked."""
    if window.schedule_id is None:
        return set()
    t, r = collection_tasks.c, collection_runs.c
    rows = await db.execute(
        select(t.subject_id, t.engine_code)
        .distinct()
        .select_from(
            collection_tasks.join(
                collection_runs, and_(r.id == t.run_id, r.workspace_id == t.workspace_id)
            )
        )
        .where(
            t.workspace_id == window.workspace_id,
            t.project_id == window.project_id,
            t.workload == WORKLOAD.value,
            t.subject_type == SUBJECT_TYPE,
            t.status.not_in(_NOT_ASKED),
            r.schedule_id.is_not(None),
            r.schedule_id != window.schedule_id,
            r.window_start < window.window_end,
            r.window_end > window.window_start,
        )
    )
    return {(row.subject_id, row.engine_code) for row in rows}


async def select_subjects(
    db: AsyncSession, window: ScheduleWindow
) -> tuple[list[Subject], list[Skipped]]:
    """What the window asks, once each, and what it leaves out and why."""
    chosen_prompts: list[UUID] | None = None
    chosen_engines: list[str] | None = None
    if window.schedule_id is None:
        named = window.selector.get("prompt_ids")
        if not named:
            return [], []
        if len(named) > MANUAL_PROMPTS_MAX:
            raise ValueError(f"a manual AI run takes at most {MANUAL_PROMPTS_MAX} prompts")
        chosen_prompts = _uuids(named)
        engines_named = window.selector.get("engine_codes")
        if engines_named is not None:
            chosen_engines = [str(code) for code in engines_named]
    prompts = await _prompts(db, window, chosen_prompts)
    engines = await _engines(db, window, chosen_engines)
    if not prompts or not engines:
        return [], []
    countries = await _location_countries(
        db, {location for allowed in engines.values() for location in allowed}
    )
    asked = await _asked_elsewhere(db, window)
    subjects: list[Subject] = []
    skipped: list[Skipped] = []
    for prompt in prompts:
        for engine_code, allowed in sorted(engines.items()):
            if prompt.length > PROMPT_MAX[ENGINE_ENDPOINTS[engine_code]]:
                skipped.append(Skipped(prompt.id, engine_code, "prompt_too_long"))
                continue
            here = [
                location
                for location in allowed
                if prompt.country_iso is not None and countries.get(location) == prompt.country_iso
            ]
            if not here:
                skipped.append(Skipped(prompt.id, engine_code, "location_not_enabled"))
                continue
            if (str(prompt.version_id), engine_code) in asked:
                continue
            subjects.extend(
                Subject(prompt.id, prompt.version_id, engine_code, location) for location in here
            )
    subjects.sort(key=lambda s: (s.location_id, s.engine_code, str(s.version_id)))
    return subjects, skipped


def queue_of(provider_mode: str) -> Literal["standard", "priority"]:
    """The priority queue only when the schedule chose it. AI answers are never asked live
    (spec section 4.3), so every other mode is the standard queue."""
    return "priority" if provider_mode == "priority_queue" else "standard"


async def estimate(
    db: AsyncSession, subjects: Sequence[Subject], *, queue: Queue, on: date
) -> Decimal | None:
    """What the subjects cost by the price book (plan A's `task_prices`): each endpoint's task
    price at the queue. None, and an error in the log, when an endpoint has no price: a run is
    never planned on a guess of zero."""
    if not subjects:
        return Decimal(0)
    wanted = {ENGINE_ENDPOINTS[subject.engine_code] for subject in subjects}
    prices = await task_prices(db, queue=queue, on=on)
    missing = wanted - prices.keys()
    if missing:
        _log.error("no price for AI answers", endpoints=sorted(missing), queue=queue)
        return None
    return sum((prices[ENGINE_ENDPOINTS[subject.engine_code]] for subject in subjects), Decimal(0))


def _due(window: ScheduleWindow, subject: Subject) -> datetime:
    """A schedule's tasks are spread over its window; a manual run has someone waiting."""
    if window.schedule_id is None:
        return window.window_start
    return scheduled_for(
        window_start=window.window_start,
        subject_id=f"{subject.version_id}:{subject.engine_code}",
        workload=WORKLOAD.value,
        window_hours=window.window_hours,
    )


def new_tasks(subjects: Sequence[Subject], window: ScheduleWindow) -> list[NewTask]:
    queue = queue_of(window.provider_mode)
    return [
        NewTask(
            subject_type=SUBJECT_TYPE,
            subject_id=str(subject.version_id),
            engine_code=subject.engine_code,
            location_id=subject.location_id,
            replicate_index=1,
            depth=None,
            request_fingerprint=hashlib.sha256(
                f"{subject.version_id}:{subject.engine_code}:{subject.location_id}:{queue}".encode()
            ).digest(),
            provider_code=DATAFORSEO,
            provider_endpoint=ENGINE_ENDPOINTS[subject.engine_code],
            scheduled_for=_due(window, subject),
        )
        for subject in subjects
    ]


def _skipped(skipped: Sequence[Skipped]) -> list[dict[str, str]]:
    return [
        {"prompt_id": str(item.prompt_id), "engine_code": item.engine_code, "reason": item.reason}
        for item in skipped[:SKIPPED_KEPT]
    ]


class AiPromptWorkload:
    """Plans AI answer tasks for a schedule's window or a manual run, and builds their
    requests."""

    name: Final = WORKLOAD

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        subjects, skipped = await select_subjects(db, window)
        queue = queue_of(window.provider_mode)
        cost = await estimate(db, subjects, queue=queue, on=window.window_start.date())
        snapshot: dict[str, Any] = {
            "adapter": ADAPTER,
            "normalizer_version": PARSER_VERSION,
            "extractor_version": EXTRACTOR_VERSION,
            "provider_mode": window.provider_mode,
            "queue": queue,
            "replicates": 1,
            "selector": dict(window.selector),
            "skipped": _skipped(skipped),
            "skipped_total": len(skipped),
        }
        if cost is None:
            # Nothing is planned without a price to check the budget against.
            return Plan(tasks=[], estimated_cost_usd=Decimal(0), config_snapshot=snapshot)
        return Plan(
            tasks=new_tasks(subjects, window), estimated_cost_usd=cost, config_snapshot=snapshot
        )

    def batch_key(self, task: LedgerTask) -> str:
        """Any tasks of one endpoint may go in one `task_post`; the dispatcher already splits
        by endpoint."""
        return ""

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        """Each task's prompt version as saved, at its location's DataForSEO code, in the
        prompt's language. A task whose prompt is gone or archived is left out."""
        wanted: dict[TaskRef, tuple[LedgerTask, UUID]] = {}
        for task in tasks:
            if task.subject_type != SUBJECT_TYPE or task.engine_code not in ENGINE_ENDPOINTS:
                continue
            try:
                wanted[task.ref] = (task, UUID(task.subject_id))
            except ValueError:
                continue
        versions = await _versions(
            db, {(version_id, task.workspace_id) for task, version_id in wanted.values()}
        )
        codes = await location_codes(db, {task.location_id for task, _ in wanted.values()})
        queues = await run_queues(db, {task.run_id for task, _ in wanted.values()})
        devices = await _devices(db, [task for task, _ in wanted.values()])
        requests: dict[TaskRef, CanonicalRequest] = {}
        for ref, (task, version_id) in wanted.items():
            found = versions.get((version_id, task.workspace_id))
            if found is None or task.location_id is None:
                continue
            try:
                params = AiAnswerParams(
                    prompt=found.text,
                    location_code=codes.get(task.location_id, task.location_id),
                    language_code=found.language_code,
                    queue="priority" if queues.get(task.run_id) == "priority" else "standard",
                    device=devices.get(_device_key(task), DEFAULT_DEVICE),
                )
            except ValidationError as error:
                # One prompt the provider would refuse must not take the tasks it is batched
                # with down: it is left out and recorded as a request that could not be built.
                _log.warning("AI request not built", task=task.ref.id, error=str(error)[:200])
                continue
            requests[ref] = CanonicalRequest(
                task_id=str(task.ref.id),
                run_id=task.run_id,
                priority="high" if task.priority == "high" else "standard",
                params=params,
            )
        return requests


_DeviceKey = tuple[UUID, UUID, str | None]


def _device_key(task: LedgerTask) -> _DeviceKey:
    return (task.workspace_id, task.project_id, task.engine_code)


async def _devices(db: AsyncSession, tasks: Sequence[LedgerTask]) -> dict[_DeviceKey, EngineDevice]:
    """The saved device of each project's device-taking engine (Google AI Mode) among the tasks:
    one read for the whole batch, by workspace, project and engine. An engine with no row or no
    device is left out, and asks the default. The scrapers take no device and are not read."""
    keys = {_device_key(task) for task in tasks if _takes_device(task.engine_code)}
    if not keys:
        return {}
    e = ai_project_engines.c
    rows = await db.execute(
        select(e.workspace_id, e.project_id, e.engine_code, e.provider_params).where(
            tuple_(e.workspace_id, e.project_id, e.engine_code).in_(list(keys))
        )
    )
    return {
        (row.workspace_id, row.project_id, row.engine_code): device_of(row.provider_params)
        for row in rows
    }


def _takes_device(engine_code: str | None) -> bool:
    return engine_code is not None and ENGINES[EngineCode(engine_code)].supports_device


@dataclass(frozen=True, slots=True)
class _Version:
    text: str
    language_code: str


async def _versions(
    db: AsyncSession, keys: Collection[tuple[UUID, UUID]]
) -> dict[tuple[UUID, UUID], _Version]:
    """The text of each (version, workspace) whose prompt is live and active."""
    if not keys:
        return {}
    v, p = ai_prompt_versions.c, ai_prompts.c
    rows = await db.execute(
        select(v.id, v.workspace_id, v.text, p.language_code)
        .select_from(
            ai_prompt_versions.join(
                ai_prompts, and_(p.id == v.prompt_id, p.workspace_id == v.workspace_id)
            )
        )
        .where(
            tuple_(v.id, v.workspace_id).in_(list(keys)),
            p.deleted_at.is_(None),
            # Archived since it was planned: not sent, not paid for.
            p.is_active,
        )
    )
    return {(row.id, row.workspace_id): _Version(row.text, row.language_code) for row in rows}
