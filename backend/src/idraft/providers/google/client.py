"""A client for the Google calls the Google connection makes (Search Console and GA4).

Authorization-code flow with PKCE, token refresh, the account's identity, `sites.list` and the
Analytics Admin API's `accountSummaries.list` and the GA4 Data API's `runReport` (docs/18
sections 3.2, 4.1, 4.6 and 7.2). The HTTP
client is injected, so a test hands it a `httpx.MockTransport` and nothing leaves the process.

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
import re
import secrets
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Literal
from urllib.parse import quote, urlencode

import httpx
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

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
ACCOUNT_SUMMARIES_URL = "https://analyticsadmin.googleapis.com/v1beta/accountSummaries"
# Largest page of accountSummaries.list; the pages are followed up to ACCOUNT_SUMMARY_PAGES.
ACCOUNT_SUMMARY_PAGE_SIZE = 200
ACCOUNT_SUMMARY_PAGES = 25
ANALYTICS_DATA_URL = "https://analyticsdata.googleapis.com/v1beta"
URL_INSPECTION_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
# Largest GA4 `runReport` page (docs/18 section 7.2).
GA4_REPORT_ROW_LIMIT = 100_000
# Largest page the API gives (docs/18 section 4.2).
SEARCH_ANALYTICS_ROW_LIMIT = 25_000
SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
# Minimum, read-only; `openid email` identify the account (a stable `sub`). Both product scopes
# are asked in one consent: one login is one connection (docs/18 section 3.2).
CONNECT_SCOPES = ("openid", "email", SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE)
# The scope each integration kind needs.
KIND_SCOPES = {"gsc": SEARCH_CONSOLE_SCOPE, "ga4": ANALYTICS_SCOPE}
ATTEMPTS = 3
BACKOFF_SECONDS = 0.5
_VERIFIER_BYTES = 48
_QUOTA_REASONS = frozenset({"quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"})
# The only shape put in the path of a `runReport` call, which carries the access token.
_GA4_PROPERTY = re.compile(r"properties/[0-9]{1,20}")
# `error.status` of a Google API error (the GA4 Data API sets it; the older APIs set `reasons`).
_QUOTA_STATUS = "RESOURCE_EXHAUSTED"
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
    Google issue a refresh token every time, and `include_granted_scopes=false` keeps the grant
    to what is asked here, not to whatever else this login gave the client earlier."""
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


class _PropertySummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(alias="property", pattern=r"^properties/[0-9]+$", max_length=64)
    displayName: str = Field(default="", max_length=512)  # noqa: N815
    propertyType: str = Field(default="PROPERTY_TYPE_UNSPECIFIED", max_length=64)  # noqa: N815


class _AccountSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account: str = Field(pattern=r"^accounts/[0-9]+$", max_length=64)
    displayName: str = Field(default="", max_length=512)  # noqa: N815
    # Left out of the answer for an account with no property.
    propertySummaries: list[_PropertySummary] = Field(default_factory=list)  # noqa: N815


class _AccountSummariesBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    accountSummaries: list[_AccountSummary] = Field(default_factory=list)  # noqa: N815
    nextPageToken: str = ""  # noqa: N815


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


