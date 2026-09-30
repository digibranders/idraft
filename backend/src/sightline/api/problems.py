"""RFC 9457 problem responses (docs/19-api-specification.md section 2.7)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, ClassVar

import structlog
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from sightline.api.request_id import HEADER, new_request_id
from sightline.api.routing import route_template

MEDIA_TYPE = "application/problem+json"
MAX_VALIDATION_ERRORS = 50
_STANDARD_MEMBERS = frozenset({"type", "title", "status", "detail", "instance", "request_id"})
_JSON_MEDIA_TYPES = ("application/json", "+json")
_BODY_SHAPE_ERRORS = frozenset({"model_attributes_type", "dict_type", "missing"})
_log = structlog.get_logger(__name__)

_HTTP_STATUS_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "Bad request"),
    401: ("unauthenticated", "Authentication required"),
    403: ("forbidden", "Not allowed"),
    404: ("not_found", "Resource not found"),
    405: ("method_not_allowed", "Method not allowed"),
    409: ("conflict", "Conflict"),
    413: ("payload_too_large", "Payload too large"),
    415: ("unsupported_media_type", "Unsupported media type"),
    429: ("rate_limited", "Too many requests"),
    503: ("service_unavailable", "Service unavailable"),
}


class ValidationItem(BaseModel):
    location: str
    path: str
    code: str
    message: str


class Problem(BaseModel):
    """The body of every error response. Codes may add members, documented per route."""

    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str
    code: str
    request_id: str
    errors: list[ValidationItem] | None = None


class ProblemError(Exception):
    """Base for every error the API returns on purpose. Subclasses fix status, code and title."""

    status: ClassVar[int] = 500
    code: ClassVar[str] = "internal_error"
    title: ClassVar[str] = "Internal error"

    def __init__(
        self,
        detail: str | None = None,
        *,
        code: str | None = None,
        headers: Mapping[str, str] | None = None,
        **extensions: Any,
    ) -> None:
        reserved = _STANDARD_MEMBERS.intersection(extensions)
        if reserved:
            raise ValueError(f"extensions cannot replace standard members: {sorted(reserved)}")
        super().__init__(detail or self.title)
        self.detail = detail
        self.problem_code = code or self.code
        self.headers = dict(headers or {})
        self.extensions = extensions


class BadRequestError(ProblemError):
    status, code, title = 400, "bad_request", "Bad request"


class UnauthenticatedError(ProblemError):
    status, code, title = 401, "unauthenticated", "Authentication required"


class ForbiddenError(ProblemError):
    status, code, title = 403, "forbidden", "Not allowed"


class NotFoundError(ProblemError):
    status, code, title = 404, "not_found", "Resource not found"


class ConflictError(ProblemError):
    status, code, title = 409, "conflict", "Conflict"


class RateLimitedError(ProblemError):
    status, code, title = 429, "rate_limited", "Too many requests"


def _request_id(request: Request) -> str:
    existing = getattr(request.state, "request_id", None)
    return existing if isinstance(existing, str) else new_request_id()


def problem_response(
    request: Request,
    *,
    app_origin: str,
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    headers: Mapping[str, str] | None = None,
    extensions: Mapping[str, Any] | None = None,
) -> JSONResponse:
    request_id = _request_id(request)
    body: dict[str, Any] = {
        "type": f"{app_origin}/api/problems/{code}",
        "title": title,
        "status": status,
    }
    if detail is not None:
        body["detail"] = detail
    body |= {"instance": request.url.path, "code": code, "request_id": request_id}
    body |= dict(extensions or {})
    return JSONResponse(
        jsonable_encoder(body),
        status_code=status,
        media_type=MEDIA_TYPE,
        headers={**(headers or {}), HEADER: request_id},
    )


def _validation_items(error: RequestValidationError) -> list[dict[str, str]]:
    """Location, path, Pydantic error type and message. The submitted value is never included."""
    return [
        {
            "location": str(item["loc"][0]),
            "path": ".".join(str(part) for part in item["loc"][1:]),
            "code": str(item["type"]),
            "message": str(item["msg"]),
        }
        for item in error.errors()
    ]


def _body_was_not_parsed_as_json(request: Request, items: list[dict[str, str]]) -> bool:
    """A body sent with a non-JSON content type reaches the model as one unparsed value."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    is_json = content_type.endswith(_JSON_MEDIA_TYPES)
    at_body_root = [i for i in items if i["location"] == "body" and i["path"] == ""]
    return not is_json and any(item["code"] in _BODY_SHAPE_ERRORS for item in at_body_root)


def register_problem_handlers(app: FastAPI, *, app_origin: str) -> None:
    async def handle_problem(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, ProblemError):  # pragma: no cover - registered for this type
            raise error
        return problem_response(
            request,
            app_origin=app_origin,
            status=error.status,
            code=error.problem_code,
            title=error.title,
            detail=error.detail,
            headers=error.headers,
            extensions=error.extensions,
        )

    async def handle_validation(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, RequestValidationError):  # pragma: no cover
            raise error
        items = _validation_items(error)
        if any(item["code"] == "json_invalid" for item in items):
            return problem_response(
                request,
                app_origin=app_origin,
                status=400,
                code="bad_request",
                title="Bad request",
                detail="The request body is not valid JSON.",
            )
        if _body_was_not_parsed_as_json(request, items):
            return problem_response(
                request,
                app_origin=app_origin,
                status=415,
                code="unsupported_media_type",
                title="Unsupported media type",
                detail="Send the body as application/json.",
            )
        count = len(items)
        noun, verb = ("field", "is") if count == 1 else ("fields", "are")
        extensions: dict[str, Any] = {"errors": items[:MAX_VALIDATION_ERRORS]}
        if count > MAX_VALIDATION_ERRORS:
            extensions["errors_truncated"] = True
        return problem_response(
            request,
            app_origin=app_origin,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail=f"{count} {noun} {verb} invalid.",
            extensions=extensions,
        )

    async def handle_http(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, HTTPException):  # pragma: no cover
            raise error
        code, title = _HTTP_STATUS_CODES.get(error.status_code, ("http_error", "Request failed"))
        return problem_response(
            request,
            app_origin=app_origin,
            status=error.status_code,
            code=code,
            title=title,
            headers=error.headers,
        )

    async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:
        # Starlette runs this handler outside the middleware stack, after the request id has been
        # unbound from the log context, so it is passed explicitly.
        context = {"route": route_template(request.scope), "request_id": _request_id(request)}
        if isinstance(error, ResponseValidationError):
            # Its message quotes the value the handler returned, which may be tenant content.
            _log.error(
                "response did not match its model",
                locations=[".".join(str(part) for part in item["loc"]) for item in error.errors()],
                **context,
            )
        else:
            _log.error("unhandled exception", exc_info=error, **context)
        return problem_response(
            request,
            app_origin=app_origin,
            status=500,
            code="internal_error",
            title="Internal error",
        )

    app.add_exception_handler(ProblemError, handle_problem)
    app.add_exception_handler(RequestValidationError, handle_validation)
    app.add_exception_handler(HTTPException, handle_http)
    app.add_exception_handler(Exception, handle_unexpected)
