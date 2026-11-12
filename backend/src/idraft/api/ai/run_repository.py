"""What Run now reads (docs/19 section 3.7.5): the prompt and its current version, the engines
the project has turned on, what of the prompt is already on its way, and the workspace's monthly
limit of AI answers."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.ai_prompt import SUBJECT_TYPE, UNSETTLED
from idraft.db.tables import (
    ai_engines,
    ai_project_engines,
    ai_prompt_versions,
    ai_prompts,
    collection_runs,
    collection_tasks,
    workspace_quotas,
)
from idraft.domain.ai_engines import EngineCode

AI_PROMPT: Final = "ai_prompt"


@dataclass(frozen=True, slots=True)
class RunnablePrompt:
    prompt_id: UUID
    version_id: UUID
    text_length: int


async def runnable_prompts(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_ids: Sequence[UUID]
) -> dict[UUID, RunnablePrompt]:
    """The prompts among these that the project collects (not deleted, active), each with its
    current version."""
    if not prompt_ids:
        return {}
    p, v = ai_prompts.c, ai_prompt_versions.c
    rows = await db.execute(
        select(p.id, v.id.label("version_id"), func.char_length(v.text).label("length"))
        .select_from(
            ai_prompts.join(
                ai_prompt_versions,
                and_(v.id == p.current_version_id, v.workspace_id == p.workspace_id),
            )
        )
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.id.in_(list(prompt_ids)),
            p.deleted_at.is_(None),
            p.is_active,
        )
    )
    return {
        row.id: RunnablePrompt(prompt_id=row.id, version_id=row.version_id, text_length=row.length)
        for row in rows
    }


async def runnable_prompt(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_id: UUID
) -> RunnablePrompt | None:
    """The prompt with its current version, when the project collects it: not deleted, active."""
    return (await runnable_prompts(db, workspace_id, project_id, [prompt_id])).get(prompt_id)


async def askable_engines(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[str]:
    """The engines the AI workload asks for the project: turned on, active in the catalogue and
    of slice 1 (the planner's own rule, `collectors.ai_prompt._engines`)."""
    e, g = ai_project_engines.c, ai_engines.c
    rows = await db.execute(
        select(e.engine_code)
        .join(ai_engines, g.code == e.engine_code)
        .where(
            e.workspace_id == workspace_id,
            e.project_id == project_id,
            e.is_enabled,
            g.is_active,
            e.engine_code.in_([str(code) for code in EngineCode]),
        )
    )
    return sorted(row.engine_code for row in rows)


async def pending_pairs(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompts: Sequence[RunnablePrompt],
    engine_codes: Sequence[str],
) -> set[tuple[UUID, str]]:
    """The (prompt, engine) pairs among these with an answer already on its way: a task of the
    prompt's current version not yet read, or a planned run that names the prompt (on the
    engines it names, or every engine when it names none). Two statements for any number of
    prompts; a project has few planned runs (the worker plans a run within a minute)."""
    if not prompts or not engine_codes:
        return set()
    t, r = collection_tasks.c, collection_runs.c
    by_version = {str(prompt.version_id): prompt.prompt_id for prompt in prompts}
    found = {
        (by_version[row.subject_id], row.engine_code)
        for row in await db.execute(
            select(t.subject_id, t.engine_code)
            .distinct()
            .where(
                t.workspace_id == workspace_id,
                t.project_id == project_id,
                t.workload == AI_PROMPT,
                t.subject_type == SUBJECT_TYPE,
                t.subject_id.in_(sorted(by_version)),
                t.engine_code.in_(list(engine_codes)),
                t.status.in_(UNSETTLED),
            )
        )
    }
    by_prompt = {str(prompt.prompt_id): prompt.prompt_id for prompt in prompts}
    planned = await db.execute(
        select(r.config_snapshot).where(
            r.workspace_id == workspace_id,
            r.project_id == project_id,
            r.workload == AI_PROMPT,
            r.status == "planned",
        )
    )
    for row in planned:
        selector = (row.config_snapshot or {}).get("selector") or {}
        named = selector.get("engine_codes")
        for prompt_id in selector.get("prompt_ids") or []:
            if prompt_id in by_prompt:
                found.update(
                    (by_prompt[prompt_id], code)
                    for code in engine_codes
                    if named is None or code in named
                )
    return found


async def pending_engines(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    prompt: RunnablePrompt,
    engine_codes: Sequence[str],
) -> list[str]:
    """The engines among these the prompt already has an answer on its way from."""
    pairs = await pending_pairs(db, workspace_id, project_id, [prompt], engine_codes)
    return sorted(code for _, code in pairs)


async def lock_ai_observation_limit(db: AsyncSession, workspace_id: UUID) -> int:
    """The workspace's monthly limit of AI answers, its quota row locked until the transaction
    ends, so two requests count one after the other. A workspace without a row gets the
    defaults."""
    await db.execute(
        upsert(workspace_quotas).values(workspace_id=workspace_id).on_conflict_do_nothing()
    )
    limit: int = (
        await db.execute(
            select(workspace_quotas.c.max_ai_observations_per_month)
            .where(workspace_quotas.c.workspace_id == workspace_id)
            .with_for_update(key_share=True)
        )
    ).scalar_one()
    return limit


async def ai_tasks_since(db: AsyncSession, workspace_id: UUID, since: datetime) -> int:
    """AI answers the workspace has asked for since `since`, scheduled or by hand: the tasks
    that reached or will reach the provider, and the answers planned runs still ask for."""
    t, r = collection_tasks.c, collection_runs.c
    made = (
        select(func.count())
        .where(
            t.workspace_id == workspace_id,
            t.workload == AI_PROMPT,
            t.created_at >= since,
            t.status.not_in(("cancelled", "skipped_cached")),
        )
        .scalar_subquery()
    )
    selector = r.config_snapshot["selector"]
    asked = func.coalesce(func.jsonb_array_length(selector["prompt_ids"]), 0) * func.coalesce(
        func.jsonb_array_length(selector["engine_codes"]), 0
    )
    waiting = (
        select(func.coalesce(func.sum(asked), 0))
        .where(
            r.workspace_id == workspace_id,
            r.workload == AI_PROMPT,
            r.status == "planned",
            r.created_at >= since,
        )
        .scalar_subquery()
    )
    # One statement, so one snapshot: the planner turns a waiting run into tasks in one commit.
    total: int = (await db.execute(select(made + waiting))).scalar_one()
    return total
