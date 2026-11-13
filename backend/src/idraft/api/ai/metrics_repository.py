"""Reads of the metric routes beyond the prompts summary's (contract C8): the summary and the
sources lane already read every count, so this holds what neither has. Row-level security keeps
every read in the caller's workspace; each query names the workspace and the project as well."""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import ai_derivations


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
