"""Reads of the metric routes beyond the prompts summary's (contract C8): the summary and the
sources lane already read every count, so this holds what neither has. Row-level security keeps
every read in the caller's workspace; each query names the workspace and the project as well."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import ai_derivations, ai_prompts, taxonomy_terms


@dataclass(frozen=True, slots=True)
class PromptAttributes:
    """What a prompt is, apart from its answers: the dimensions of the breakdown. The market and
    the persona are the prompt's own and may be none."""

    intent: str
    funnel_stage: str
    prompt_type: str
    language_code: str
    country_iso: str | None
    persona_term_id: UUID | None
    persona_name: str | None


async def prompt_attributes(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_ids: Collection[UUID]
) -> dict[UUID, PromptAttributes]:
    """The attributes of these prompts of the project, in one statement (the persona's name is
    joined, so the count of statements does not depend on whether a prompt has one); a prompt of
    another project or workspace is never returned, whatever the ids. Nothing is read for no
    ids."""
    if not prompt_ids:
        return {}
    p, t = ai_prompts.c, taxonomy_terms.c
    rows = await db.execute(
        select(
            p.id,
            p.intent,
            p.funnel_stage,
            p.prompt_type,
            p.language_code,
            p.country_iso,
            p.persona_term_id,
            t.name.label("persona_name"),
        )
        .select_from(
            ai_prompts.outerjoin(
                taxonomy_terms,
                and_(t.id == p.persona_term_id, t.workspace_id == p.workspace_id),
            )
        )
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.id.in_(list(prompt_ids)),
        )
    )
    return {
        row.id: PromptAttributes(
            intent=row.intent,
            funnel_stage=row.funnel_stage,
            prompt_type=row.prompt_type,
            language_code=row.language_code,
            country_iso=row.country_iso,
            persona_term_id=row.persona_term_id,
            persona_name=row.persona_name,
        )
        for row in rows
    }


async def version_starts(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, versions: Collection[int]
) -> dict[int, datetime]:
    """When each entity configuration version was first used to derive an answer of the project:
    the earliest derivation under it (an answer is derived when it is ingested, so this is the
    moment the version took effect on the data)."""
    d = ai_derivations.c
    rows = await db.execute(
        select(d.entity_config_version, func.min(d.created_at).label("since"))
        .where(
            d.workspace_id == workspace_id,
            d.project_id == project_id,
            d.entity_config_version.in_(list(versions)),
        )
        .group_by(d.entity_config_version)
    )
    return {row.entity_config_version: row.since for row in rows}
