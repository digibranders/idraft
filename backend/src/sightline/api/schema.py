"""The OpenAPI document: every error is a problem response (RFC 9457), never FastAPI's default."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from sightline.api.problems import MEDIA_TYPE, Problem
from sightline.api.slugs import ReservedProjectSlug, ReservedWorkspaceSlug

_FASTAPI_DEFAULT_ERROR_SCHEMAS = ("HTTPValidationError", "ValidationError")
_REF_TEMPLATE = "#/components/schemas/{model}"


def _problem_response() -> dict[str, Any]:
    return {
        "description": "Error, as RFC 9457 problem details. `code` is the stable machine value.",
        "content": {MEDIA_TYPE: {"schema": {"$ref": _REF_TEMPLATE.format(model="Problem")}}},
    }


def build_schema(app: FastAPI) -> dict[str, Any]:
    document = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schemas: dict[str, Any] = document.setdefault("components", {}).setdefault("schemas", {})

    for name in _FASTAPI_DEFAULT_ERROR_SCHEMAS:
        schemas.pop(name, None)
    problem = Problem.model_json_schema(ref_template=_REF_TEMPLATE)
    schemas.update(problem.pop("$defs", {}))
    schemas["Problem"] = problem
    # Not the type of any field, so nothing would carry them into the document: the web forms
    # refuse these words before asking the API.
    for reserved in (ReservedWorkspaceSlug, ReservedProjectSlug):
        schemas[reserved.__name__] = {
            "type": "string",
            "enum": [member.value for member in reserved],
            "description": "Words a slug cannot be: they are routes of the web app.",
        }

    for path_item in document.get("paths", {}).values():
        for operation in path_item.values():
            responses: dict[str, Any] = operation.setdefault("responses", {})
            responses.pop("422", None)
            responses["default"] = _problem_response()
    return document


def install_openapi(app: FastAPI) -> None:
    """Make `app.openapi()` return the document above, built once."""

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build_schema(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
