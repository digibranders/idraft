"""Offset pages for small lists, and the rule that an unknown query parameter is an error
(docs/19-api-specification.md section 2.4)."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.dependencies.models import Dependant
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel

LIMIT_DEFAULT = 50
LIMIT_MAX = 200
OFFSET_MAX = 100_000


class OffsetPageInfo(BaseModel):
    offset: int
    limit: int
    total: int


@dataclass(frozen=True, slots=True)
class OffsetParams:
    offset: int
    limit: int


def offset_params(
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
    limit: Annotated[int, Query(ge=1, le=LIMIT_MAX)] = LIMIT_DEFAULT,
) -> OffsetParams:
    return OffsetParams(offset=offset, limit=limit)


Offset = Annotated[OffsetParams, Depends(offset_params)]


def _declared(dependant: Dependant) -> Iterator[str]:
    for field in dependant.query_params:
        yield field.alias
    for child in dependant.dependencies:
        yield from _declared(child)


async def reject_unknown_query(request: Request) -> None:
    """A misspelt filter must not silently widen a result, so a parameter no route declares is a
    validation error. Installed on the application, so it holds for every route."""
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):  # pragma: no cover - only API routes carry dependencies
        return
    # Every query parameter the route or one of its dependencies declares, by its public name.
    unknown = sorted(set(request.query_params) - set(_declared(route.dependant)))
    if unknown:
        raise RequestValidationError(
            [
                {"loc": ("query", name), "type": "extra_forbidden", "msg": "Unknown parameter."}
                for name in unknown
            ]
        )
