"""The request body limit (docs/19-api-specification.md section 2.7): 1 MB for a JSON body.

A body announced as larger is refused before it is read. A body sent without a length (chunked)
is counted as it arrives, and reading stops at the limit, so no route parses more than 1 MB.
"""

from __future__ import annotations

from typing import Final

from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from sightline.api.csrf import API_PREFIX
from sightline.api.problems import PayloadTooLargeError, problem_response

JSON_BODY_MAX_BYTES: Final = 1024 * 1024
_DETAIL = "A request body is at most 1 MB."


class BodyLimitMiddleware:
    """Pure ASGI middleware for the API's paths."""

    def __init__(self, app: ASGIApp, *, app_origin: str, max_bytes: int = JSON_BODY_MAX_BYTES):
        self.app = app
        self.app_origin = app_origin
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(API_PREFIX):
            await self.app(scope, receive, send)
            return
        announced = Headers(scope=scope).get("content-length")
        if announced is not None and announced.isdigit() and int(announced) > self.max_bytes:
            response = problem_response(
                Request(scope),
                app_origin=self.app_origin,
                status=PayloadTooLargeError.status,
                code=PayloadTooLargeError.code,
                title=PayloadTooLargeError.title,
                detail=_DETAIL,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, self._counted(receive), send)

    def _counted(self, receive: Receive) -> Receive:
        received = 0

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # FastAPI passes an HTTPException raised while reading the body through to
                    # the problem handlers, which answer `413 payload_too_large`.
                    raise HTTPException(status_code=PayloadTooLargeError.status, detail=_DETAIL)
            return message

        return counted
