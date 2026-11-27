"""A stand-in for Google's OAuth, userinfo, Search Console, Analytics Admin and Data and revoke
endpoints.

It is an `httpx.MockTransport` handler, so the code under test makes its real calls and nothing
leaves the process. It checks what the real services check: the client id and secret, the
redirect address, the PKCE verifier against the challenge, that a code works once, and that a
revoked refresh token is dead. Every value is an obvious fake.
"""

from __future__ import annotations

import base64
import hashlib
import itertools
import json
from dataclasses import dataclass, field
from typing import cast
from urllib.parse import parse_qs

import httpx

from idraft.providers.google.client import (
    ACCOUNT_SUMMARIES_URL,
    ANALYTICS_DATA_URL,
    ANALYTICS_SCOPE,
    REVOKE_URL,
    SEARCH_CONSOLE_SCOPE,
    SITES_URL,
    TOKEN_URL,
    URL_INSPECTION_URL,
    USERINFO_URL,
)

CLIENT_ID = "fake-client-id.apps.googleusercontent.com"
CLIENT_SECRET = "fake-client-secret"
ALL_SCOPES = ("openid", "email", SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE)
# What a person gets when they untick one product on Google's consent page.
SEARCH_CONSOLE_ONLY = ("openid", "email", SEARCH_CONSOLE_SCOPE)
ANALYTICS_ONLY = ("openid", "email", ANALYTICS_SCOPE)
NO_PRODUCT = ("openid", "email")
# One Analytics account with its properties: (account id, account name, [(property id, name,
# type)]).
type AnalyticsAccount = tuple[str, str, list[tuple[str, str, str]]]


@dataclass
class Account:
    sub: str
    email: str
    sites: list[tuple[str, str]] = field(default_factory=list)
    refresh_token: str = ""
    analytics: list[AnalyticsAccount] = field(default_factory=list)


@dataclass
class _Code:
    account: Account
    challenge: str
    scopes: tuple[str, ...]
    with_refresh: bool
    used: bool = False


@dataclass
class Call:
    method: str
    url: str
    form: dict[str, str]
    authorization: str | None
    # The parsed body of a JSON call (`runReport`); None for the form calls.
    json_body: dict[str, object] | None = None


