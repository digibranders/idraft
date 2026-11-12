"""Reads and writes of a project's AI engines (docs/04-data-model.md section 8.1).

Runs in the caller's transaction as the API role; every statement names the workspace.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import Integer, Row, and_, any_, delete, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import ai_project_engines, ai_prompt_versions, ai_prompts, locations
from idraft.domain.ai_engines import BASE_PLAN, PROVIDER_CODE, Engine, EngineCode


@dataclass(frozen=True, slots=True)
class ProjectEngineRecord:
    engine_code: EngineCode
    location_ids: list[int]
    replicates: int
    provider_code: str
    is_enabled: bool


def _record(row: Row[Any]) -> ProjectEngineRecord:
    return ProjectEngineRecord(
        engine_code=EngineCode(row.engine_code),
        location_ids=list(row.location_ids),
        replicates=row.replicates,
        provider_code=row.provider_code,
        is_enabled=row.is_enabled,
    )


def _of_project(workspace_id: UUID, project_id: UUID) -> Any:
    return and_(
        ai_project_engines.c.workspace_id == workspace_id,
        ai_project_engines.c.project_id == project_id,
    )


async def project_engines(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> dict[EngineCode, ProjectEngineRecord]:
    rows = await db.execute(select(ai_project_engines).where(_of_project(workspace_id, project_id)))
    return {record.engine_code: record for record in (_record(row) for row in rows)}


async def get_project_engine(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, engine_code: EngineCode
) -> ProjectEngineRecord | None:
    row = (
        await db.execute(
            select(ai_project_engines).where(
                _of_project(workspace_id, project_id),
                ai_project_engines.c.engine_code == engine_code.value,
            )
        )
    ).one_or_none()
    return None if row is None else _record(row)


async def save_project_engine(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    engine_code: EngineCode,
    location_ids: Sequence[int],
    is_enabled: bool,
) -> None:
    """The engine's settings, made or changed. The provider and the answers per engine are the
    base plan's (spec section 8: one answer per prompt and engine)."""
    statement = upsert(ai_project_engines).values(
        project_id=project_id,
        engine_code=engine_code.value,
        workspace_id=workspace_id,
        location_ids=list(location_ids),
        replicates=BASE_PLAN.answers_per_engine,
        provider_code=PROVIDER_CODE,
        is_enabled=is_enabled,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[ai_project_engines.c.project_id, ai_project_engines.c.engine_code],
            set_={
                "location_ids": statement.excluded.location_ids,
                "is_enabled": statement.excluded.is_enabled,
            },
        )
    )


async def delete_project_engine(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, engine_code: EngineCode
) -> None:
    await db.execute(
        delete(ai_project_engines).where(
            _of_project(workspace_id, project_id),
            ai_project_engines.c.engine_code == engine_code.value,
        )
    )


async def runnable_locations(
    db: AsyncSession, engine: Engine, location_ids: Collection[int]
) -> set[int]:
    """The active locations among these that the engine runs at (`Engine.runs_at`)."""
    rows = await db.execute(
        select(locations.c.id, locations.c.location_type).where(
            locations.c.id == any_(literal(list(location_ids), ARRAY(Integer))),
            locations.c.is_active,
        )
    )
    return {row.id for row in rows if engine.runs_at(row.location_type)}


async def enabled_countries(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> dict[EngineCode, set[str]]:
    """The countries each enabled engine of the project runs in."""
    rows = await db.execute(
        select(ai_project_engines.c.engine_code, locations.c.country_iso)
        .select_from(
            ai_project_engines.outerjoin(
                locations, locations.c.id == any_(ai_project_engines.c.location_ids)
            )
        )
        .where(_of_project(workspace_id, project_id), ai_project_engines.c.is_enabled)
    )
    found: defaultdict[EngineCode, set[str]] = defaultdict(set)
    for row in rows:
        countries = found[EngineCode(row.engine_code)]
        if row.country_iso is not None:
            countries.add(row.country_iso)
    return dict(found)


async def prompt_lengths(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[int]:
    """The length of each active prompt of the project."""
    # shortcut: reads one number per prompt; fine at the quota sizes, count in SQL past 10,000.
    rows = await db.execute(
        select(func.char_length(ai_prompt_versions.c.text))
        .select_from(
            ai_prompts.join(
                ai_prompt_versions,
                and_(
                    ai_prompt_versions.c.id == ai_prompts.c.current_version_id,
                    ai_prompt_versions.c.workspace_id == ai_prompts.c.workspace_id,
                ),
            )
        )
        .where(
            ai_prompts.c.workspace_id == workspace_id,
            ai_prompts.c.project_id == project_id,
            ai_prompts.c.is_active,
            ai_prompts.c.deleted_at.is_(None),
        )
    )
    return [int(length) for length in rows.scalars()]
