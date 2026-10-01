"""Rules for schedules (docs/19-api-specification.md section 3.11.3; plan decision D10).

A schedule is planned by the worker at `next_run_at`, which the API computes from the rule in
the schedule's time zone (`sightline.domain.schedules`) on every change and on resume; missed
windows are not caught up. Only workloads the worker plans are offered, each with the
selectors and provider modes it takes. A deleted schedule keeps its row so its runs keep naming
it, and a schedule tracked keywords name is not deleted. Every change is audited in its
transaction.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime, time
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.keywords import repository as keywords
from sightline.api.operations import schedules_repository as repository
from sightline.api.operations.schedules_repository import ScheduleRecord
from sightline.api.problems import (
    FieldError,
    NotFoundError,
    ScheduleInUseError,
    invalid_field,
    invalid_fields,
)
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.operations import ScheduleInput, SchedulePause, ScheduleUpdate, Selector
from sightline.api.timezones import check_timezone
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.domain.schedules import (
    Cadence,
    ScheduleRule,
    next_after_change,
    next_occurrence,
)


@dataclass(frozen=True, slots=True)
class WorkloadRules:
    """What a schedule of one workload may hold."""

    selectors: frozenset[str]
    provider_modes: frozenset[str]
    # A selector that names nothing selects nothing; `keyword_metrics` reads it as "the stale
    # ones" instead.
    needs_selector: bool


# The workloads the worker plans in this step and the next (plan decision D10).
WORKLOADS: Final[Mapping[str, WorkloadRules]] = {
    # Labs is called live (plan decision D6).
    "keyword_metrics": WorkloadRules(
        selectors=frozenset({"stale_days", "all", "groups", "terms"}),
        provider_modes=frozenset({"live"}),
        needs_selector=False,
    ),
    "seo_rank": WorkloadRules(
        selectors=frozenset({"all", "groups", "terms", "priority_lte"}),
        provider_modes=frozenset({"standard_queue", "priority_queue", "live"}),
        needs_selector=True,
    ),
}
# The order selector members are checked in, so the first error found is always the same one.
_SELECTOR_ORDER: Final = ("all", "groups", "terms", "priority_lte", "stale_days")


@dataclass(frozen=True, slots=True)
class Page:
    schedules: list[ScheduleRecord]
    total: int


def _given(selector: Selector) -> dict[str, object]:
    """The members the selector names: null and empty lists name nothing."""
    found: dict[str, object] = {}
    for name, value in selector.model_dump(mode="json").items():
        if value is None or value == []:
            continue
        found[name] = sorted(set(value)) if isinstance(value, list) else value
    return found


def _selector_errors(workload: str, selector: Selector) -> list[FieldError]:
    rules = WORKLOADS[workload]
    given = _given(selector)
    for name in _SELECTOR_ORDER:
        if name in given and name not in rules.selectors:
            return [
                FieldError(
                    f"selector.{name}",
                    "selector_not_supported",
                    f"A {workload} schedule does not select by {name}.",
                )
            ]
    if rules.needs_selector and not given:
        return [
            FieldError(
                "selector",
                "selector_empty",
                "Name the keywords: all, groups, terms or a priority.",
            )
        ]
    if "all" in given and "stale_days" in given:
        # `all` takes keywords however fresh their metrics; `stale_days` only the stale ones.
        return [
            FieldError(
                "selector.stale_days",
                "selector_conflict",
                "Give all or stale_days, not both.",
            )
        ]
    return []


_CADENCES: Final = frozenset(cadence.value for cadence in Cadence)


def _shape_errors(workload: str, cadence: str, provider_mode: str) -> list[FieldError]:
    """What the planner cannot run, before anything is read."""
    if workload not in WORKLOADS:
        return [
            FieldError(
                "workload", "workload_not_available", "Schedules of this workload come later."
            )
        ]
    if cadence not in _CADENCES:
        return [
            FieldError(
                "cadence",
                "cadence_not_supported",
                "A schedule runs daily, weekly or monthly.",
            )
        ]
    modes = WORKLOADS[workload].provider_modes
    if provider_mode not in modes:
        return [
            FieldError(
                "provider_mode",
                "provider_mode_not_supported",
                f"A {workload} schedule takes the provider mode {' or '.join(sorted(modes))}.",
            )
        ]
    return []


def _rule(
    *,
    cadence: str,
    timezone: str,
    window_start_local: time,
    weekday: int | None,
    month_day: int | None,
) -> ScheduleRule:
    try:
        return ScheduleRule(
            cadence=Cadence(cadence),
            timezone=timezone,
            window_start_local=window_start_local,
            weekday=weekday,
            month_day=month_day,
        )
    except ValueError:
        # Shapes are checked before; a zone PostgreSQL knows and Python does not is left.
        raise invalid_field(
            "timezone", code="timezone_unknown", message="Unknown time zone."
        ) from None


def _snapshot(record: ScheduleRecord) -> audit.Snapshot:
    return {
        "workload": record.workload,
        "name": record.name,
        "cadence": record.cadence,
        "timezone": record.timezone,
        "window_start_local": record.window_start_local.isoformat(timespec="minutes"),
        "window_hours": record.window_hours,
        "weekday": record.weekday,
        "month_day": record.month_day,
        "priority": record.priority,
        "provider_mode": record.provider_mode,
        "selector": json.dumps(record.selector, sort_keys=True),
        "is_active": record.is_active,
    }


async def _now(db: AsyncSession) -> datetime:
    now: datetime = (await db.execute(select(func.now()))).scalar_one()
    return now


class ScheduleService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _project(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> None:
        if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
            raise NotFoundError

    @classmethod
    async def _found(
        cls, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, schedule_id: UUID
    ) -> ScheduleRecord:
        """The live schedule of a live project, locked for a change."""
        await cls._project(db, access, project_id)
        found = await repository.get_schedule(
            db, access.workspace_id, project_id, schedule_id, lock=True
        )
        if found is None:
            raise NotFoundError
        return found

    @staticmethod
    async def _references(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, selector: Selector
    ) -> None:
        """Groups of the project and terms it may use. One deleted later stops matching."""
        groups = set(selector.groups or ())
        if groups - await keywords.project_groups(db, access.workspace_id, project_id, groups):
            raise invalid_field(
                "selector.groups", code="group_unknown", message="A group of another project."
            )
        terms = set(selector.terms or ())
        usable = await keywords.project_terms(
            db, access.workspace_id, project_id, terms, hold=False
        )
        if terms - {term.term_id for term in usable}:
            raise invalid_field(
                "selector.terms", code="term_unknown", message="A term the project cannot use."
            )

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        workload: str | None,
        is_active: bool | None,
        offset: int,
        limit: int,
    ) -> Page:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            found, total = await repository.list_schedules(
                db,
                access.workspace_id,
                project_id,
                workload=workload,
                is_active=is_active,
                offset=offset,
                limit=limit,
            )
        return Page(found, total)

    async def get(
        self, access: WorkspaceAccess, project_id: UUID, schedule_id: UUID
    ) -> ScheduleRecord:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            found = await repository.get_schedule(
                db, access.workspace_id, project_id, schedule_id, lock=False
            )
        if found is None:
            raise NotFoundError
        return found

    async def create(
        self, access: WorkspaceAccess, project_id: UUID, body: ScheduleInput, info: RequestInfo
    ) -> ScheduleRecord:
        errors = _shape_errors(body.workload, body.cadence, body.provider_mode) or (
            _selector_errors(body.workload, body.selector)
        )
        if not errors and body.cron_expr is not None:
            errors = [
                FieldError("cron_expr", "not_applicable", "Only a cron schedule has an expression.")
            ]
        if errors:
            raise invalid_fields(errors)
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            await check_timezone(db, body.timezone)
            await self._references(db, access, project_id, body.selector)
            rule = _rule(
                cadence=body.cadence,
                timezone=body.timezone,
                window_start_local=body.window_start_local,
                weekday=body.weekday,
                month_day=body.month_day,
            )
            created = await repository.insert_schedule(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                values={
                    "workload": body.workload,
                    "name": body.name,
                    "cadence": body.cadence,
                    "timezone": body.timezone,
                    "window_start_local": body.window_start_local,
                    "window_hours": body.window_hours,
                    "weekday": body.weekday,
                    "month_day": body.month_day,
                    "priority": body.priority,
                    "provider_mode": body.provider_mode,
                    "selector": _given(body.selector),
                    "next_run_at": next_occurrence(rule, await _now(db)),
                },
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="schedule.created",
                target_type="schedule",
                target_id=created.id,
                info=info,
                after=_snapshot(created),
            )
        return created

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        schedule_id: UUID,
        body: ScheduleUpdate,
        info: RequestInfo,
    ) -> ScheduleRecord:
        given = body.model_fields_set
        async with self._transaction(access) as db:
            current = await self._found(db, access, project_id, schedule_id)
            cadence = body.cadence if body.cadence is not None else current.cadence
            provider_mode = body.provider_mode or current.provider_mode
            selector = (
                body.selector
                if body.selector is not None
                else Selector.model_validate(current.selector)
            )
            errors = _shape_errors(current.workload, cadence, provider_mode) or (
                _selector_errors(current.workload, selector)
            )
            weekday, month_day, day_errors = _days(body, current, cadence)
            errors = errors or day_errors
            if errors:
                raise invalid_fields(errors)
            timezone = body.timezone or current.timezone
            if "timezone" in given:
                await check_timezone(db, timezone)
            if body.selector is not None:
                await self._references(db, access, project_id, body.selector)
            window_start_local = body.window_start_local or current.window_start_local
            rule = _rule(
                cadence=cadence,
                timezone=timezone,
                window_start_local=window_start_local,
                weekday=weekday,
                month_day=month_day,
            )
            same_rule = (cadence, timezone, window_start_local, weekday, month_day) == (
                current.cadence,
                current.timezone,
                current.window_start_local,
                current.weekday,
                current.month_day,
            )
            # A change that leaves the rule alone leaves the next window alone, so a window
            # that is due and not yet planned is still planned. A new rule starts after now,
            # outside the period a window of the schedule already started in.
            next_run_at = (
                current.next_run_at
                if same_rule
                else next_after_change(
                    rule,
                    await _now(db),
                    await repository.last_window_start(db, access.workspace_id, schedule_id),
                )
            )
            changed = await repository.update_schedule(
                db,
                access.workspace_id,
                schedule_id,
                {
                    "name": body.name or current.name,
                    "cadence": cadence,
                    "timezone": timezone,
                    "window_start_local": window_start_local,
                    "window_hours": body.window_hours or current.window_hours,
                    "weekday": weekday,
                    "month_day": month_day,
                    "priority": body.priority or current.priority,
                    "provider_mode": provider_mode,
                    "selector": _given(selector),
                    "next_run_at": next_run_at,
                },
            )
            if _snapshot(changed) != _snapshot(current):
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="schedule.updated",
                    target_type="schedule",
                    target_id=schedule_id,
                    info=info,
                    before=_snapshot(current),
                    after=_snapshot(changed),
                )
        return changed

    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, schedule_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            current = await self._found(db, access, project_id, schedule_id)
            if await repository.schedule_in_use(db, access.workspace_id, schedule_id):
                raise ScheduleInUseError(
                    "Tracked keywords use this schedule. Move them to another one first."
                )
            await repository.delete_schedule(db, access.workspace_id, schedule_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="schedule.deleted",
                target_type="schedule",
                target_id=schedule_id,
                info=info,
                before=_snapshot(current),
            )

    async def pause(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        schedule_id: UUID,
        body: SchedulePause,
        info: RequestInfo,
    ) -> ScheduleRecord:
        """Not planned until resumed. Pausing a paused schedule changes nothing."""
        async with self._transaction(access) as db:
            current = await self._found(db, access, project_id, schedule_id)
            if not current.is_active:
                return current
            paused = await repository.update_schedule(
                db, access.workspace_id, schedule_id, {"is_active": False}
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="schedule.paused",
                target_type="schedule",
                target_id=schedule_id,
                info=info,
                before={"is_active": True},
                after={"is_active": False, "reason": body.reason},
            )
        return paused

    async def resume(
        self, access: WorkspaceAccess, project_id: UUID, schedule_id: UUID, info: RequestInfo
    ) -> ScheduleRecord:
        """Planned again from its next window after now: the windows missed while paused are
        not caught up (docs/21 section 3.1)."""
        async with self._transaction(access) as db:
            current = await self._found(db, access, project_id, schedule_id)
            if current.is_active:
                return current
            rule = _rule(
                cadence=current.cadence,
                timezone=current.timezone,
                window_start_local=current.window_start_local,
                weekday=current.weekday,
                month_day=current.month_day,
            )
            resumed = await repository.update_schedule(
                db,
                access.workspace_id,
                schedule_id,
                {"is_active": True, "next_run_at": next_occurrence(rule, await _now(db))},
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="schedule.resumed",
                target_type="schedule",
                target_id=schedule_id,
                info=info,
                before={"is_active": False},
                after={"is_active": True, "next_run_at": resumed.next_run_at.isoformat()},
            )
        return resumed


def _days(
    body: ScheduleUpdate, current: ScheduleRecord, cadence: str
) -> tuple[int | None, int | None, list[FieldError]]:
    """The weekday and the day of the month after the change: kept while the cadence uses them,
    dropped when it no longer does, and required when it starts to."""
    given = body.model_fields_set
    weekday = body.weekday if "weekday" in given else current.weekday
    month_day = body.month_day if "month_day" in given else current.month_day
    errors: list[FieldError] = []
    if cadence == Cadence.WEEKLY:
        if weekday is None:
            errors.append(FieldError("weekday", "required", "A weekly schedule names its day."))
    elif "weekday" in given and body.weekday is not None:
        errors.append(FieldError("weekday", "not_applicable", "Only weekly schedules have one."))
    else:
        weekday = None
    if cadence == Cadence.MONTHLY:
        if month_day is None:
            errors.append(FieldError("month_day", "required", "A monthly schedule names its day."))
    elif "month_day" in given and body.month_day is not None:
        errors.append(FieldError("month_day", "not_applicable", "Only monthly schedules have one."))
    else:
        month_day = None
    return weekday, month_day, errors
