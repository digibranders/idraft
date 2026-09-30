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

from fastapi.dependencies.models import Dependant
from fastapi.routing import RouteContext

from sightline.api.permissions import Permission

AccessKind = Literal["public", "authenticated", "member", "permission"]
_MARK = "__sightline_access__"
_STRICTNESS: dict[AccessKind, int] = {"public": 0, "authenticated": 1, "member": 2, "permission": 3}


@dataclass(frozen=True, slots=True)
class AccessRule:
    kind: AccessKind
    permission: Permission | None = None
    fresh: bool = False

    def __post_init__(self) -> None:
        if (self.kind == "permission") != (self.permission is not None):
            raise ValueError("a permission rule names its permission, and no other rule does")

    @property
    def label(self) -> str:
        """As the catalog in docs/19-api-specification.md writes it: `members:manage fresh`."""
        base = self.kind if self.permission is None else self.permission.value
        return f"{base} fresh" if self.fresh else base


def declare[F: Callable[..., Any]](rule: AccessRule) -> Callable[[F], F]:
    """Mark a dependency with the access it enforces."""

    def mark(dependency: F) -> F:
        setattr(dependency, _MARK, rule)
        return dependency

    return mark


@declare(AccessRule("public"))
def public() -> None:
    """For a route that needs no session. It checks nothing: it states the decision."""


def _declared(dependant: Dependant) -> Iterator[AccessRule]:
    rule = getattr(dependant.call, _MARK, None)
    if isinstance(rule, AccessRule):
        yield rule
    for child in dependant.dependencies:
        yield from _declared(child)


def route_access(route: RouteContext) -> AccessRule | None:
    """The strictest rule among the route's dependencies, or None when it declares none.

    Takes a route as `fastapi.routing.iter_route_contexts(app.routes)` yields it: that is the
    route with the dependencies of every router it was included through.
    """
    dependant = getattr(route, "dependant", None)
    if not isinstance(dependant, Dependant):
        return None
    rules = list(_declared(dependant))
    if not rules:
        return None
    return max(rules, key=lambda rule: (_STRICTNESS[rule.kind], rule.fresh))
