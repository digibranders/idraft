"""The first-party favicon route (request 22 of the AI visibility backend requests)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response

from idraft.api.favicons.service import FaviconService
from idraft.api.problems import NotFoundError
from idraft.api.resources import Resources, get_resources
from idraft.api.workspaces.dependencies import MemberAccess

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["workspaces"])

_FOUND = "private, max-age=604800"
_ABSENT = "private, max-age=21600"


def get_favicons(resources: Annotated[Resources, Depends(get_resources)]) -> FaviconService:
    return resources.favicons


@router.get(
    "/favicons/{registrable_domain}",
    summary="The icon of a site",
    description="A PNG between 32 and 128 px wide, found and kept by the server: the browser never "
    "contacts the site or a third party. `404 not_found` when the site has no icon of at least "
    "32 px (also kept, for 6 hours); `400` when the domain is not a public domain name; `429` "
    "past 60 icons a minute not yet kept, per workspace. Any workspace member may read it.",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "The icon."}},
)
async def get_favicon(
    access: MemberAccess,
    registrable_domain: Annotated[str, Path(max_length=253)],
    favicons: Annotated[FaviconService, Depends(get_favicons)],
) -> Response:
    png = await favicons.icon(registrable_domain, workspace_id=access.workspace_id)
    if png is None:
        raise NotFoundError(headers={"Cache-Control": _ABSENT})
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": _FOUND, "X-Content-Type-Options": "nosniff"},
    )
