"""Prompts (docs/19-api-specification.md section 3.7.1, cut to slice 1; the "As built" note
there lists what is left out).

Reading needs `data:read`; adding, changing and archiving need `prompts:write`. The membership
dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from idraft.api.ai.prompt_repository import PromptFilter, PromptRecord
from idraft.api.ai.prompt_service import LintedPrompt, PromptService
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import (
    CountryIso,
    LintSpan,
    LintWarning,
    MatchedAlias,
    Prompt,
    PromptBulkCreate,
    PromptBulkResponse,
    PromptBulkResult,
    PromptCreate,
    PromptLint,
    PromptLintRequest,
    PromptLintResponse,
    PromptPage,
    PromptPatch,
    PromptQuota,
    PromptRejected,
    PromptResponse,
    PromptSkipped,
)
from idraft.api.schemas.common import LanguageCode, QueryText
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.keywords import Intent
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts", tags=["ai"]
)

ReadData = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]
WritePrompts = Annotated[WorkspaceAccess, Depends(require_permission(Permission.PROMPTS_WRITE))]


def get_prompt_service(resources: Annotated[Resources, Depends(get_resources)]) -> PromptService:
    return resources.prompts


Prompts = Annotated[PromptService, Depends(get_prompt_service)]


def prompt_view(record: PromptRecord) -> Prompt:
    version = record.current_version
    return Prompt.model_validate(
        {
            "prompt_id": record.id,
            "current_version": {
                "prompt_version_id": version.id,
                "version_no": version.version_no,
                "text": version.text,
                "text_hash": version.text_hash.hex(),
                "change_kind": version.change_kind,
                "created_at": version.created_at,
            },
            "language_code": record.language_code,
            "country_iso": record.country_iso,
            "intent": record.intent,
            "funnel_stage": record.funnel_stage,
            "prompt_type": record.prompt_type,
            "importance": record.importance,
            "is_branded": record.is_branded,
            "source": record.source,
            "creation_method": record.creation_method,
            "is_active": record.is_active,
            "terms": [
                {
                    "term_id": term.term_id,
                    "vocabulary_kind": term.vocabulary_kind,
                    "name": term.name,
                    "path": term.path,
                }
                for term in record.terms
            ],
            "created_by": None
            if record.created_by is None
            else {
                "user_id": record.created_by.user_id,
                "name": record.created_by.name,
                "email": record.created_by.email,
            },
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }
    )


@router.get(
    "",
    summary="The project's prompts",
    description="Newest first. `filter[is_active]` is true when left out; archived prompts are "
    "listed with false. `filter[term]` takes the term or one under it, `filter[q]` matches the "
    "text as a substring without case, and `filter[intent_in]` takes a comma list. A cursor is "
    "bound to its filters (`400 invalid_cursor` otherwise).",
)
async def list_prompts(
    project_id: UUID,
    access: ReadData,
    page: Cursor,
    prompts: Prompts,
    q: Annotated[QueryText | None, Query(alias="filter[q]")] = None,
    term: Annotated[UUID | None, Query(alias="filter[term]")] = None,
    intent_in: Annotated[list[Intent] | None, Commas, Query(alias="filter[intent_in]")] = None,
    country_iso: Annotated[CountryIso | None, Query(alias="filter[country_iso]")] = None,
    language_code: Annotated[LanguageCode | None, Query(alias="filter[language_code]")] = None,
    is_active: Annotated[bool, Query(alias="filter[is_active]")] = True,
) -> PromptPage:
    given = PromptFilter(
        q=q,
        term=term,
        intents=frozenset(intent_in or ()),
        country_iso=country_iso,
        language_code=language_code,
        is_active=is_active,
    )
    result = await prompts.page(access, project_id, given, cursor=page.cursor, limit=page.limit)
    return PromptPage(
        data=[prompt_view(record) for record in result.prompts],
        page=CursorPageInfo(
            limit=page.limit,
            next_cursor=result.next_cursor,
            has_more=result.next_cursor is not None,
        ),
    )


@router.post(
    "",
    status_code=201,
    summary="Add a prompt",
    description="`409 duplicate` (with `existing_id`) when the project has the same text in the "
    "same language and country, archived prompts included; `422 quota_exceeded` (with `limit`, "
    "`used` and `requested`) past the workspace's active prompt limit. Field codes: "
    "`prompt_too_long` (over 2,000 characters, the most any engine takes), "
    "`location_not_supported` (`country_iso` has no location of an enabled engine), "
    "`term_unknown` and `single_valued_vocabulary`. `is_branded` is computed from the project's "
    "own aliases.",
)
async def create_prompt(
    project_id: UUID, body: PromptCreate, access: WritePrompts, prompts: Prompts, info: Info
) -> PromptResponse:
    return PromptResponse(data=prompt_view(await prompts.create(access, project_id, body, info)))


def _lint_view(item: LintedPrompt) -> PromptLint:
    return PromptLint(
        text=item.text,
        is_branded=item.is_branded,
        matched_aliases=[
            MatchedAlias(
                entity=EntityRef.model_validate(
                    {
                        "entity_id": found.entity.id,
                        "canonical_name": found.entity.canonical_name,
                        "entity_type": found.entity.entity_type,
                        "role": found.entity.role,
                        "color_index": found.entity.color_index,
                    }
                ),
                alias=found.alias,
            )
            for found in item.aliases
        ],
        warnings=[
            LintWarning(
                rule=note.rule,
                severity=note.severity,
                message=note.message,
                engine_code=note.engine_code,
                span=None if note.span is None else LintSpan(start=note.span[0], end=note.span[1]),
            )
            for note in item.notes
        ],
    )


@router.post(
    "/bulk-create",
    summary="Add a list of prompts",
    description="Up to 1,000 items. An item that cannot be saved is rejected with its code "
    "(`location_not_supported`, `term_unknown`, `single_valued_vocabulary`, "
    "`duplicate_in_request` for the same prompt twice in the list, and `duplicate` with "
    "`on_duplicate: error`); with `skip`, a prompt the project has is listed in `skipped`. The "
    "rest are written together: `422 quota_exceeded` past the workspace's active prompt limit, "
    "and nothing is written. No Idempotency-Key: sending the list again skips what it added.",
)
async def bulk_create_prompts(
    project_id: UUID, body: PromptBulkCreate, access: WritePrompts, prompts: Prompts, info: Info
) -> PromptBulkResponse:
    outcome = await prompts.bulk_create(access, project_id, body, info)
    return PromptBulkResponse(
        data=PromptBulkResult(
            created=outcome.created,
            skipped=[
                PromptSkipped(index=index, existing_id=existing_id)
                for index, existing_id in outcome.skipped
            ],
            rejected=[
                PromptRejected(index=entry.index, code=entry.code, message=entry.message)
                for entry in outcome.rejected
            ],
        )
    )


@router.post(
    "/lint",
    summary="Check prompts before saving them",
    description="Nothing is stored. For each text, as it would be saved: whether it names an own "
    "brand (`contains_brand_alias`, with the name's place in UTF-16 code units) and each engine "
    "it is too long for (`engine_limit`: a warning when the engine skips it, an error when it "
    "is too long to save). `quota` is the workspace's active prompt limit and use.",
)
async def lint_prompts(
    project_id: UUID, body: PromptLintRequest, access: ReadData, prompts: Prompts
) -> PromptLintResponse:
    outcome = await prompts.lint(access, project_id, body)
    return PromptLintResponse(
        data=[_lint_view(item) for item in outcome.prompts],
        quota=PromptQuota(limit=outcome.limit, used=outcome.used),
    )


@router.get("/{prompt_id}", summary="A prompt")
async def get_prompt(
    project_id: UUID, prompt_id: UUID, access: ReadData, prompts: Prompts
) -> PromptResponse:
    return PromptResponse(data=prompt_view(await prompts.get(access, project_id, prompt_id)))


@router.patch(
    "/{prompt_id}",
    summary="Change a prompt's metadata",
    description="The text, language and country cannot change (`422 validation_failed` with "
    "`immutable_field`): archive the prompt and add a new one. `term_ids` replaces the terms. "
    "`is_active: true` brings an archived prompt back and counts against the quota.",
)
async def update_prompt(
    project_id: UUID,
    prompt_id: UUID,
    body: PromptPatch,
    access: WritePrompts,
    prompts: Prompts,
    info: Info,
) -> PromptResponse:
    record = await prompts.update(access, project_id, prompt_id, body, info)
    return PromptResponse(data=prompt_view(record))


@router.delete(
    "/{prompt_id}",
    status_code=204,
    summary="Archive a prompt; its answers stay",
    description="The prompt is no longer asked. It keeps its row, versions and answers, and "
    "`PATCH is_active: true` brings it back.",
)
async def archive_prompt(
    project_id: UUID, prompt_id: UUID, access: WritePrompts, prompts: Prompts, info: Info
) -> Response:
    await prompts.archive(access, project_id, prompt_id, info)
    return Response(status_code=204)