class FakeGoogle:
    def __init__(self, redirect_uri: str) -> None:
        self.redirect_uri = redirect_uri
        self.calls: list[Call] = []
        self.transport = httpx.MockTransport(self._handle)
        # Switches for the failures a test wants.
        self.token_outage = 0  # answer 503 this many times first
        self.sites_status: int | None = None
        self.sites_body: dict[str, object] | None = None
        self.summaries_status: int | None = None
        self.summaries_page_size = 200  # the page size this fake gives, to test the paging
        self.revoke_status = 200
        # The rows `runReport` has per property (`properties/123`): (dimension values, metric
        # values) as the strings GA4 writes, and the hourly tokens it says are left.
        self.ga4_rows: dict[str, list[tuple[tuple[str, ...], tuple[str, ...]]]] = {}
        self.ga4_tokens_remaining = 39_995
        # Answer every `runReport` of a known token with this status, instead of rows.
        self.ga4_status: int | None = None
        # `urlInspection` answers per page address: (lastCrawlTime as Google writes it or None,
        # coverageState). A page not listed is one Google never crawled.
        self.inspections: dict[str, tuple[str | None, str]] = {}
        # Answer every `inspect` of a known token with this status (and body), instead.
        self.inspect_status: int | None = None
        self.inspect_error: dict[str, object] = {"message": "refused"}
        # Answer an `inspect` of these page addresses with this status.
        self.inspect_fail_for: dict[str, int] = {}
        self._numbers = itertools.count(1)
        self._codes: dict[str, _Code] = {}
        self._access: dict[str, Account] = {}
        self._refresh: dict[str, Account] = {}

    def account(
        self,
        email: str,
        sites: list[tuple[str, str]] | None = None,
        analytics: list[AnalyticsAccount] | None = None,
    ) -> Account:
        number = next(self._numbers)
        account = Account(
            sub=f"1000{number}",
            email=email,
            sites=sites or [],
            refresh_token=f"1//fake-rt-{number}",
            analytics=analytics or [],
        )
        self._refresh[account.refresh_token] = account
        return account

    def issue_code(
        self,
        account: Account,
        *,
        challenge: str,
        scopes: tuple[str, ...] = ALL_SCOPES,
        with_refresh: bool = True,
    ) -> str:
        code = f"4/fake-code-{next(self._numbers)}"
        self._codes[code] = _Code(account, challenge, scopes, with_refresh)
        return code

    def renew_refresh_token(self, account: Account) -> None:
        """The account's next grant carries a new refresh token, and the old one stays dead."""
        self._refresh.pop(account.refresh_token, None)
        account.refresh_token = f"1//fake-rt-{next(self._numbers)}"
        self._refresh[account.refresh_token] = account

    def kill_refresh_token(self, account: Account) -> None:
        """As if the person revoked the grant, or Google expired a Testing-status token."""
        self._refresh.pop(account.refresh_token, None)

    def alive(self, account: Account) -> bool:
        return account.refresh_token in self._refresh

    def called(self, url: str) -> list[Call]:
        return [call for call in self.calls if call.url == url]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        authorization = request.headers.get("authorization")
        if url.startswith(ANALYTICS_DATA_URL) and url.endswith(":runReport"):
            return self._run_report(url, authorization, request.content)
        if url == URL_INSPECTION_URL:
            return self._inspect(url, authorization, request.content)
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        self.calls.append(Call(request.method, url, form, authorization))
        if url == TOKEN_URL:
            return self._token(form)
        if url == USERINFO_URL:
            account = self._bearer(authorization)
            if account is None:
                return httpx.Response(401, json={"error": {"code": 401}})
            return httpx.Response(200, json={"sub": account.sub, "email": account.email})
        if url == SITES_URL:
            return self._sites(authorization)
        if url == ACCOUNT_SUMMARIES_URL:
            return self._summaries(authorization, dict(request.url.params))
        if url == REVOKE_URL:
            if self.revoke_status == 200:
                self._refresh.pop(form.get("token", ""), None)
            return httpx.Response(self.revoke_status, json={})
        return httpx.Response(404)

    def _bearer(self, authorization: str | None) -> Account | None:
        return self._access.get((authorization or "").removeprefix("Bearer "))

    def _sites(self, authorization: str | None) -> httpx.Response:
        if self.sites_status is not None:
            return httpx.Response(self.sites_status, json={"error": {"message": "fake"}})
        account = self._bearer(authorization)
        if account is None:
            return httpx.Response(401, json={"error": {"code": 401}})
        if self.sites_body is not None:
            return httpx.Response(200, json=self.sites_body)
        entries = [{"siteUrl": url, "permissionLevel": level} for url, level in account.sites]
        return httpx.Response(200, json={"siteEntry": entries} if entries else {})

    def _summaries(self, authorization: str | None, params: dict[str, str]) -> httpx.Response:
        """The shape of `accountSummaries.list`: accountSummaries[] with propertySummaries[], and
        a nextPageToken while there are more accounts. Accounts without a property have no
        `propertySummaries`."""
        if self.summaries_status is not None:
            return httpx.Response(self.summaries_status, json={"error": {"message": "fake"}})
        account = self._bearer(authorization)
        if account is None:
            return httpx.Response(401, json={"error": {"code": 401}})
        start = int(params.get("pageToken", "0"))
        page = account.analytics[start : start + self.summaries_page_size]
        summaries: list[dict[str, object]] = []
        for account_id, account_name, properties in page:
            summary: dict[str, object] = {
                "name": f"accountSummaries/{account_id}",
                "account": f"accounts/{account_id}",
                "displayName": account_name,
            }
            if properties:
                summary["propertySummaries"] = [
                    {
                        "property": f"properties/{property_id}",
                        "displayName": name,
                        "propertyType": kind,
                        "parent": f"accounts/{account_id}",
                    }
                    for property_id, name, kind in properties
                ]
            summaries.append(summary)
        body: dict[str, object] = {"accountSummaries": summaries} if summaries else {}
        if start + self.summaries_page_size < len(account.analytics):
            body["nextPageToken"] = str(start + self.summaries_page_size)
        return httpx.Response(200, json=body)

    def _inspect(self, url: str, authorization: str | None, content: bytes) -> httpx.Response:
        """The shape of `urlInspection.index.inspect`: `inspectionResult.indexStatusResult` with
        `lastCrawlTime` (left out for a page never crawled) and `coverageState`. The property
        must be one of the account's."""
        body: dict[str, object] = json.loads(content)
        self.calls.append(Call("POST", url, {}, authorization, body))
        account = self._bearer(authorization)
        if account is None:
            return httpx.Response(401, json={"error": {"code": 401, "status": "UNAUTHENTICATED"}})
        if self.inspect_status is not None:
            return httpx.Response(self.inspect_status, json={"error": self.inspect_error})
        failing = self.inspect_fail_for.get(str(body.get("inspectionUrl")))
        if failing is not None:
            return httpx.Response(failing, json={"error": {"message": "refused"}})
        if body.get("siteUrl") not in {site for site, _ in account.sites}:
            return httpx.Response(403, json={"error": {"message": "No access to the property"}})
        crawled, coverage = self.inspections.get(
            str(body.get("inspectionUrl")), (None, "URL is unknown to Google")
        )
        status: dict[str, object] = {"coverageState": coverage, "verdict": "NEUTRAL"}
        if crawled is not None:
            status["lastCrawlTime"] = crawled
        return httpx.Response(200, json={"inspectionResult": {"indexStatusResult": status}})

    def _run_report(self, url: str, authorization: str | None, content: bytes) -> httpx.Response:
        """The shape of GA4 `properties.runReport`: dimensionValues[] and metricValues[] per row,
        `rowCount` of the whole report, the page cut by the string `offset` and `limit`, and the
        quota of the property when asked for. A report with no row has no `rows` member."""
        body: dict[str, object] = json.loads(content)
        self.calls.append(Call("POST", url, {}, authorization, body))
        if self._bearer(authorization) is None:
            return httpx.Response(401, json={"error": {"code": 401, "status": "UNAUTHENTICATED"}})
        if self.ga4_status is not None:
            return httpx.Response(self.ga4_status, json={"error": {"message": "refused"}})
        property_name = url.removeprefix(f"{ANALYTICS_DATA_URL}/").removesuffix(":runReport")
        rows = self.ga4_rows.get(property_name, [])
        names = [
            dimension["name"] for dimension in cast("list[dict[str, str]]", body["dimensions"])
        ]
        if "date" in names:
            # A report holds only the days it was asked for, when it is split by day.
            asked = cast("list[dict[str, str]]", body["dateRanges"])[0]
            first = asked["startDate"].replace("-", "")
            last = asked["endDate"].replace("-", "")
            rows = [row for row in rows if first <= row[0][names.index("date")] <= last]
        offset, limit = int(str(body["offset"])), int(str(body["limit"]))
        answer: dict[str, object] = {"rowCount": len(rows)}
        if rows[offset : offset + limit]:
            answer["rows"] = [
                {
                    "dimensionValues": [{"value": value} for value in dimensions],
                    "metricValues": [{"value": value} for value in metrics],
                }
                for dimensions, metrics in rows[offset : offset + limit]
            ]
        if body.get("returnPropertyQuota") is True:
            answer["propertyQuota"] = {
                "tokensPerHour": {"consumed": 5, "remaining": self.ga4_tokens_remaining}
            }
        return httpx.Response(200, json=answer)

    def _token(self, form: dict[str, str]) -> httpx.Response:
        if self.token_outage > 0:
            self.token_outage -= 1
            return httpx.Response(503, text="unavailable")
        if form.get("client_id") != CLIENT_ID or form.get("client_secret") != CLIENT_SECRET:
            return httpx.Response(401, json={"error": "invalid_client"})
        if form.get("grant_type") == "refresh_token":
            refreshed = self._refresh.get(form.get("refresh_token", ""))
            if refreshed is None:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json=self._grant(refreshed, ALL_SCOPES, with_refresh=False))
        issued = self._codes.get(form.get("code", ""))
        digest = hashlib.sha256(form.get("code_verifier", "").encode()).digest()
        verifier_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        if (
            issued is None
            or issued.used
            or issued.challenge != verifier_challenge
            or form.get("redirect_uri") != self.redirect_uri
        ):
            return httpx.Response(400, json={"error": "invalid_grant"})
        issued.used = True
        return httpx.Response(
            200, json=self._grant(issued.account, issued.scopes, with_refresh=issued.with_refresh)
        )

    def _grant(
        self, account: Account, scopes: tuple[str, ...], *, with_refresh: bool
    ) -> dict[str, object]:
        access = f"ya29.fake-at-{next(self._numbers)}"
        self._access[access] = account
        body: dict[str, object] = {
            "access_token": access,
            "expires_in": 3599,
            "scope": " ".join(scopes),
            "token_type": "Bearer",
        }
        if with_refresh:
            body["refresh_token"] = account.refresh_token
        return body
