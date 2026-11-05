"""A client for the Google calls the Search Console connection makes.

Authorization-code flow with PKCE, token refresh, the account's identity and `sites.list`
(docs/18 sections 3.2, 4.1 and 4.6). The HTTP client is injected, so a test hands it a
`httpx.MockTransport` and nothing leaves the process.

Retries: a transport error or a 5xx is tried again with exponential backoff and full jitter, up
to `attempts` times; the interactive routes keep the base short, the worker passes the long one
of doc 18 section 4.6. A 4xx is never retried: it is mapped to a typed error. A 401 on an API
call is `GoogleUnauthorizedError`, and the caller refreshes the access token once. Responses are
parsed into Pydantic models; anything else is `GoogleResponseError`. Tokens are never logged and
never put in an exception.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import random
import secrets
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal
from urllib.parse import quote, urlencode

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from idraft.providers.google.errors import (
    GoogleClientRejectedError,
    GoogleInvalidGrantError,
    GooglePermissionError,
    GoogleQuotaError,
    GoogleResponseError,
    GoogleUnauthorizedError,
    GoogleUnavailableError,
)

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
SITES_URL = "https://www.googleapis.com/webmasters/v3/sites"
# Largest page the API gives (docs/18 section 4.2).
SEARCH_ANALYTICS_ROW_LIMIT = 25_000
SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
# Minimum, read-only; `openid email` identify the account (a stable `sub`).
CONNECT_SCOPES = ("openid", "email", SEARCH_CONSOLE_SCOPE)
ATTEMPTS = 3
BACKOFF_SECONDS = 0.5
_VERIFIER_BYTES = 48
_QUOTA_REASONS = frozenset({"quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"})
_CLIENT_ERRORS = frozenset(
    {"invalid_client", "unauthorized_client", "invalid_request", "redirect_uri_mismatch"}
)

type Sleep = Callable[[float], Awaitable[None]]
type Dimension = Literal["date", "query", "page", "country", "device"]


@dataclass(frozen=True, slots=True)
class Pkce:
    """A code verifier and its S256 challenge (RFC 7636)."""

    verifier: str = field(repr=False)
    challenge: str


def new_pkce() -> Pkce:
    verifier = secrets.token_urlsafe(_VERIFIER_BYTES)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return Pkce(verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii"))


def authorization_url(*, client_id: str, redirect_uri: str, state: str, challenge: str) -> str:
    """The address the person is sent to. `prompt=consent` with `access_type=offline` makes
    Google issue a refresh token every time, and `include_granted_scopes=false` keeps this grant
    to Search Console: GA4 gets its own grant and its own revocation (docs/18 section 3.2)."""
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(CONNECT_SCOPES),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "false",
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


class _TokenBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    access_token: str = Field(min_length=1)
    refresh_token: str | None = None
    expires_in: int = Field(gt=0)
    scope: str = ""


class _UserinfoBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sub: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=320)


class _SiteEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    siteUrl: str = Field(min_length=1, max_length=2048)  # noqa: N815 - Google's member name
    permissionLevel: str = Field(min_length=1, max_length=64)  # noqa: N815


class _SitesBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Left out of the answer when the account has no property.
    siteEntry: list[_SiteEntry] = Field(default_factory=list)  # noqa: N815


class _AnalyticsRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    keys: list[str]
    # Google writes whole numbers as JSON numbers that may carry a fraction part (`3.0`).
    clicks: float = Field(ge=0)
    impressions: float = Field(ge=0)
    position: float = Field(ge=0)


class _AnalyticsBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Left out of the answer when nothing matched; a `startRow` past the end is HTTP 200 with none.
    rows: list[_AnalyticsRow] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class TokenGrant:
    """What the token endpoint gave. The tokens stay out of `repr`."""

    access_token: str = field(repr=False)
    refresh_token: str | None = field(repr=False)
    expires_in: int
    scopes: frozenset[str]


@dataclass(frozen=True, slots=True)
class AccessToken:
    access_token: str = field(repr=False)
    expires_in: int


@dataclass(frozen=True, slots=True)
class Identity:
    sub: str
    email: str | None


@dataclass(frozen=True, slots=True)
class AnalyticsRow:
    """One row of `searchAnalytics.query`: the values of the requested dimensions, in order."""

    keys: tuple[str, ...]
    clicks: int
    impressions: int
    position: float


@dataclass(frozen=True, slots=True)
class Site:
    site_url: str
    # siteOwner, siteFullUser, siteRestrictedUser or siteUnverifiedUser; a new one is passed on.
    permission_level: str


class GoogleClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        client_id: str,
        client_secret: str,
        attempts: int = ATTEMPTS,
        backoff_seconds: float = BACKOFF_SECONDS,
        sleep: Sleep = asyncio.sleep,
        jitter: Callable[[], float] = random.random,
    ) -> None:
        if attempts < 1:
            raise ValueError("attempts must be at least 1")
        self._http = http
        self._client_id = client_id
        self._client_secret = client_secret
        self._attempts = attempts
        self._backoff = backoff_seconds
        self._sleep = sleep
        self._jitter = jitter

    async def exchange_code(self, *, code: str, verifier: str, redirect_uri: str) -> TokenGrant:
        body = await self._token_call(
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
            }
        )
        return TokenGrant(
            access_token=body.access_token,
            refresh_token=body.refresh_token,
            expires_in=body.expires_in,
            scopes=frozenset(body.scope.split()),
        )

    async def refresh(self, refresh_token: str) -> AccessToken:
        """A new access token. `GoogleInvalidGrantError` means the refresh token is dead."""
        body = await self._token_call(
            {"grant_type": "refresh_token", "refresh_token": refresh_token}
        )
        return AccessToken(body.access_token, body.expires_in)

    async def identity(self, access_token: str) -> Identity:
        response = await self._send("GET", USERINFO_URL, headers=_bearer(access_token))
        _raise_for_api(response)
        body = _parse(_UserinfoBody, response)
        return Identity(sub=body.sub, email=body.email)

    async def list_sites(self, access_token: str) -> list[Site]:
        response = await self._send("GET", SITES_URL, headers=_bearer(access_token))
        _raise_for_api(response)
        return [Site(e.siteUrl, e.permissionLevel) for e in _parse(_SitesBody, response).siteEntry]

    async def search_analytics(
        self,
        access_token: str,
        site_url: str,
        *,
        start_date: date,
        end_date: date,
        dimensions: Sequence[Dimension],
        data_state: Literal["final", "all"] = "final",
        aggregation: Literal["auto", "byProperty", "byPage"] = "auto",
        search_type: str = "web",
        start_row: int = 0,
        row_limit: int = SEARCH_ANALYTICS_ROW_LIMIT,
    ) -> list[AnalyticsRow]:
        """One page of `searchAnalytics.query` (docs/18 section 4.2). Dates are Pacific Time
        calendar days. An empty list is the end of the results; the caller pages with
        `start_row`."""
        response = await self._send(
            "POST",
            f"{SITES_URL}/{quote(site_url, safe='')}/searchAnalytics/query",
            headers=_bearer(access_token),
            json={
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
                "dimensions": list(dimensions),
                "dataState": data_state,
                "aggregationType": aggregation,
                "type": search_type,
                "rowLimit": row_limit,
                "startRow": start_row,
            },
        )
        _raise_for_api(response)
        rows = _parse(_AnalyticsBody, response).rows
        if any(len(row.keys) != len(dimensions) for row in rows):
            raise GoogleResponseError("a row does not carry the requested dimensions")
        return [
            AnalyticsRow(
                keys=tuple(row.keys),
                clicks=round(row.clicks),
                impressions=round(row.impressions),
                position=row.position,
            )
            for row in rows
        ]

    async def revoke(self, token: str) -> bool:
        """Ask Google to revoke a token. Best effort: whether Google acknowledged is returned,
        and no failure is raised, since a disconnect must not depend on Google answering."""
        try:
            response = await self._send("POST", REVOKE_URL, data={"token": token})
        except GoogleUnavailableError:
            return False
        return response.status_code == httpx.codes.OK

    async def _token_call(self, form: Mapping[str, str]) -> _TokenBody:
        response = await self._send(
            "POST",
            TOKEN_URL,
            data={**form, "client_id": self._client_id, "client_secret": self._client_secret},
        )
        if response.is_success:
            return _parse(_TokenBody, response)
        error = _error_code(response)
        if error == "invalid_grant":
            raise GoogleInvalidGrantError
        if error in _CLIENT_ERRORS:
            raise GoogleClientRejectedError
        raise GoogleResponseError(f"token endpoint answered HTTP {response.status_code}")

    async def _send(self, method: str, url: str, **options: Any) -> httpx.Response:
        for attempt in range(1, self._attempts + 1):
            try:
                response = await self._http.request(method, url, **options)
            except httpx.TransportError:
                response = None
            if response is not None and response.status_code < httpx.codes.INTERNAL_SERVER_ERROR:
                return response
            if attempt < self._attempts:
                await self._sleep(self._jitter() * self._backoff * 2 ** (attempt - 1))
        raise GoogleUnavailableError


def _bearer(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _error_code(response: httpx.Response) -> str | None:
    """`error` of an OAuth error body: a string at the token endpoint, an object in the APIs."""
    body = _json(response)
    error = body.get("error") if isinstance(body, dict) else None
    return error if isinstance(error, str) else None


def _parse[M: BaseModel](model: type[M], response: httpx.Response) -> M:
    try:
        return model.model_validate(_json(response))
    except ValidationError:
        # No detail: the input would be echoed, and it holds tokens.
        raise GoogleResponseError(f"{model.__name__} is not what Google documents") from None


def _raise_for_api(response: httpx.Response) -> None:
    """Map an API answer to a typed error (docs/18 section 4.6)."""
    status = response.status_code
    if response.is_success:
        return
    if status == httpx.codes.UNAUTHORIZED:
        raise GoogleUnauthorizedError
    if status in (httpx.codes.TOO_MANY_REQUESTS, httpx.codes.FORBIDDEN):
        if status == httpx.codes.TOO_MANY_REQUESTS or _is_quota(response):
            raise GoogleQuotaError
        raise GooglePermissionError
    raise GoogleResponseError(f"HTTP {status}")


def _is_quota(response: httpx.Response) -> bool:
    body = _json(response)
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return False
    reasons = {item.get("reason") for item in error.get("errors", []) if isinstance(item, dict)}
    message = str(error.get("message", "")).lower()
    return bool(reasons & _QUOTA_REASONS) or "quota" in message
