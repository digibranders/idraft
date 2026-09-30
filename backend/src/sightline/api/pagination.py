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
from pydantic.fields import FieldInfo

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


def _public_name(name: str, info: FieldInfo) -> str:
    """The name a client writes: the validation alias when there is one, else the alias."""
    if isinstance(info.validation_alias, str):
        return info.validation_alias
    return info.alias or name


def _query_names(dependant: Dependant) -> Iterator[str]:
    """Every query parameter the route or one of its dependencies declares."""
    for field in dependant.query_params:
        annotation = field.field_info.annotation
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            # A model used as the query: its fields are the parameters.
            for name, info in annotation.model_fields.items():
                yield _public_name(name, info)
        else:
            yield _public_name(field.name, field.field_info)
    for child in dependant.dependencies:
        yield from _query_names(child)


def reject_unknown_query(request: Request) -> None:
    """A misspelt filter must not silently widen a result, so a parameter the route does not
    declare is a validation error.

    Called by `public` and by the session dependencies once the session is known, and every route
    depends on one of them (tests/api/test_route_access.py). An anonymous caller of a protected
    route is therefore answered 401 whatever the query says, and cannot use this to list a
    route's parameters. A handler that reads `request.query_params` itself has to declare the
    names it reads as parameters.
    """
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):  # pragma: no cover - only API routes carry dependencies
        return
    unknown = sorted(set(request.query_params) - set(_query_names(route.dependant)))
    if unknown:
        raise RequestValidationError(
            [
                {"loc": ("query", name), "type": "extra_forbidden", "msg": "Unknown parameter."}
                for name in unknown
            ]
        )
