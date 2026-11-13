"""Rules for a project's AI engines (docs/19-api-specification.md section 3.7.4; spec
2026-11-11 section 4.5).

An engine is off until a person turns it on, since that starts weekly spend; the list shows each
engine's monthly estimate first, as if it were on. Turning one on makes the project's AI answer
schedules (`idraft.ai.schedule`) when it has none, in the same transaction. Engine writes lock
the project row, so two at once cannot both make schedules. Every change is audited.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.ai.pricing import task_prices
from idraft.ai.schedule import ensure_ai_schedule
from idraft.api import audit
from idraft.api.ai import engine_repository as repository
from idraft.api.ai.engine_repository import ProjectEngineRecord
from idraft.api.problems import NotFoundError, invalid_field
from idraft.api.projects import repository as projects
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai import EngineUpdate
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import (
    BASE_PLAN,
    ENGINES,
    Engine,
    EngineCode,
    device_of,
    monthly_cost,
)


@dataclass(frozen=True, slots=True)
class EngineView:
    engine: Engine
    configured: ProjectEngineRecord | None
    active_prompts: int
    estimated_monthly_cost_usd: Decimal | None


async def live_project(
    db: AsyncSession, access: WorkspaceAccess, project_id: UUID, *, lock: bool = False
) -> None:
    """The project exists and is not deleted; with `lock`, writers to it wait for this one."""
    if await projects.get_project(db, access.workspace_id, project_id, for_update=lock) is None:
        raise NotFoundError


def _snapshot(record: ProjectEngineRecord | None) -> audit.Snapshot | None:
    if record is None:
        return None
    snapshot: dict[str, str | int | bool | list[str] | None] = {
        "engine_code": record.engine_code.value,
        "location_ids": [str(location_id) for location_id in record.location_ids],
        "is_enabled": record.is_enabled,
    }
    if ENGINES[record.engine_code].supports_device:
        snapshot["device"] = device_of(record.provider_params)
    return snapshot


def _provider_params(
    engine: Engine, before: ProjectEngineRecord | None, body: EngineUpdate
) -> dict[str, str]:
    """What the engine row stores: `{"device": ...}` for an engine that takes one (the one in the
    body, else the saved one, else the default), `{}` for the others."""
    asked = None if body.provider_params is None else body.provider_params.device
    if not engine.supports_device:
        if asked is not None:
            raise invalid_field(
                "provider_params.device",
                code="device_not_supported",
                message=f"{engine.label} takes no device.",
            )
        return {}
    return {"device": asked or device_of(None if before is None else before.provider_params)}


async def _views(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, codes: Sequence[EngineCode]
) -> list[EngineView]:
    configured = await repository.project_engines(db, workspace_id, project_id)
    lengths = await repository.prompt_lengths(db, workspace_id, project_id)
    prices = await task_prices(db, queue=BASE_PLAN.queue, on=datetime.now(UTC).date())
    views = []
    for code in codes:
        engine = ENGINES[code]
        prompts = sum(1 for length in lengths if length <= engine.max_prompt_chars)
        price = prices.get(engine.endpoint)
        views.append(
            EngineView(
                engine=engine,
                configured=configured.get(code),
                active_prompts=prompts,
                estimated_monthly_cost_usd=None if price is None else monthly_cost(prompts, price),
            )
        )
    return views


async def put_engine(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    engine_code: EngineCode,
    body: EngineUpdate,
    info: RequestInfo,
) -> EngineView:
    """`EngineService.put` in the caller's transaction, so the caller can do more in it before
    anything commits (the dev seed pauses the schedules this makes: idraft.devseed.engines)."""
    engine = ENGINES[engine_code]
    location_ids = sorted(set(body.location_ids))
    await live_project(db, access, project_id, lock=True)
    runnable = await repository.runnable_locations(db, engine, location_ids)
    if set(location_ids) - runnable:
        raise invalid_field(
            "location_ids",
            code="location_not_supported",
            message=f"{engine.label} runs in active countries only.",
        )
    before = await repository.get_project_engine(db, access.workspace_id, project_id, engine_code)
    provider_params = _provider_params(engine, before, body)
    await repository.save_project_engine(
        db,
        workspace_id=access.workspace_id,
        project_id=project_id,
        engine_code=engine_code,
        location_ids=location_ids,
        is_enabled=body.is_enabled,
        provider_params=provider_params,
    )
    # Only when the engine goes from off to on: saving the countries of an engine that is
    # already on must not bring back schedules a person deleted.
    if body.is_enabled and (before is None or not before.is_enabled):
        await ensure_ai_schedule(
            db,
            workspace_id=access.workspace_id,
            project_id=project_id,
            now=datetime.now(UTC),
        )
    (view,) = await _views(db, access.workspace_id, project_id, [engine_code])
    await audit.record(
        db,
        workspace_id=access.workspace_id,
        actor_id=access.user_id,
        action="project_engine.updated",
        target_type="project",
        target_id=project_id,
        info=info,
        before=_snapshot(before),
        after=_snapshot(view.configured),
    )
    return view


class EngineService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list_engines(self, access: WorkspaceAccess, project_id: UUID) -> list[EngineView]:
        """Every engine slice 1 offers, configured or not, in `EngineCode` order."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            return await _views(db, access.workspace_id, project_id, list(EngineCode))

    async def put(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        engine_code: EngineCode,
        body: EngineUpdate,
        info: RequestInfo,
    ) -> EngineView:
        async with self._transaction(access) as db:
            return await put_engine(db, access, project_id, engine_code, body, info)

    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, engine_code: EngineCode, info: RequestInfo
    ) -> None:
        """The engine's settings go; its answers stay. The schedules stay too: with no engine
        on, a run asks nothing."""
        async with self._transaction(access) as db:
            await live_project(db, access, project_id, lock=True)
            before = await repository.get_project_engine(
                db, access.workspace_id, project_id, engine_code
            )
            if before is None:
                raise NotFoundError
            await repository.delete_project_engine(db, access.workspace_id, project_id, engine_code)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="project_engine.deleted",
                target_type="project",
                target_id=project_id,
                info=info,
                before=_snapshot(before),
            )
