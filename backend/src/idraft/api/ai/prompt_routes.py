"""Prompts (docs/19-api-specification.md section 3.7.1, cut to slice 1; the "As built" note
there lists what is left out).

Reading needs `data:read`; adding, changing and archiving need `prompts:write`. The membership
dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response

from idraft.api.ai.prompt_repository import PromptFilter, PromptRecord
from idraft.api.ai.prompt_service import LintedPrompt, PromptService
from idraft.api.operations.run_routes import Runs, TriggerRuns, run_view
from idraft.api.pagination import Commas, Cursor, CursorPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai import (
    CountryIso,
    Importance,
    LintNearDuplicate,
    LintSpan,
    LintTracked,
    LintWarning,
    MatchedAlias,
    Prompt,
    PromptBulkCreate,
    PromptBulkResponse,
    PromptBulkResult,
    PromptCreate,
    PromptLint,
    PromptLintBody,
    PromptLintItems,
    PromptLintResponse,
    PromptPage,
    PromptPatch,
    PromptQuota,
    PromptRejected,
    PromptResponse,
    PromptSkipped,
    PromptSort,
    PromptType,
    RunNow,
)
from idraft.api.schemas.ai_bulk import (
    PromptBulkArchiveBody,
    PromptBulkArchiveByFilter,
    PromptBulkUpdate,
    PromptBulkUpdateResponse,
)
from idraft.api.schemas.common import LanguageCode, QueryText
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.keywords import (
    BulkArchiveResponse,
    BulkArchiveResult,
    FunnelStage,
    Intent,
)
from idraft.api.schemas.operations import RunResponse
from idraft.api.stubs import not_built, not_built_yet, refuse_unbuilt
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

_NOT_BUILT = "Not built yet: `501 not_implemented`."

IfMatch = Annotated[
    str | None,
    Header(
        alias="If-Match",
        max_length=128,
        description="The `ETag` of the prompt as read; a changed prompt is `412 "
        "precondition_failed`. " + _NOT_BUILT,
    ),
]


def _unbuilt_members(item: PromptCreate) -> dict[str, bool]:
    """The members of a create whose behaviour is not built yet (contract C1)."""
    return {
        "is_branded": item.is_branded is not None,
        "source": item.source is not None,
        "creation_method": item.creation_method is not None,
        "generated_from": item.generated_from is not None,
    }


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
    "bound to its filters (`400 invalid_cursor` otherwise). The type, funnel stage, importance "
    "and branded filters, `sort` and `filter[is_active]=any` are published and not built yet "
    "(`501`).",
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
    is_active: Annotated[
        bool | Literal["any"],
        Query(
            alias="filter[is_active]",
            description="`true` (default) or `false`; `any` lists both. `any`: " + _NOT_BUILT,
        ),
    ] = True,
    prompt_type_in: Annotated[
        list[PromptType] | None,
        Commas,
        Query(alias="filter[prompt_type_in]", description=_NOT_BUILT),
    ] = None,
    funnel_stage_in: Annotated[
        list[FunnelStage] | None,
        Commas,
        Query(alias="filter[funnel_stage_in]", description=_NOT_BUILT),
    ] = None,
    importance_in: Annotated[
        list[Importance] | None,
        Commas,
        Query(alias="filter[importance_in]", description=_NOT_BUILT),
    ] = None,
    is_branded: Annotated[
        bool | None, Query(alias="filter[is_branded]", description=_NOT_BUILT)
    ] = None,
    sort: Annotated[
        PromptSort | None,
        Query(
            description="A field, `-` first for descending; left out: newest first. " + _NOT_BUILT
        ),
    ] = None,
) -> PromptPage:
    if isinstance(is_active, str):
        raise not_built_yet("Not built yet: filter[is_active]=any.")
    refuse_unbuilt(
        {
            "filter[prompt_type_in]": bool(prompt_type_in),
            "filter[funnel_stage_in]": bool(funnel_stage_in),
            "filter[importance_in]": bool(importance_in),
            "filter[is_branded]": is_branded is not None,
            "sort": sort is not None,
        }
    )
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
    refuse_unbuilt(_unbuilt_members(body))
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
        tracked=None
        if item.tracked is None
        else LintTracked(prompt_id=item.tracked[0], is_active=item.tracked[1]),
        near_duplicate_of=None
        if item.near_duplicate_of is None
        else LintNearDuplicate(prompt_id=item.near_duplicate_of[0], text=item.near_duplicate_of[1]),
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
    for item in body.items:
        refuse_unbuilt(_unbuilt_members(item))
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
    "is too long to save). `quota` is the workspace's active prompt limit and use. With `items` "
    "(text, language and country) each result also says which prompt of the project it is "
    "(`tracked`, archived ones too) or, when none, the one that differs only in case and "
    "spacing (`near_duplicate_of`), and `quota.would_create` counts the items saving would "
    "create: not tracked, not a repeat of an earlier item, not too long to save. `language_code` "
    "is published and not built yet (`501`).",
)
async def lint_prompts(
    project_id: UUID, body: PromptLintBody, access: ReadData, prompts: Prompts
) -> PromptLintResponse:
    if not isinstance(body, PromptLintItems):
        refuse_unbuilt({"language_code": body.language_code is not None})
    outcome = await prompts.lint(access, project_id, body)
    return PromptLintResponse(
        data=[_lint_view(item) for item in outcome.prompts],
        quota=PromptQuota(
            limit=outcome.limit, used=outcome.used, would_create=outcome.would_create
        ),
    )


@router.post(
    "/bulk-archive",
    summary="Archive or bring back many prompts",
    description="Up to 1,000 `ids` of the project's prompts; an id it does not have is not "
    "matched. `archive: true` archives them as `DELETE` does one, `false` brings them back as "
    "`PATCH is_active: true` does; answers, versions and terms stay. Bringing back counts "
    "against the workspace's active prompt limit, all or none (`422 quota_exceeded` with "
    "`limit`, `used` and `requested`). `matched` is the prompts found, `updated` those whose "
    "state changed. One audit entry for the request and one per prompt changed. `filter` in "
    "place of `ids` is published and not built yet (`501`).",
)
async def bulk_archive_prompts(
    project_id: UUID,
    body: PromptBulkArchiveBody,
    access: WritePrompts,
    prompts: Prompts,
    info: Info,
) -> BulkArchiveResponse:
    if isinstance(body, PromptBulkArchiveByFilter):
        raise not_built_yet("Not built yet: filter.")
    matched, updated = await prompts.bulk_archive(access, project_id, body, info)
    return BulkArchiveResponse(data=BulkArchiveResult(matched=matched, updated=updated))


@router.post(
    "/bulk-update",
    summary="Change the metadata of many prompts",
    description="Up to 1,000 `ids` of the project's prompts, or `filter` (the list's filters), "
    "exactly one. `set` changes intent, funnel stage, type, importance and the branded flag; "
    "`add_term_ids` and `remove_term_ids` add and remove terms. `matched` is the prompts found, "
    "`updated` those that changed. One transaction; one `prompt.bulk_changed` audit entry and "
    "one `prompt.updated` per prompt changed. Not built yet: `501 not_implemented`.",
)
@not_built
async def bulk_update_prompts(
    project_id: UUID, body: PromptBulkUpdate, access: WritePrompts
) -> PromptBulkUpdateResponse:
    raise not_built_yet()


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
    if_match: IfMatch = None,
) -> PromptResponse:
    refuse_unbuilt({"If-Match": if_match is not None})
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


@router.post(
    "/{prompt_id}/run-now",
    status_code=202,
    summary="Ask a prompt now (a manual run through the provider's standard queue)",
    description="The prompt, which the project collects (`404` otherwise), on each of "
    "`engine_codes` once, through the provider's standard queue, the path a schedule uses. The "
    "run is `planned` and the worker plans it within a minute; answers arrive within minutes. "
    "An engine the project has not turned on is `422 validation_failed` with "
    "`engine_not_enabled`, a prompt longer than an engine takes `prompt_too_long`. An answer "
    "already queued or under way is `409 check_pending` with its `engine_codes`. A budget used "
    "up blocks the run (`budget_blocked`). `429 manual_run_limit` after 20 manual runs in a day "
    "(UTC); `422 quota_exceeded` when the month's AI answers would pass the workspace's "
    "`max_ai_observations_per_month`; `503 provider_paused` while the provider is refusing "
    "every request.",
)
async def run_now(
    project_id: UUID,
    prompt_id: UUID,
    body: RunNow,
    access: TriggerRuns,
    runs: Runs,
    info: Info,
) -> RunResponse:
    record = await runs.ai_run_now(access, project_id, prompt_id, body, info)
    return RunResponse(data=run_view(record, access.workspace_id))
