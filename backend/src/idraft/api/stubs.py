"""Routes whose contract is published before their body is built (docs/ai-visibility/MASTER-PLAN.md
section 3.8).

A stub declares the access, path, query and body of its built route, so the session, membership,
project scope and permission checks answer first (401, 404, 403), the body is validated next
(422), and only then does it answer `501 not_implemented`. `not_built` marks its endpoint:
tests/security/test_cross_tenant.py expects that 501 inside the caller's scope. The package that
builds the body removes the mark and the raise together.

A built route that gained a contract addition (a parameter or a body member) passes what the
request used to `refuse_unbuilt`: left out, the route behaves exactly as before.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Final

from idraft.api.problems import NotImplementedProblemError

_MARK: Final = "__idraft_not_built__"
_PUBLISHED: Final = "This route's contract is published; its body is not built yet."


def not_built[F: Callable[..., Any]](endpoint: F) -> F:
    """Mark the endpoint of a route whose body only raises `not_built_yet()`."""
    setattr(endpoint, _MARK, True)
    return endpoint


def is_not_built(endpoint: object) -> bool:
    return getattr(endpoint, _MARK, False) is True


def not_built_yet(detail: str = _PUBLISHED) -> NotImplementedProblemError:
    return NotImplementedProblemError(detail)


def refuse_unbuilt(sent: Mapping[str, bool]) -> None:
    """`501` naming, in order, every contract addition the request used; nothing when none."""
    used = [name for name, given in sent.items() if given]
    if used:
        raise not_built_yet(f"Not built yet: {', '.join(used)}.")
