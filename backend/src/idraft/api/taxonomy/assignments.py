"""Term assignments (docs/19-api-specification.md section 3.5): terms given to, taken from, or
replaced on a project's tracked keywords or prompts.

The membership dependency has already refused a project outside the caller's scope. A prompt
assignment also needs `prompts:write`, which the prompt service checks.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from idraft.api.ai.prompt_routes import Prompts
from idraft.api.keywords.routes import Keywords
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.schemas.keywords import (
    TermAssignment,
    TermAssignmentResponse,
    TermAssignmentResult,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["taxonomy"]
)

WriteKeywords = Annotated[WorkspaceAccess, Depends(require_permission(Permission.KEYWORDS_WRITE))]


@router.post(
    "/term-assignments",
    summary="Add, remove or replace terms of tracked keywords or prompts",
    description="Exactly one of `subject_ids` (up to 5,000) and `subject_filter` (the list's "
    "filters; `422 too_many_subjects` over 20,000 matches). `add` with a term of a "
    "single-valued vocabulary replaces the subject's other term of it; `replace` makes the "
    "given terms the subject's only ones within their vocabularies, and other vocabularies are "
    "kept. Two terms of one single-valued vocabulary are `422 validation_failed` with "
    "`single_valued_vocabulary`. `subject_type: 'prompt'` also needs `prompts:write` (`403` "
    "without it) and takes `subject_ids` only: a `subject_filter` is `422 validation_failed` "
    "with `filter_not_supported` (to choose prompts by filter, use bulk-update). Ids that are "
    "not live prompts of the project are not matched and are no error.",
)
async def assign_terms(
    project_id: UUID,
    body: TermAssignment,
    access: WriteKeywords,
    keywords: Keywords,
    prompts: Prompts,
    info: Info,
) -> TermAssignmentResponse:
    if body.subject_type == "prompt":
        matched, added, removed = await prompts.assign_terms(access, project_id, body, info)
    else:
        outcome = await keywords.assign_terms(access, project_id, body, info)
        matched, added, removed = outcome.matched, outcome.added, outcome.removed
    return TermAssignmentResponse(
        data=TermAssignmentResult(
            subjects_matched=matched, assignments_added=added, assignments_removed=removed
        )
    )
