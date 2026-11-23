"""The client summary behind a shared link (plan 06 Task 5, decision D15). No sign-in, no cookie:
the token in the path is the whole credential. An unknown, expired or revoked link all answer
the same `404 not_found`."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response

from idraft.api.access import public
from idraft.api.internal_links.public_summary import PublicSummaryService
from idraft.api.problems import NotFoundError
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.internal_links_summary import ClientSummaryResponse

router = APIRouter(
    prefix="/api/v1/public/internal-links", tags=["public"], dependencies=[Depends(public)]
)


def get_public_summary(
    resources: Annotated[Resources, Depends(get_resources)],
) -> PublicSummaryService:
    return resources.public_summary


@router.get(
    "/summary/{token}",
    summary="The client summary of a shared link",
    description="Read only, no sign-in. 30 requests a minute per address and 120 an hour per "
    "link; past either, `429 rate_limited`. The answer is never cached.",
    response_model=ClientSummaryResponse,
)
async def public_summary(
    token: Annotated[str, Path(max_length=200)],
    service: Annotated[PublicSummaryService, Depends(get_public_summary)],
    info: Info,
    response: Response,
) -> ClientSummaryResponse:
    summary = await service.read(token, ip=info.throttle_ip)
    if summary is None:
        raise NotFoundError
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return ClientSummaryResponse(data=summary)
