"""One log line per request: method, route template, status and duration.

Replaces the server's own access log, which prints raw URLs (docs/25-observability.md section 3).
"""

from __future__ import annotations

import time

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from sightline.api.routing import route_template

_log = structlog.get_logger(__name__)


class AccessLogMiddleware:
    """Pure ASGI middleware. Routes in `quiet_paths` (health probes) are logged at debug level."""

    def __init__(self, app: ASGIApp, quiet_paths: frozenset[str] = frozenset()) -> None:
        self.app = app
        self.quiet_paths = quiet_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        # A handler that raises never sends a response start; the server answers 500 for it.
        status_code = 500

        async def send_capturing_status(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_capturing_status)
        finally:
            route = route_template(scope)
            log = _log.debug if route in self.quiet_paths else _log.info
            log(
                "request finished",
                method=scope["method"],
                route=route,
                status_code=status_code,
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
            )
