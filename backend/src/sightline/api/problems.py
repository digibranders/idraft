"""RFC 9457 problem responses (docs/19-api-specification.md section 2.7)."""

from __future__ import annotations

from typing import Any, ClassVar

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from sightline.api.request_id import HEADER, new_request_id
from sightline.api.routing import route_template

MEDIA_TYPE = "application/problem+json"
_log = structlog.get_logger(__name__)

_HTTP_STATUS_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "Bad request"),
    404: ("not_found", "Resource not found"),
    405: ("method_not_allowed", "Method not allowed"),
    413: ("payload_too_large", "Payload too large"),
    415: ("unsupported_media_type", "Unsupported media type"),
}


class ProblemError(Exception):
    """Base for every error the API returns on purpose. Subclasses fix status, code and title."""

    status: ClassVar[int] = 500
    code: ClassVar[str] = "internal_error"
    title: ClassVar[str] = "Internal error"

    def __init__(
        self, detail: str | None = None, *, code: str | None = None, **extensions: Any
    ) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        self.problem_code = code or self.code
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
    **extensions: Any,
) -> JSONResponse:
    request_id = _request_id(request)
    body: dict[str, Any] = {
        "type": f"{app_origin}/api/problems/{code}",
        "title": title,
        "status": status,
    }
    if detail is not None:
        body["detail"] = detail
    body |= {"instance": request.url.path, "code": code, "request_id": request_id, **extensions}
    return JSONResponse(
        body, status_code=status, media_type=MEDIA_TYPE, headers={HEADER: request_id}
    )


def _validation_errors(error: RequestValidationError) -> list[dict[str, str]]:
    return [
        {
            "location": str(item["loc"][0]),
            "path": ".".join(str(part) for part in item["loc"][1:]),
            "code": str(item["type"]),
            "message": str(item["msg"]),
        }
        for item in error.errors()
    ]


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
            **error.extensions,
        )

    async def handle_validation(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, RequestValidationError):  # pragma: no cover
            raise error
        errors = _validation_errors(error)
        if any(item["code"] == "json_invalid" for item in errors):
            return problem_response(
                request,
                app_origin=app_origin,
                status=400,
                code="bad_request",
                title="Bad request",
                detail="The request body is not valid JSON.",
            )
        count = len(errors)
        noun, verb = ("field", "is") if count == 1 else ("fields", "are")
        return problem_response(
            request,
            app_origin=app_origin,
            status=422,
            code="validation_failed",
            title="Request validation failed",
            detail=f"{count} {noun} {verb} invalid.",
            errors=errors,
        )

    async def handle_http(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, HTTPException):  # pragma: no cover
            raise error
        code, title = _HTTP_STATUS_CODES.get(error.status_code, ("http_error", "Request failed"))
        return problem_response(
            request, app_origin=app_origin, status=error.status_code, code=code, title=title
        )

    async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:
        # Starlette runs this handler outside the middleware stack, after the request id has been
        # unbound from the log context, so it is passed explicitly.
        _log.error(
            "unhandled exception",
            exc_info=error,
            route=route_template(request.scope),
            request_id=_request_id(request),
        )
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
