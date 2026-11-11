"""Helpers for the Search Console pull tests: a fake Search Console that serves stored days the way
`searchAnalytics.query` does, and properties (workspace, project, connection, integration) to
pull."""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import unquote

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_limits import Budgets, GscLimiter
from idraft.collectors.gsc_sync import SyncContext, pacific_today
from idraft.providers.google.client import GoogleClient
from idraft.vault.envelope import EnvelopeCipher
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import TEST_SECRETS_KEY, PostgresServer
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET, Account, FakeGoogle

CIPHER = EnvelopeCipher({1: base64.b64decode(TEST_SECRETS_KEY.get_secret_value())})
SITE = "sc-domain:acme.example"
REDIRECT = "https://app.example.com/api/v1/oauth/google/callback"


def now() -> datetime:
    return datetime.now(UTC)


def today() -> date:
    return pacific_today(now())


@dataclass(frozen=True)
class Row:
    query: str
    country: str
    device: str
    clicks: int
    impressions: int
    position: float = 5.0


def crm_rows(extra: int = 0) -> list[Row]:
    """A day of detail, over all pages: one query written two ways, two devices, two countries,
    and a second query. `extra` raises the clicks, so two days differ."""
    return [
        Row("crm software", "usa", "DESKTOP", 3 + extra, 40, 4.0),
        Row("CRM  Software", "usa", "DESKTOP", 1, 10, 6.0),
        Row("crm software", "usa", "MOBILE", 2, 30, 5.0),
        Row("crm software", "gbr", "DESKTOP", 0, 5, 9.0),
        Row("erp", "usa", "DESKTOP", 7, 90, 2.5),
    ]


class FakeSearchConsole(FakeGoogle):
    """Google as the pull sees it: tokens, and `searchAnalytics.query` over days a test sets.

    A day after `final_through` is served only to a request for `dataState: all`.
    """

    def __init__(self) -> None:
        super().__init__(REDIRECT)
        self.days: dict[str, dict[date, list[Row]]] = {}
        self.final_through: date = today() - timedelta(days=3)
        self.requests: list[tuple[str, dict[str, Any]]] = []
        # Answer these properties with these statuses, instead of numbers.
        self.statuses: dict[str, int] = {}
        # Answer any request after this many with a quota error.
        self.quota_after: int | None = None
        self.malformed = False

    def set_day(self, site: str, day: date, rows: list[Row]) -> None:
        self.days.setdefault(site, {})[day] = rows

    def detail_requests(self, site: str | None = None) -> list[dict[str, Any]]:
        return [
            body
            for requested, body in self.requests
            if len(body["dimensions"]) > 1 and (site is None or requested == site)
        ]

    def detail_days(self, site: str | None = None) -> list[str]:
        return [body["startDate"] for body in self.detail_requests(site) if body["startRow"] == 0]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if "/searchAnalytics/query" not in request.url.raw_path.decode():
            return super()._handle(request)
        return self._analytics(request)

    def _analytics(self, request: httpx.Request) -> httpx.Response:
        raw = request.url.raw_path.decode()
        site = unquote(raw.split("/sites/", 1)[1].split("/searchAnalytics", 1)[0])
        body: dict[str, Any] = json.loads(request.content)
        account = self._bearer(request.headers.get("authorization"))
        if account is None:
            return httpx.Response(401, json={"error": {"code": 401}})
        self.requests.append((site, body))
        if self.quota_after is not None and len(self.requests) > self.quota_after:
            return httpx.Response(429, json={"error": {"message": "Quota exceeded"}})
        if site in self.statuses:
            return httpx.Response(self.statuses[site], json={"error": {"message": "refused"}})
        if site not in {url for url, _ in account.sites}:
            return httpx.Response(403, json={"error": {"message": "No access"}})
        if self.malformed:
            return httpx.Response(200, json={"rows": [{"keys": ["x"], "clicks": 1}]})
        start, end = date.fromisoformat(body["startDate"]), date.fromisoformat(body["endDate"])
        served = [
            (day, rows)
            for day, rows in sorted(self.days.get(site, {}).items())
            if start <= day <= end and (body["dataState"] == "all" or day <= self.final_through)
        ]
        if body["dimensions"] == ["date"]:
            rows: list[dict[str, Any]] = [
                {
                    "keys": [day.isoformat()],
                    "clicks": sum(r.clicks for r in day_rows),
                    "impressions": sum(r.impressions for r in day_rows),
                    "ctr": 0.1,
                    "position": 4.2,
                }
                for day, day_rows in served
                if day_rows
            ]
        else:
            rows = [
                {
                    "keys": [day.isoformat(), r.query, r.country, r.device],
                    "clicks": float(r.clicks),
                    "impressions": float(r.impressions),
                    "ctr": 0.1,
                    "position": r.position,
                }
                for day, day_rows in served
                for r in day_rows
            ]
            rows = rows[body["startRow"] : body["startRow"] + body["rowLimit"]]
        return httpx.Response(200, json={"rows": rows} if rows else {})


