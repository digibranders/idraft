"""How a route says who may call it (docs/24-security.md section 3.2).

Every route depends on at least one marked dependency: `public`, a session dependency, the
workspace membership dependency, or a permission. tests/api/test_route_access.py walks the
application's routes and compares each route's rule with a table, so a route cannot ship without
a declaration and a declaration cannot change unnoticed.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Request
from fastapi.dependencies.models import Dependant
from fastapi.routing import RouteContext

from sightline.api.pagination import reject_unknown_query
from sightline.api.permissions import Permission

AccessKind = Literal["public", "authenticated", "member", "permission"]
_MARK = "__sightline_access__"
_STRICTNESS: dict[AccessKind, int] = {"public": 0, "authenticated": 1, "member": 2, "permission": 3}


@dataclass(frozen=True, slots=True)
class AccessRule:
    kind: AccessKind
    permission: Permission | None = None
    fresh: bool = False
    # For a member who is not limited to some of the workspace's projects.
    every_project: bool = False

    def __post_init__(self) -> None:
        if (self.kind == "permission") != (self.permission is not None):
            raise ValueError("a permission rule names its permission, and no other rule does")


def declare[F: Callable[..., Any]](rule: AccessRule) -> Callable[[F], F]:
    """Mark a dependency with the access it enforces."""

    def mark(dependency: F) -> F:
        setattr(dependency, _MARK, rule)
        return dependency

    return mark


@declare(AccessRule("public"))
async def public(request: Request) -> None:
    """For a route that needs no session: it states the decision."""
    reject_unknown_query(request)


def _declared(dependant: Dependant) -> Iterator[AccessRule]:
    rule = getattr(dependant.call, _MARK, None)
    if isinstance(rule, AccessRule):
        yield rule
    for child in dependant.dependencies:
        yield from _declared(child)


def route_access(route: RouteContext) -> str | None:
    """What the route's dependencies require together, as the catalog in docs/19 writes it
    (`members:manage fresh`), or None when it declares nothing.

    Takes a route as `fastapi.routing.iter_route_contexts(app.routes)` yields it: that is the
    route with the dependencies of every router it was included through. Every requirement is
    reported, so dropping one of two changes the label: the strictest kind, each permission,
    `every-project` and `fresh` when any dependency asks for them.
    """
    dependant = getattr(route, "dependant", None)
    if not isinstance(dependant, Dependant):
        return None
    rules = list(_declared(dependant))
    if not rules:
        return None
    permissions = sorted({rule.permission.value for rule in rules if rule.permission is not None})
    base = " + ".join(permissions) or max(
        (rule.kind for rule in rules), key=_STRICTNESS.__getitem__
    )
    if any(rule.every_project for rule in rules):
        base = f"{base} every-project"
    return f"{base} fresh" if any(rule.fresh for rule in rules) else base
