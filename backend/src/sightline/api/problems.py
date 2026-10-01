"""RFC 9457 problem responses (docs/19-api-specification.md section 2.7)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, ClassVar

import structlog
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from pydantic import BaseModel, ConfigDict, Field
from pydantic.json_schema import SkipJsonSchema
from sqlalchemy.exc import DBAPIError
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


def _no_default(schema: dict[str, Any]) -> None:
    schema.pop("default", None)


class Problem(BaseModel):
    """The body of every error response. Codes may add members, documented per route."""

    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    # Left out of a body when there is none, never sent as null: optional, with no default.
    detail: str | SkipJsonSchema[None] = Field(default=None, json_schema_extra=_no_default)
    instance: str
    code: str
    request_id: str
    errors: list[ValidationItem] | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=_no_default
    )


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


class InvalidTokenError(ProblemError):
    """An emailed token that is unknown, used, expired or meant for something else."""

    status, code, title = 400, "invalid_token", "Link is not valid"


class UnauthenticatedError(ProblemError):
    status, code, title = 401, "unauthenticated", "Authentication required"


class SessionExpiredError(ProblemError):
    status, code, title = 401, "session_expired", "Session expired"


class InvalidCredentialsError(ProblemError):
    """One answer for an unknown email, a wrong password and a disabled account."""

    status, code, title = 401, "invalid_credentials", "Email or password is not correct"


class InvalidCodeError(ProblemError):
    """A two-factor code or recovery code that is wrong, already used or not set up."""

    status, code, title = 401, "invalid_code", "Code is not correct"


class ForbiddenError(ProblemError):
    status, code, title = 403, "forbidden", "Not allowed"


class FreshSessionRequiredError(ProblemError):
    """Carries `reauth_url`: where the client sends the user to re-enter a credential."""

    status, code, title = 403, "fresh_session_required", "Recent sign-in required"


class OriginNotAllowedError(ProblemError):
    status, code, title = 403, "origin_not_allowed", "Origin not allowed"


class TwoFactorRequiredForRoleError(ProblemError):
    status, code, title = 403, "two_factor_required_for_role", "This role must keep two-factor on"


class SecondFactorRequiredError(ProblemError):
    """Re-authentication with the password alone, by a user who has two-factor on."""

    status, code, title = 403, "second_factor_required", "A two-factor code is required"


class WorkspaceSuspendedError(ProblemError):
    """A suspended workspace can be read and not changed."""

    status, code, title = 403, "workspace_suspended", "Workspace is suspended"


class RegistrationClosedError(ProblemError):
    status, code, title = 403, "registration_closed", "Registration is by invitation"


class EmailNotVerifiedError(ProblemError):
    status, code, title = 403, "email_not_verified", "Email address is not verified"


class NotFoundError(ProblemError):
    status, code, title = 404, "not_found", "Resource not found"


class ConflictError(ProblemError):
    status, code, title = 409, "conflict", "Conflict"


class DuplicateError(ProblemError):
    status, code, title = 409, "duplicate", "Already exists"


class InvalidStateTransitionError(ProblemError):
    status, code, title = 409, "invalid_state_transition", "Not possible in the current state"


class EntityInUseProblemError(ProblemError):
    """A project role, current or removed, or a product still names the entity."""

    status, code, title = 409, "entity_in_use", "The entity is in use"


class CycleDetectedError(ProblemError):
    status, code, title = 422, "cycle_detected", "That would make a cycle"


class HasChildrenError(ProblemError):
    """A term with children is deleted only with `cascade=true`."""

    status, code, title = 409, "has_children", "The term has children"


class PrimaryOwnExistsError(ProblemError):
    status, code, title = 409, "primary_own_exists", "The project has a primary own entity"


class CannotRemovePrimaryOwnError(ProblemError):
    status, code, title = 409, "cannot_remove_primary_own", "The primary own entity stays"


class CompetitorLimitError(ProblemError):
    """Carries `limit`."""

    status, code, title = 422, "competitor_limit", "Too many SEO competitors"


class TooManyMatchesError(ProblemError):
    status, code, title = 422, "too_many_matches", "The text matched too many times"


class PayloadTooLargeError(ProblemError):
    """Carries `limit_bytes`."""

    status, code, title = 413, "payload_too_large", "Payload too large"


class LastOwnerError(ProblemError):
    status, code, title = 409, "last_owner", "A workspace needs an owner"


class TotpAlreadyEnabledError(ProblemError):
    status, code, title = 409, "totp_already_enabled", "Two-factor is already on"


class TotpNotEnabledError(ProblemError):
    status, code, title = 409, "totp_not_enabled", "Two-factor is not on"


class InvitationExpiredError(ProblemError):
    status, code, title = 410, "invitation_expired", "Invitation has expired"


class QuotaExceededError(ProblemError):
    """Carries `limit`, `used` and `requested`."""

    status, code, title = 422, "quota_exceeded", "Workspace limit reached"


class WeakPasswordProblemError(ProblemError):
    """Carries `reason`: too_short, too_long, contains_email, breached or unchanged."""

    status, code, title = 422, "weak_password", "Password is not strong enough"


class RateLimitedError(ProblemError):
    status, code, title = 429, "rate_limited", "Too many requests"


class ServiceUnavailableError(ProblemError):
    status, code, title = 503, "service_unavailable", "Service unavailable"


class QueryTimeoutError(ProblemError):
    status, code, title = 503, "query_timeout", "The request took too long"


# What PostgreSQL reports when a statement could not finish because of other work, not because
# of a fault: the row is locked by another request (55P03), two requests waited on each other
# and this one was chosen to give way (40P01), or the statement ran into its timeout (57014).
_LOCK_NOT_AVAILABLE = "55P03"
_DEADLOCK_DETECTED = "40P01"
_QUERY_CANCELED = "57014"


def _contention(error: DBAPIError) -> ProblemError | None:
    """The problem to answer a database error with, when it says "busy" and not "broken"."""
    state = getattr(error.orig, "sqlstate", None)
    if state in (_LOCK_NOT_AVAILABLE, _DEADLOCK_DETECTED):
        return ConflictError("Another request is changing this. Try again.")
    if state == _QUERY_CANCELED:
        return QueryTimeoutError("Try again, with a narrower request if it has filters.")
    return None


def invalid_field(path: str, *, code: str, message: str) -> RequestValidationError:
    """A `422 validation_failed` for a body field that only the database can judge, in the same
    shape as the errors Pydantic finds."""
    return RequestValidationError([{"loc": ("body", path), "type": code, "msg": message}])


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
        # Starlette runs this handler outside the middleware stack, after the request id and the
        # caller's id have been unbound from the log context, so they are passed explicitly.
        context = {"route": route_template(request.scope), "request_id": _request_id(request)}
        for name in ("user_id", "workspace_id"):
            value = getattr(request.state, name, None)
            if isinstance(value, str):
                context[name] = value
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

    async def handle_database(request: Request, error: Exception) -> JSONResponse:
        problem = _contention(error) if isinstance(error, DBAPIError) else None
        if problem is None:
            # Not contention: raised again, so it reaches the catch-all and the error tracker
            # like any other fault.
            raise error
        _log.warning(
            "database contention", sqlstate=getattr(getattr(error, "orig", None), "sqlstate", None)
        )
        return await handle_problem(request, problem)

    app.add_exception_handler(ProblemError, handle_problem)
    app.add_exception_handler(DBAPIError, handle_database)
    app.add_exception_handler(RequestValidationError, handle_validation)
    app.add_exception_handler(HTTPException, handle_http)
    app.add_exception_handler(Exception, handle_unexpected)
