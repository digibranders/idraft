"""The Origin check (docs/24-security.md section 2.1).

Web and API share one origin. `SameSite=Lax` already keeps the session cookie off cross-site
POSTs; this is the second layer, and it also covers the routes that need no session, so a page on
another site cannot sign a visitor in to an account of its choosing. There is no CORS: no
`Access-Control-*` header is ever sent, and a preflight is refused.
"""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from sightline.api.problems import OriginNotAllowedError, problem_response

API_PREFIX = "/api/"
_STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class OriginCheckMiddleware:
    """Pure ASGI middleware. Server-side callers (Next.js) must send `Origin: <APP_ORIGIN>` too."""

    def __init__(self, app: ASGIApp, *, app_origin: str) -> None:
        self.app = app
        self.app_origin = app_origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self._allowed(scope):
            await self.app(scope, receive, send)
            return
        response = problem_response(
            Request(scope),
            app_origin=self.app_origin,
            status=OriginNotAllowedError.status,
            code=OriginNotAllowedError.code,
            title=OriginNotAllowedError.title,
        )
        await response(scope, receive, send)

    def _allowed(self, scope: Scope) -> bool:
        if not scope["path"].startswith(API_PREFIX):
            return True
        method = scope["method"]
        if method == "OPTIONS":
            return False
        if method not in _STATE_CHANGING:
            return True
        # Exactly one Origin header, equal to ours byte for byte. Browsers send it in this form.
        return Headers(scope=scope).getlist("origin") == [self.app_origin]
