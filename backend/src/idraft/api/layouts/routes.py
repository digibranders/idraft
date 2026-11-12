"""Team default and personal page layouts (contract C12a, docs/19 section 3.11.5c). A layout
belongs to the workspace and is the same in every project. Personal layouts need membership
only; the team default needs `layouts:manage` (owner, admin; D-11). Presets are code in the web
app (D-01), so there is no preset route."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Response

from idraft.api.layouts.service import LayoutService, Resolved
from idraft.api.permissions import Permission
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_layouts import LayoutDocument, ResolvedLayoutResponse
from idraft.api.stubs import not_built, not_built_yet
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import MemberAccess, require_permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["layouts"])

ManageLayouts = Annotated[WorkspaceAccess, Depends(require_permission(Permission.LAYOUTS_MANAGE))]
Screen = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z_]+(\.[a-z_]+)?$",
        description="A screen key (layout spec section 4); an unknown one is `404`.",
    ),
]
IfMatch = Annotated[
    str | None,
    Header(
        alias="If-Match",
        max_length=128,
        description="The `ETag` of the layout as read; required when one exists, `412 "
        "precondition_failed` when it changed.",
    ),
]
_NOT_BUILT = " Not built yet: `501 not_implemented`."


def get_layout_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> LayoutService:
    """Stateless: built per request from the session factory (plan decision L17)."""
    return LayoutService(sessions=resources.sessions)


Layouts = Annotated[LayoutService, Depends(get_layout_service)]


def answer(found: Resolved, response: Response) -> ResolvedLayoutResponse:
    response.headers["ETag"] = found.etag
    return ResolvedLayoutResponse(data=found.layout)


@router.get(
    "/layouts/{screen}",
    summary="The layout a member sees on a screen",
    description="Their personal layout, else the team default, else `source: builtin` with a "
    "null document. The `ETag` covers the caller's personal layout and the team default of the "
    "screen; send it as `If-Match` to save. An unknown screen is `404`.",
)
async def get_layout(
    screen: Screen, access: MemberAccess, layouts: Layouts, response: Response
) -> ResolvedLayoutResponse:
    return answer(await layouts.resolve(access, screen), response)


@router.put(
    "/me/layouts/{screen}",
    summary="Save the caller's own layout of a screen",
    description="Card types and metric keys of the catalog for the screen, allowed widths, at "
    "most 12 cards and 6 numbers, at most 16 KB (`422 validation_failed` with field paths)."
    + _NOT_BUILT,
)
@not_built
async def put_personal_layout(
    screen: Screen, body: LayoutDocument, access: MemberAccess, if_match: IfMatch = None
) -> ResolvedLayoutResponse:
    raise not_built_yet()


@router.delete(
    "/me/layouts/{screen}",
    status_code=204,
    summary="Go back to the team or built-in default",
    description=_NOT_BUILT.strip(),
)
@not_built
async def delete_personal_layout(screen: Screen, access: MemberAccess) -> Response:
    raise not_built_yet()


@router.put(
    "/layouts/{screen}/default",
    summary="Save the team default of a screen",
    description="As the personal layout; audited as `layout.default.set` with the documents "
    "before and after." + _NOT_BUILT,
)
@not_built
async def put_team_layout(
    screen: Screen, body: LayoutDocument, access: ManageLayouts, if_match: IfMatch = None
) -> ResolvedLayoutResponse:
    raise not_built_yet()


@router.delete(
    "/layouts/{screen}/default",
    status_code=204,
    summary="Remove the team default of a screen",
    description="Audited as `layout.default.remove`." + _NOT_BUILT,
)
@not_built
async def delete_team_layout(screen: Screen, access: ManageLayouts) -> Response:
    raise not_built_yet()
