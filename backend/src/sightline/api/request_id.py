"""Request ids: `req_` plus a UUIDv7 in Crockford base32, so ids sort by creation order.

The API is the authority for the format. An inbound `X-Request-Id` is kept only when it is one of
ours (the web server forwards the id it minted for a page render); anything else is replaced.
Python 3.13 has no uuid7 in the standard library, so the value is built per RFC 9562 section 5.7,
with the monotonic counter of section 6.2 (method 2) for ids minted within one millisecond.
"""

from __future__ import annotations

import os
import threading
import time

import sentry_sdk
import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER = "X-Request-Id"
PREFIX = "req_"
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_VALUES = {character: index for index, character in enumerate(_CROCKFORD)}
_ENCODED_LENGTH = 26
_RANDOM_BITS = 74  # 12 bits after the version nibble and 62 after the variant bits
_lock = threading.Lock()
_last_millisecond = 0
_last_random = 0


def _next_parts() -> tuple[int, int]:
    """(unix milliseconds, 74 random bits), never smaller than the previous pair."""
    global _last_millisecond, _last_random
    with _lock:
        millisecond = time.time_ns() // 1_000_000
        if millisecond > _last_millisecond:
            _last_millisecond = millisecond
            # The top bit starts clear so the counter has room to grow within the millisecond.
            _last_random = int.from_bytes(os.urandom(10), "big") >> (80 - _RANDOM_BITS + 1)
        else:
            _last_random += 1
        return _last_millisecond, _last_random


def _uuid7() -> int:
    millisecond, random = _next_parts()
    high, low = random >> 62, random & ((1 << 62) - 1)
    return (millisecond << 80) | (0x7 << 76) | (high << 64) | (0b10 << 62) | low


def new_request_id() -> str:
    number = _uuid7()
    return PREFIX + "".join(_CROCKFORD[(number >> shift) & 31] for shift in range(125, -1, -5))


def is_request_id(value: str) -> bool:
    """Whether `value` is `req_` plus a 128-bit UUIDv7 in upper-case Crockford base32."""
    encoded = value.removeprefix(PREFIX)
    if len(value) != len(PREFIX) + _ENCODED_LENGTH or len(encoded) != _ENCODED_LENGTH:
        return False
    number = 0
    for character in encoded:
        digit = _VALUES.get(character)
        if digit is None:
            return False
        number = number * 32 + digit
    return number < 1 << 128 and (number >> 76) & 0xF == 0x7 and (number >> 62) & 0b11 == 0b10


class RequestIdMiddleware:
    """Pure ASGI middleware: binds the id to the log context and returns it in a header."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inbound = Headers(scope=scope).get(HEADER, "")
        request_id = inbound if is_request_id(inbound) else new_request_id()
        scope.setdefault("state", {})["request_id"] = request_id
        sentry_sdk.set_tag("request_id", request_id)
        tokens = structlog.contextvars.bind_contextvars(request_id=request_id)

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            structlog.contextvars.reset_contextvars(**tokens)
