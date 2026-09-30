"""One log line per request: method, route template, status and duration.

Replaces the server's own access log, which prints raw URLs (docs/25-observability.md section 3).
"""

from __future__ import annotations

import time
from typing import Any

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from sightline.api.routing import route_template

_log = structlog.get_logger(__name__)


class AccessLogMiddleware:
    """Pure ASGI middleware. Successful requests to `quiet_paths` (health probes) log at debug."""

    def __init__(self, app: ASGIApp, quiet_paths: frozenset[str] = frozenset()) -> None:
        self.app = app
        self.quiet_paths = quiet_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        # A handler that raises before it responds never sends a status; the server answers 500.
        status_code = 500
        response_started = False
        aborted = False

        async def send_capturing_status(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_capturing_status)
        except BaseException:
            # The status was already sent, so the client saw it and then a broken stream.
            aborted = response_started
            raise
        finally:
            route = route_template(scope)
            fields: dict[str, Any] = {
                "method": scope["method"],
                "route": route,
                "status_code": status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            }
            if aborted:
                fields["aborted"] = True
            # Set by the session dependency, whose own log context has ended by now.
            user_id = scope.get("state", {}).get("user_id")
            if isinstance(user_id, str):
                fields["user_id"] = user_id
            quiet = route in self.quiet_paths and status_code < 400 and not aborted
            (_log.debug if quiet else _log.info)("request finished", **fields)
