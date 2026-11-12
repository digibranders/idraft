"""The fixture's engines on, with every active AI schedule of the project paused in the same
transaction (plan D3 decision 10).

The seed never overwrites what a person set. An engine never configured is turned on at the
fixture's countries. An engine already on gains the fixture's missing countries (the union, never
fewer countries than it runs in) and is not put at all when it already covers them: a put always
writes an audit entry, and the second run must write nothing. An engine a person turned off stays
off and is reported in `EngineChanges.left_off`.

Turning the first engine on makes the project's two AI answer schedules (`ensure_ai_schedule`),
which would spend at their next window. Both are paused before the transaction commits, so they
never exist active. Spend safety wins: every active AI schedule is paused on every run.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from idraft.api.ai import engine_repository
from idraft.api.ai.engine_service import put_engine
from idraft.api.operations import schedules_repository
from idraft.api.operations.schedules import pause_schedule
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.schemas.operations import SchedulePause
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, Sessions
from idraft.devseed.fixture import EnginePart
from idraft.domain.ai_engines import EngineCode
from idraft.domain.workloads import TaskWorkload

PAUSE_REASON: Final = "dev seed: paused so nothing spends by itself"
# A project has at most `BASE_PLAN.runs_per_week` live AI schedules; this is far above it.
_SCHEDULES_MAX: Final = 100


@dataclass(frozen=True, slots=True)
class EngineChanges:
    """`turned_on` were never configured and now run at the fixture's countries; `widened` were
    on and gained countries; `left_off` were turned off by a person and stay off. `paused` is the
    number of active AI schedules the run paused."""

    turned_on: tuple[EngineCode, ...]
    widened: tuple[EngineCode, ...]
    left_off: tuple[EngineCode, ...]
    paused: int


async def ensure_engines(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    engines: Sequence[EnginePart],
    location_ids: Mapping[str, int],
) -> EngineChanges:
    turned_on: list[EngineCode] = []
    widened: list[EngineCode] = []
    left_off: list[EngineCode] = []
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        current = await engine_repository.project_engines(db, access.workspace_id, project_id)
        for part in engines:
            wanted = {location_ids[country] for country in part.countries}
            have = current.get(part.engine_code)
            if have is None:
                put, changed = sorted(wanted), turned_on
            elif not have.is_enabled:
                left_off.append(part.engine_code)
                continue
            elif wanted <= set(have.location_ids):
                continue
            else:
                put, changed = sorted(wanted | set(have.location_ids)), widened
            await put_engine(
                db,
                access,
                project_id,
                part.engine_code,
                EngineUpdate(location_ids=put, is_enabled=True),
                SEED_INFO,
            )
            changed.append(part.engine_code)
        active, _ = await schedules_repository.list_schedules(
            db,
            access.workspace_id,
            project_id,
            workload=TaskWorkload.AI_PROMPT.value,
            is_active=True,
            offset=0,
            limit=_SCHEDULES_MAX,
        )
        for schedule in active:
            await pause_schedule(
                db, access, project_id, schedule.id, SchedulePause(reason=PAUSE_REASON), SEED_INFO
            )
    return EngineChanges(
        turned_on=tuple(turned_on),
        widened=tuple(widened),
        left_off=tuple(left_off),
        paused=len(active),
    )
