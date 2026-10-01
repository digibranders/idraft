"""Term assignments (docs/19-api-specification.md section 3.5): terms given to, taken from, or
replaced on a project's tracked keywords. Prompts arrive with their own step.

The membership dependency has already refused a project outside the caller's scope.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from sightline.api.keywords.routes import Keywords
from sightline.api.permissions import Permission
from sightline.api.request_info import Info
from sightline.api.schemas.keywords import (
    TermAssignment,
    TermAssignmentResponse,
    TermAssignmentResult,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.api.workspaces.dependencies import require_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}", tags=["taxonomy"]
)

WriteKeywords = Annotated[WorkspaceAccess, Depends(require_permission(Permission.KEYWORDS_WRITE))]


@router.post(
    "/term-assignments",
    summary="Add, remove or replace terms of tracked keywords",
    description="Exactly one of `subject_ids` (up to 5,000) and `subject_filter` (the list's "
    "filters; `422 too_many_subjects` over 20,000 matches). `add` with a term of a "
    "single-valued vocabulary replaces the keyword's other term of it; `replace` makes the "
    "given terms the keyword's only ones within their vocabularies, and other vocabularies are "
    "kept. Two terms of one single-valued vocabulary are `422 validation_failed` with "
    "`single_valued_vocabulary`; `subject_type: 'prompt'` is `subject_type_not_supported` until "
    "prompts exist.",
)
async def assign_terms(
    project_id: UUID,
    body: TermAssignment,
    access: WriteKeywords,
    keywords: Keywords,
    info: Info,
) -> TermAssignmentResponse:
    outcome = await keywords.assign_terms(access, project_id, body, info)
    return TermAssignmentResponse(
        data=TermAssignmentResult(
            subjects_matched=outcome.matched,
            assignments_added=outcome.added,
            assignments_removed=outcome.removed,
        )
    )
