"""The fixture's prompts, through `PromptService.bulk_create` (the route's path: the workspace's
prompt lock, the quota, the duplicate rule, the engines' countries, `is_branded` from the
project's aliases, one version each, audited).

The seed only creates what is missing; it never changes a prompt that exists. A prompt has no key
column. Its identity is the API's own: the composed text with its language and country
(`prompt_service.key_of`), archived prompts included, so the fixture's `p01` to `p72` are never
stored and a second run finds every prompt as a duplicate (`on_duplicate: skip`) and writes
nothing. A found prompt is read once, to report whether it is archived or differs from the fixture,
and is never written: a person's importance, topics or archive stay as they set them.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from idraft.ai.text import text_hash
from idraft.api.ai import prompt_repository as prompt_rows
from idraft.api.ai.prompt_repository import PromptKey, PromptRecord
from idraft.api.ai.prompt_service import PromptService
from idraft.api.schemas.ai import PromptBulkCreate, PromptCreate
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, SeedError, Sessions
from idraft.devseed.fixture import PromptPart


@dataclass(frozen=True, slots=True)
class PromptChanges:
    """`found` prompts were left untouched; of those, `archived` are archived and `differing` do
    not match the fixture in intent, funnel stage, type, importance, branded or topics."""

    created: int
    found: int
    archived: int
    differing: int


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
    """Stops the seed before its first write when the prompts it would make do not fit the
    workspace's active prompt quota. A found prompt, archived or not, is never made again, so it
    needs nothing. `bulk_create` checks again under the workspace's prompt lock, so a prompt added
    meanwhile cannot take it past the quota."""
    keys: list[PromptKey] = [(text_hash(part.text), language_code, part.country) for part in parts]
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        limit, used = await prompt_rows.quota_usage(db, access.workspace_id)
        found = (
            {}
            if project_id is None
            else await prompt_rows.existing(db, access.workspace_id, project_id, keys)
        )
    needed = len(keys) - len(found)
    if needed and used + needed > limit:
        raise SeedError(
            f"The workspace has {used} of {limit} active prompts and the fixture needs {needed} "
            "more. Nothing was written. Archive prompts in the app, or raise "
            "core.workspace_quotas.max_active_prompts for this workspace in the development "
            "database."
        )


def _differs(record: PromptRecord, part: PromptPart, item: PromptCreate) -> bool:
    return (
        record.intent != item.intent
        or record.funnel_stage != item.funnel_stage
        or record.prompt_type != item.prompt_type
        or record.importance != item.importance
        or record.is_branded != part.branded
        or {term.term_id for term in record.terms} != set(item.term_ids)
    )


async def ensure_prompts(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    language_code: str,
    parts: Sequence[PromptPart],
    term_ids: Mapping[str, UUID],
) -> PromptChanges:
    """The fixture's missing prompts made; the found ones are left as they are and reported. A
    rejected item stops the seed naming it; the accepted ones are saved by then, so running again
    finishes the rest."""
    items = prompt_items(language_code, parts, term_ids)
    outcome = await PromptService(sessions=sessions).bulk_create(
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
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        records = await prompt_rows.prompts_by_ids(
            db, access.workspace_id, project_id, [prompt_id for _, prompt_id in outcome.skipped]
        )
    by_id = {record.id: record for record in records}
    found = [(index, by_id[prompt_id]) for index, prompt_id in outcome.skipped]
    return PromptChanges(
        created=len(outcome.created),
        found=len(found),
        archived=sum(not record.is_active for _, record in found),
        differing=sum(_differs(record, parts[index], items[index]) for index, record in found),
    )
