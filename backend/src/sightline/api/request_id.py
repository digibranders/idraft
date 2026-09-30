"""Request ids: `req_` plus a UUIDv7 in Crockford base32, so ids sort by time.

Python 3.13 has no uuid7 in the standard library; the 16 bytes are built per RFC 9562 section 5.7.
"""

from __future__ import annotations

import os
import re
import time

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
REQUEST_ID_PATTERN = re.compile(r"req_[0-9A-HJKMNP-TV-Z]{26}")
HEADER = "X-Request-Id"


def _uuid7_bytes() -> bytes:
    raw = bytearray((time.time_ns() // 1_000_000).to_bytes(6, "big") + os.urandom(10))
    raw[6] = (raw[6] & 0x0F) | 0x70  # version 7
    raw[8] = (raw[8] & 0x3F) | 0x80  # RFC 9562 variant
    return bytes(raw)


def new_request_id() -> str:
    number = int.from_bytes(_uuid7_bytes(), "big")
    return "req_" + "".join(_CROCKFORD[(number >> shift) & 31] for shift in range(125, -1, -5))


class RequestIdMiddleware:
    """Pure ASGI middleware: binds the id to the log context and returns it in a header."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inbound = Headers(scope=scope).get(HEADER, "")
        request_id = inbound if REQUEST_ID_PATTERN.fullmatch(inbound) else new_request_id()
        scope.setdefault("state", {})["request_id"] = request_id
        tokens = structlog.contextvars.bind_contextvars(request_id=request_id)

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            structlog.contextvars.reset_contextvars(**tokens)
