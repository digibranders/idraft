"""What a route depends on to know who is calling (docs/19-api-specification.md section 2.1)."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import Depends, Request, Response

from sightline.api.access import AccessRule, declare
from sightline.api.auth.sessions import REAUTH_URL, ExpiredSession, SessionContext
from sightline.api.pagination import reject_unknown_query
from sightline.api.problems import (
    FreshSessionRequiredError,
    SessionExpiredError,
    UnauthenticatedError,
)
from sightline.api.resources import Resources, get_resources

SESSION_COOKIE = "__Host-session"
# What new_token() produces. Anything else is not looked up.
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}", re.ASCII)


def set_session_cookie(response: Response, token: str, *, max_age: int) -> None:
    """`__Host-` requires Secure, Path=/ and no Domain; the browser refuses the cookie otherwise."""
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.set_cookie(
        SESSION_COOKIE, "", max_age=0, path="/", secure=True, httponly=True, samesite="lax"
    )


def session_token(request: Request) -> str | None:
    """The cookie value when it has the shape of a token, else None."""
    token = request.cookies.get(SESSION_COOKIE)
    return token if token is not None and _TOKEN.fullmatch(token) else None


async def _load(request: Request, resources: Resources, *, allow_pending: bool) -> SessionContext:
    token = session_token(request)
    if token is None:
        raise UnauthenticatedError
    try:
        context = await resources.session_store.load(token, now=datetime.now(UTC))
    except ExpiredSession:
        raise SessionExpiredError from None
    if context is None:
        raise UnauthenticatedError
    if context.state == "pending_totp" and not allow_pending:
        raise UnauthenticatedError("Two-factor verification is not complete.")
    # After the session check, so an anonymous caller learns nothing about the route's parameters.
    reject_unknown_query(request)
    return context


@contextmanager
def _identified(request: Request, context: SessionContext) -> Iterator[None]:
    """Name the caller in every log line of this request.

    The id also goes on the request state: the access log line and the 500 handler run after this
    context has been left, and read it from there. The session is not named: the log redaction
    treats anything called a session id as a credential, and the user is what an operator needs.
    """
    request.state.user_id = str(context.user_id)
    tokens = structlog.contextvars.bind_contextvars(user_id=str(context.user_id))
    try:
        yield
    finally:
        structlog.contextvars.reset_contextvars(**tokens)


@declare(AccessRule("authenticated"))
async def current_session(
    request: Request, resources: Annotated[Resources, Depends(get_resources)]
) -> AsyncIterator[SessionContext]:
    """A signed-in user with two-factor complete. 401 otherwise."""
    context = await _load(request, resources, allow_pending=False)
    with _identified(request, context):
        yield context


@declare(AccessRule("authenticated"))
async def pending_or_active_session(
    request: Request, resources: Annotated[Resources, Depends(get_resources)]
) -> AsyncIterator[SessionContext]:
    """Also accepts a session that still owes its TOTP code. Only `totp/verify` uses this."""
    context = await _load(request, resources, allow_pending=True)
    with _identified(request, context):
        yield context


@declare(AccessRule("public"))
async def optional_session(
    request: Request, resources: Annotated[Resources, Depends(get_resources)]
) -> AsyncIterator[SessionContext | None]:
    """The session if the cookie names a live one, pending or active. Never refuses one."""
    reject_unknown_query(request)
    token = session_token(request)
    context: SessionContext | None = None
    if token is not None:
        try:
            context = await resources.session_store.load(token, now=datetime.now(UTC))
        except ExpiredSession:
            context = None
    if context is None:
        yield None
        return
    with _identified(request, context):
        yield context


@declare(AccessRule("authenticated", fresh=True))
def fresh_session(
    context: Annotated[SessionContext, Depends(current_session)],
) -> SessionContext:
    """A session whose user re-entered a credential in the last 10 minutes. 403 otherwise."""
    if not context.is_fresh(datetime.now(UTC)):
        raise FreshSessionRequiredError(reauth_url=REAUTH_URL)
    return context


CurrentSession = Annotated[SessionContext, Depends(current_session)]
OptionalSession = Annotated[SessionContext | None, Depends(optional_session)]
PendingOrActiveSession = Annotated[SessionContext, Depends(pending_or_active_session)]
FreshSession = Annotated[SessionContext, Depends(fresh_session)]
