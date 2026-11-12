"""The fixture's prompts, through `PromptService.bulk_create` (the route's path: the workspace's
prompt lock, the quota, the duplicate rule, the engines' countries, `is_branded` from the
project's aliases, one version each, audited) and `PromptService.update` for one that drifted.

A prompt has no key column. Its identity is the API's own: the composed text with its language
and country (`prompt_service.key_of`), so the fixture's `p01` to `p72` are never stored, and a
second run finds every prompt as a duplicate (`on_duplicate: skip`) and makes nothing.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select

from idraft.ai.text import text_hash
from idraft.api.ai import prompt_repository as prompt_rows
from idraft.api.ai.prompt_repository import PromptKey, PromptRecord
from idraft.api.ai.prompt_service import PromptService
from idraft.api.schemas.ai import PromptBulkCreate, PromptCreate, PromptPatch
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import ai_prompts
from idraft.devseed.context import SEED_INFO, SeedError, Sessions
from idraft.devseed.fixture import PromptPart


@dataclass(frozen=True, slots=True)
class PromptChanges:
    created: int
    updated: int
    unchanged: int


def prompt_items(
    language_code: str, parts: Sequence[PromptPart], term_ids: Mapping[str, UUID]
) -> list[PromptCreate]:
    return [
        PromptCreate(
            text=part.text,
            language_code=language_code,
            country_iso=part.country,
            intent=part.intent,
            funnel_stage=part.funnel_stage,
            prompt_type=part.prompt_type,
            importance=part.importance,
            term_ids=sorted({term_ids[slug] for slug in part.topics}),
        )
        for part in parts
    ]


async def prompt_quota(sessions: Sessions, access: WorkspaceAccess) -> tuple[int, int]:
    """The workspace's active prompt limit and its active prompts."""
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        return await prompt_rows.quota_usage(db, access.workspace_id)


async def check_prompt_quota(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID | None,
    language_code: str,
    parts: Sequence[PromptPart],
) -> None:
    """Stops the seed before its first write when the prompts it would make, or bring back from
    the archive, do not fit the workspace's active prompt quota. `bulk_create` checks again under
    the workspace's prompt lock, so a prompt added meanwhile cannot take it past the quota."""
    keys: list[PromptKey] = [(text_hash(part.text), language_code, part.country) for part in parts]
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        limit, used = await prompt_rows.quota_usage(db, access.workspace_id)
        found = (
            {}
            if project_id is None
            else await prompt_rows.existing(db, access.workspace_id, project_id, keys)
        )
        archived = 0
        if found:
            archived = (
                await db.execute(
                    select(func.count())
                    .select_from(ai_prompts)
                    .where(
                        ai_prompts.c.workspace_id == access.workspace_id,
                        ai_prompts.c.id.in_(sorted(found.values())),
                        ai_prompts.c.is_active.is_(False),
                    )
                )
            ).scalar_one()
    needed = len(keys) - len(found) + archived
    if needed and used + needed > limit:
        raise SeedError(
            f"The workspace has {used} of {limit} active prompts and the fixture needs {needed} "
            "more. Nothing was written. Archive prompts in the app, or raise "
            "core.workspace_quotas.max_active_prompts for this workspace in the development "
            "database."
        )


def _differences(record: PromptRecord, item: PromptCreate) -> dict[str, object]:
    """What `PATCH` would set to bring a found prompt in line with the fixture."""
    wanted: dict[str, object] = {
        "intent": item.intent,
        "funnel_stage": item.funnel_stage,
        "prompt_type": item.prompt_type,
        "importance": item.importance,
    }
    changes = {name: value for name, value in wanted.items() if getattr(record, name) != value}
    if {term.term_id for term in record.terms} != set(item.term_ids):
        changes["term_ids"] = list(item.term_ids)
    if not record.is_active:
        changes["is_active"] = True
    return changes


async def ensure_prompts(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    language_code: str,
    parts: Sequence[PromptPart],
    term_ids: Mapping[str, UUID],
) -> PromptChanges:
    """The fixture's prompts made, and the found ones brought in line. A rejected item stops the
    seed naming it; the accepted ones are saved by then, so running again finishes the rest."""
    items = prompt_items(language_code, parts, term_ids)
    service = PromptService(sessions=sessions)
    outcome = await service.bulk_create(
        access, project_id, PromptBulkCreate(items=items, on_duplicate="skip"), SEED_INFO
    )
    if outcome.rejected:
        refused = "; ".join(
            f"{parts[rejected.index].key} {rejected.code}: {rejected.message}"
            for rejected in outcome.rejected
        )
        raise SeedError(
            f"Prompts were refused: {refused}. {len(outcome.created)} others were saved; fix the "
            "cause and run the seed again."
        )
    updated = 0
    for index, prompt_id in outcome.skipped:
        record = await service.get(access, project_id, prompt_id)
        changes = _differences(record, items[index])
        if changes:
            await service.update(
                access, project_id, prompt_id, PromptPatch.model_validate(changes), SEED_INFO
            )
            updated += 1
    return PromptChanges(
        created=len(outcome.created),
        updated=updated,
        unchanged=len(outcome.skipped) - updated,
    )
