"""Offset and keyset pages for lists, and the rule that an unknown query parameter is an error
(docs/19-api-specification.md section 2.4)."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.dependencies.models import Dependant
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel
from pydantic.fields import FieldInfo

from sightline.api.problems import BadRequestError

LIMIT_DEFAULT = 50
LIMIT_MAX = 200
OFFSET_MAX = 100_000
CURSOR_MAX = 512


class OffsetPageInfo(BaseModel):
    offset: int
    limit: int
    total: int


class CursorPageInfo(BaseModel):
    """A keyset page (docs/19 section 2.4). `next_cursor` is opaque; pass it back as `cursor`."""

    limit: int
    next_cursor: str | None
    has_more: bool


@dataclass(frozen=True, slots=True)
class CursorParams:
    cursor: str | None
    limit: int


def cursor_params(
    cursor: Annotated[
        str | None,
        Query(max_length=CURSOR_MAX, description="`page.next_cursor` of the previous page."),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=LIMIT_MAX)] = LIMIT_DEFAULT,
) -> CursorParams:
    return CursorParams(cursor=cursor, limit=limit)


Cursor = Annotated[CursorParams, Depends(cursor_params)]

type KeyValue = str | int


def _scope_hash(scope: Mapping[str, object]) -> str:
    canonical = json.dumps(scope, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def encode_cursor(key: Sequence[KeyValue], *, scope: Mapping[str, object]) -> str:
    """The last row's sort values, bound to the filters and sort that produced the page."""
    payload = json.dumps({"k": list(key), "s": _scope_hash(scope)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def invalid_cursor() -> BadRequestError:
    return BadRequestError(
        "The cursor was not made by this list with these filters. Start from the first page.",
        code="invalid_cursor",
    )


def decode_cursor(cursor: str, *, scope: Mapping[str, object]) -> list[KeyValue]:
    """The key `encode_cursor` stored. Raises `400 invalid_cursor` for anything else, and for a
    cursor made under other filters or another sort."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw)
    except (binascii.Error, ValueError):
        raise invalid_cursor() from None
    if not isinstance(payload, dict) or payload.get("s") != _scope_hash(scope):
        raise invalid_cursor()
    key = payload.get("k")
    if not isinstance(key, list) or not all(
        isinstance(value, str | int) and not isinstance(value, bool) for value in key
    ):
        raise invalid_cursor()
    return key


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