@dataclass(frozen=True)
class Property:
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    connection_id: uuid.UUID
    integration_id: uuid.UUID
    site: str
    account: Account


async def make_property(
    pg: PostgresServer,
    fake: FakeSearchConsole,
    *,
    workspace: Workspace | None = None,
    site: str = SITE,
    account: Account | None = None,
    connection_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    sites: list[str] | None = None,
) -> Property:
    """A property linked to a project, whose connection holds a refresh token of `account`."""
    workspace = workspace or await make_workspace(pg)
    project_id = project_id or await make_project(pg, workspace.id)
    account = account or fake.account(
        f"person-{uuid.uuid4().hex[:6]}@example.com",
        [(url, "siteOwner") for url in sites or [site]],
    )
    if connection_id is None:
        secret_id = uuid.uuid4()
        sealed = CIPHER.seal(
            account.refresh_token,
            secret_id=secret_id,
            workspace_id=workspace.id,
            kind="oauth_refresh_token",
        )
        await execute(
            pg,
            "INSERT INTO ops.secrets (id, workspace_id, kind, ciphertext, dek_wrapped, "
            "kek_version, fingerprint) VALUES ($1, $2, 'oauth_refresh_token', $3, $4, $5, $6)",
            secret_id,
            workspace.id,
            sealed.ciphertext,
            sealed.dek_wrapped,
            sealed.kek_version,
            sealed.fingerprint,
        )
        row = await fetchrow(
            pg,
            "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
            "subject_label, credential_ref, scopes) "
            "VALUES ($1, 'google', 'oauth', $2, $3, $4, '{openid}') RETURNING id",
            workspace.id,
            account.sub,
            account.email,
            secret_id,
        )
        connection_id = row["id"]
    row = await fetchrow(
        pg,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_account, "
        "external_property, connection_id, scopes) "
        "VALUES ($1, $2, 'gsc', $3, $4, $5, '{openid}') RETURNING id",
        workspace.id,
        project_id,
        account.email,
        site,
        connection_id,
    )
    assert connection_id is not None
    return Property(workspace.id, project_id, connection_id, row["id"], site, account)


def fill(
    fake: FakeSearchConsole,
    site: str,
    *,
    days: int = 40,
    rows: Callable[[int], list[Row]] = lambda n: crm_rows(n % 3),
    skip: frozenset[int] = frozenset(),
) -> list[date]:
    """Serve `days` days that end on the last final day, newest first in `skip`'s numbering
    (0 is the last final day). Returns the days that have rows, oldest first."""
    served: list[date] = []
    for back in range(days):
        if back in skip:
            continue
        day = fake.final_through - timedelta(days=back)
        fake.set_day(site, day, rows(back))
        served.append(day)
    return sorted(served)


def sync_context(
    sessions: async_sessionmaker[AsyncSession],
    fake: FakeSearchConsole,
    **changes: Any,
) -> SyncContext:
    async def no_wait(seconds: float) -> None:
        return None

    google = GoogleClient(
        httpx.AsyncClient(transport=fake.transport),
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        attempts=2,
        sleep=no_wait,
        jitter=lambda: 0.0,
    )
    fields: dict[str, Any] = {
        "sessions": sessions,
        "google": google,
        "cipher": CIPHER,
        "limiter": GscLimiter(Budgets(1e9, 1e9, 1e9), sleep=no_wait),
    }
    return SyncContext(**{**fields, **changes})


async def empty_integrations(pg: PostgresServer) -> None:
    """Remove every connection, property and stored number. The planner looks at every property of
    every workspace, so a test that counts on its own being found starts from none."""
    await execute(
        pg,
        "TRUNCATE fp.gsc_search_analytics, fp.gsc_queries, fp.integrations, fp.connections CASCADE",
    )


async def stored(pg: PostgresServer, integration_id: uuid.UUID) -> list[tuple[Any, ...]]:
    """Every stored row of the integration, in key order, with the query text."""
    rows = await fetch(
        pg,
        "SELECT a.metric_date, q.query_text, q.normalized_text, a.url_id, a.country_iso3, "
        "a.device, a.clicks, a.impressions, a.position_sum, a.data_state, a.search_type "
        "FROM fp.gsc_search_analytics a JOIN fp.gsc_queries q "
        "ON q.workspace_id = a.workspace_id AND q.query_hash = a.query_hash "
        "WHERE a.integration_id = $1 ORDER BY 1, 2, 3, 4, 5, 6",
        integration_id,
    )
    return [tuple(row) for row in rows]


async def integration_row(pg: PostgresServer, integration_id: uuid.UUID) -> dict[str, Any]:
    row = await fetchrow(pg, "SELECT * FROM fp.integrations WHERE id = $1", integration_id)
    return {**row, "backfill_state": json.loads(row["backfill_state"])}


def total(rows: list[tuple[Any, ...]], column: int) -> Decimal:
    return sum((Decimal(row[column]) for row in rows), Decimal(0))
