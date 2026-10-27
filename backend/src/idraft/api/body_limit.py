"""The request body limit (docs/19-api-specification.md section 2.7): 1 MB for a JSON body, and
50 MB for the one route that takes a file, the keyword import upload.

A body announced as larger is refused before it is read. A body sent without a length (chunked)
is counted as it arrives, and reading stops at the limit, so no route parses more than its limit.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from idraft.api.csrf import API_PREFIX
from idraft.api.problems import PayloadTooLargeError, problem_response

JSON_BODY_MAX_BYTES: Final = 1024 * 1024
UPLOAD_MAX_BYTES: Final = 50 * 1024 * 1024
_DETAIL = "A request body is at most 1 MB."
_UPLOAD_DETAIL = "An upload is at most 50 MB."


@dataclass(frozen=True, slots=True)
class Limit:
    """What a request body may weigh, and what to say when it weighs more."""

    max_bytes: int
    detail: str


@dataclass(frozen=True, slots=True)
class LargerLimit:
    """A route that takes more than a JSON body does."""

    path: re.Pattern[str]
    limit: Limit
    # The method that takes the file: another method on the same path is a JSON request, and
    # has the JSON limit.
    method: str = "POST"


# Only the keyword import upload takes a file (docs/19 section 3.6.3). The body of the request
# holds the file and the multipart framing around it and the options part.
UPLOAD_PATH: Final = re.compile(r"/api/v1/workspaces/[^/]+/projects/[^/]+/keyword-imports/upload")
UPLOAD_FRAMING_BYTES: Final = 1024 * 1024
UPLOADS: Final = (
    LargerLimit(UPLOAD_PATH, Limit(UPLOAD_MAX_BYTES + UPLOAD_FRAMING_BYTES, _UPLOAD_DETAIL)),
)


class BodyLimitMiddleware:
    """Pure ASGI middleware for the API's paths."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        app_origin: str,
        max_bytes: int = JSON_BODY_MAX_BYTES,
        larger: Sequence[LargerLimit] = (),
    ):
        self.app = app
        self.app_origin = app_origin
        self.limit = Limit(max_bytes, _DETAIL)
        self.larger = tuple(larger)

    def _limit_for(self, method: str, path: str) -> Limit:
        for route in self.larger:
            if method == route.method and route.path.fullmatch(path):
                return route.limit
        return self.limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(API_PREFIX):
            await self.app(scope, receive, send)
            return
        limit = self._limit_for(scope["method"], scope["path"])
        announced = Headers(scope=scope).get("content-length")
        if announced is not None and announced.isdigit() and int(announced) > limit.max_bytes:
            response = problem_response(
                Request(scope),
                app_origin=self.app_origin,
                status=PayloadTooLargeError.status,
                code=PayloadTooLargeError.code,
                title=PayloadTooLargeError.title,
                detail=limit.detail,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, self._counted(receive, limit), send)

    @staticmethod
    def _counted(receive: Receive, limit: Limit) -> Receive:
        received = 0

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit.max_bytes:
                    # FastAPI passes an HTTPException raised while reading the body through to
                    # the problem handlers, which answer `413 payload_too_large`.
                    raise HTTPException(
                        status_code=PayloadTooLargeError.status, detail=limit.detail
                    )
            return message

        return counted
