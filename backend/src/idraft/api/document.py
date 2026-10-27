"""The OpenAPI document over HTTP, for signed-in users only (docs/19 section 1.1).

The same document is committed in backend/openapi/v1.json, which is what the web client is
generated from. Serving it lets a developer check a running instance against that file.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from idraft.api.auth.dependencies import CurrentSession

router = APIRouter()


@router.get("/api/v1/openapi.json", include_in_schema=False)
async def openapi_document(request: Request, _: CurrentSession) -> JSONResponse:
    # The description of a private API: no shared cache may keep it.
    return JSONResponse(request.app.openapi(), headers={"Cache-Control": "no-store"})