class _Ga4Value(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str


class _Ga4Row(BaseModel):
    model_config = ConfigDict(extra="ignore")

    dimensionValues: list[_Ga4Value]  # noqa: N815 - Google's member name
    metricValues: list[_Ga4Value]  # noqa: N815


class _Ga4QuotaStatus(BaseModel):
    model_config = ConfigDict(extra="ignore")

    remaining: int | None = None


class _Ga4PropertyQuota(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tokensPerHour: _Ga4QuotaStatus = Field(default_factory=_Ga4QuotaStatus)  # noqa: N815


class _Ga4Body(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Left out of the answer when nothing matched.
    rows: list[_Ga4Row] = Field(default_factory=list)
    rowCount: int | None = Field(default=None, ge=0)  # noqa: N815
    propertyQuota: _Ga4PropertyQuota = Field(default_factory=_Ga4PropertyQuota)  # noqa: N815


class _IndexStatus(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Left out of the answer for a page Google has never crawled.
    lastCrawlTime: AwareDatetime | None = None  # noqa: N815 - Google's member name
    coverageState: str | None = Field(default=None, max_length=512)  # noqa: N815


class _InspectionResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    indexStatusResult: _IndexStatus = Field(default_factory=_IndexStatus)  # noqa: N815


class _InspectionBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    inspectionResult: _InspectionResult  # noqa: N815


@dataclass(frozen=True, slots=True)
class UrlInspection:
    """What `urlInspection.index.inspect` says of a page: when Google last crawled it (UTC, None
    when it never did) and the coverage state in Google's words."""

    last_crawl_time: datetime | None
    coverage_state: str | None


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
class Ga4Row:
    """One row of a GA4 report: the dimension and metric values in the order requested. GA4
    writes every value as a string; the caller converts."""

    dimensions: tuple[str, ...]
    metrics: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Ga4Report:
    """One page of `runReport`. `row_count` is the rows of the whole report, for paging;
    `quota_remaining` is the hourly tokens the property has left, None when Google did not say."""

    rows: tuple[Ga4Row, ...]
    row_count: int
    quota_remaining: int | None


@dataclass(frozen=True, slots=True)
class Site:
    site_url: str
    # siteOwner, siteFullUser, siteRestrictedUser or siteUnverifiedUser; a new one is passed on.
    permission_level: str


@dataclass(frozen=True, slots=True)
class AnalyticsProperty:
    """One GA4 property from `accountSummaries.list`, with the account it sits under."""

    name: str  # `properties/123`
    display_name: str
    # PROPERTY_TYPE_ORDINARY, PROPERTY_TYPE_SUBPROPERTY or PROPERTY_TYPE_ROLLUP; a new one is
    # passed on.
    property_type: str
    account: str  # `accounts/456`
    account_name: str


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

    async def list_analytics_properties(self, access_token: str) -> list[AnalyticsProperty]:
        """Every GA4 property the account can see, by account (Analytics Admin API v1beta,
        `accountSummaries.list`). Follows `nextPageToken`, at most `ACCOUNT_SUMMARY_PAGES`
        pages."""
        found: list[AnalyticsProperty] = []
        token = ""
        for _ in range(ACCOUNT_SUMMARY_PAGES):
            params = {"pageSize": str(ACCOUNT_SUMMARY_PAGE_SIZE)}
            if token:
                params["pageToken"] = token
            response = await self._send(
                "GET", ACCOUNT_SUMMARIES_URL, headers=_bearer(access_token), params=params
            )
            _raise_for_api(response)
            body = _parse(_AccountSummariesBody, response)
            found.extend(
                AnalyticsProperty(
                    name=prop.name,
                    display_name=prop.displayName,
                    property_type=prop.propertyType,
                    account=summary.account,
                    account_name=summary.displayName,
                )
                for summary in body.accountSummaries
                for prop in summary.propertySummaries
            )
            token = body.nextPageToken
            if not token:
                return found
        raise GoogleResponseError("accountSummaries has more pages than this client follows")

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

    async def inspect_url(
        self, access_token: str, *, site_url: str, page_url: str
    ) -> UrlInspection:
        """`urlInspection.index.inspect` for one page of a property (2,000 a day and 600 a minute
        per property). A page Google never crawled has no `lastCrawlTime`: that is None, not an
        error."""
        response = await self._send(
            "POST",
            URL_INSPECTION_URL,
            headers=_bearer(access_token),
            json={"inspectionUrl": page_url, "siteUrl": site_url},
        )
        _raise_for_api(response)
        status = _parse(_InspectionBody, response).inspectionResult.indexStatusResult
        crawled = status.lastCrawlTime
        return UrlInspection(
            last_crawl_time=None if crawled is None else crawled.astimezone(UTC),
            coverage_state=status.coverageState,
        )

    async def run_report(
        self,
        access_token: str,
        property: str,
        *,
        start_date: date,
        end_date: date,
        dimensions: Sequence[str],
        metrics: Sequence[str],
        offset: int = 0,
        limit: int = GA4_REPORT_ROW_LIMIT,
    ) -> Ga4Report:
        """One page of GA4 `properties.runReport` (docs/18 section 7.2). Dates are in the
        property's time zone. An empty page is the end of the report; the caller pages with
        `offset` until it has `row_count` rows. Asks for the property quota (section 7.5)."""
        if _GA4_PROPERTY.fullmatch(property) is None:
            raise ValueError("a GA4 property is written `properties/` and its number")
        response = await self._send(
            "POST",
            f"{ANALYTICS_DATA_URL}/{property}:runReport",
            headers=_bearer(access_token),
            json={
                "dateRanges": [
                    {"startDate": start_date.isoformat(), "endDate": end_date.isoformat()}
                ],
                "dimensions": [{"name": name} for name in dimensions],
                "metrics": [{"name": name} for name in metrics],
                # GA4 takes the paging members as strings (int64 in its JSON mapping).
                "offset": str(offset),
                "limit": str(limit),
                "returnPropertyQuota": True,
            },
        )
        _raise_for_api(response)
        body = _parse(_Ga4Body, response)
        if any(
            len(row.dimensionValues) != len(dimensions) or len(row.metricValues) != len(metrics)
            for row in body.rows
        ):
            raise GoogleResponseError("a row does not carry the requested dimensions and metrics")
        return Ga4Report(
            rows=tuple(
                Ga4Row(
                    dimensions=tuple(v.value for v in row.dimensionValues),
                    metrics=tuple(v.value for v in row.metricValues),
                )
                for row in body.rows
            ),
            row_count=len(body.rows) if body.rowCount is None else body.rowCount,
            quota_remaining=body.propertyQuota.tokensPerHour.remaining,
        )

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
    return (
        bool(reasons & _QUOTA_REASONS) or error.get("status") == _QUOTA_STATUS or "quota" in message
    )
