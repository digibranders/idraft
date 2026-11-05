"""A stand-in for Google's OAuth, userinfo, Search Console and revoke endpoints.

It is an `httpx.MockTransport` handler, so the code under test makes its real calls and nothing
leaves the process. It checks what the real services check: the client id and secret, the
redirect address, the PKCE verifier against the challenge, that a code works once, and that a
revoked refresh token is dead. Every value is an obvious fake.
"""

from __future__ import annotations

import base64
import hashlib
import itertools
from dataclasses import dataclass, field
from urllib.parse import parse_qs

import httpx

from idraft.providers.google.client import (
    REVOKE_URL,
    SEARCH_CONSOLE_SCOPE,
    SITES_URL,
    TOKEN_URL,
    USERINFO_URL,
)

CLIENT_ID = "fake-client-id.apps.googleusercontent.com"
CLIENT_SECRET = "fake-client-secret"
ALL_SCOPES = ("openid", "email", SEARCH_CONSOLE_SCOPE)


@dataclass
class Account:
    sub: str
    email: str
    sites: list[tuple[str, str]] = field(default_factory=list)
    refresh_token: str = ""


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


class FakeGoogle:
    def __init__(self, redirect_uri: str) -> None:
        self.redirect_uri = redirect_uri
        self.calls: list[Call] = []
        self.transport = httpx.MockTransport(self._handle)
        # Switches for the failures a test wants.
        self.token_outage = 0  # answer 503 this many times first
        self.sites_status: int | None = None
        self.sites_body: dict[str, object] | None = None
        self.revoke_status = 200
        self._numbers = itertools.count(1)
        self._codes: dict[str, _Code] = {}
        self._access: dict[str, Account] = {}
        self._refresh: dict[str, Account] = {}

    def account(self, email: str, sites: list[tuple[str, str]] | None = None) -> Account:
        number = next(self._numbers)
        account = Account(
            sub=f"1000{number}",
            email=email,
            sites=sites or [],
            refresh_token=f"1//fake-rt-{number}",
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
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        authorization = request.headers.get("authorization")
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
