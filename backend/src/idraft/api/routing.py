"""Small helpers shared by the middleware and the error handlers."""

from __future__ import annotations

from starlette.types import Scope

UNMATCHED = "unmatched"


def route_template(scope: Scope) -> str:
    """The matched route's template (`/things/{thing_id}`), so logs never carry ids or queries."""
    template = getattr(scope.get("route"), "path", None)
    return template if isinstance(template, str) else UNMATCHED
