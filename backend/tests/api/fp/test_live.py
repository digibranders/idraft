"""The API's own way to call Search Console for one page (plan 01 task 7, spec decision D5)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import date, timedelta
from typing import Any

import pytest

from idraft.api.fp.live import (
    QUOTA_RETRY_SECONDS,
    GscBusyError,
    LiveGoogle,
    LiveStateError,
    live_google,
)
from idraft.api.problems import ServiceUnavailableError
from idraft.collectors import gsc_store
from idraft.collectors.gsc_limits import Budgets, GscLimiter
from idraft.config.settings import Settings
from idraft.db.engine import workspace_transaction
from idraft.providers.google.client import TOKEN_URL, DimensionFilter
from tests.api.integrations.support import Harness, running
from tests.collectors.gsc_support import SITE, FakeSearchConsole, Property, make_property
from tests.conftest import PostgresServer

PAGE_ONLY = (DimensionFilter("page", "includingRegex", "^https://acme\\.example/pricing$"),)
ROWS = [
    {"keys": ["2026-11-01"], "clicks": 4, "impressions": 40, "position": 2.0},
    {"keys": ["2026-11-02"], "clicks": 5, "impressions": 50, "position": 3.0},
]


class WatchedLimiter(GscLimiter):
    """A limiter that says which properties were slowed down."""

    def __init__(self) -> None:
        super().__init__()
        self.slowed: list[str] = []

    def quota_exceeded(self, *, site: str) -> None:
        self.slowed.append(site)
        super().quota_exceeded(site=site)


@pytest.fixture
async def google(app_settings: Settings, migrated: PostgresServer) -> AsyncIterator[Harness]:
    """The application with Google configured, talking to a fake Search Console."""
    async with running(app_settings, migrated, FakeSearchConsole()) as harness:
        yield harness


async def live(h: Harness, prop: Property, **changes: Any) -> LiveGoogle:
    """The object a request builds for the property, with `changes` on top."""
    async with workspace_transaction(h.resources.sessions, prop.workspace_id) as db:
        facts = await gsc_store.load_integration(db, prop.workspace_id, prop.integration_id, "gsc")
    assert facts is not None
    built = live_google(h.resources, facts)
    assert built is not None
    return replace(built, **changes)


async def read(google: LiveGoogle) -> Any:
    start = date(2026, 11, 1)
    return await google.query(
        start=start,
        end=start + timedelta(days=1),
        dimensions=("date",),
        filters=PAGE_ONLY,
        row_limit=100,
    )


async def test_a_query_calls_search_console_with_the_stored_token(google: Harness) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    fake.set_filtered(SITE, ("date",), ROWS)

    rows = await read(await live(google, prop))

    assert [row.clicks for row in rows] == [4, 5]
    (body,) = fake.filtered_requests(SITE)
    assert body["dataState"] == "final"
    assert body["aggregationType"] == "auto"
    assert body["rowLimit"] == 100


async def test_no_token_left_is_gsc_busy_with_the_wait(google: Harness) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    limiter = GscLimiter(Budgets(site_per_minute=6.0))  # one token, then one every 10 s
    spent = await live(google, prop, limiter=limiter)
    fake.set_filtered(SITE, ("date",), ROWS)
    await read(spent)

    with pytest.raises(GscBusyError) as busy:
        await read(spent)

    assert busy.value.retry_after >= 1
    assert busy.value.headers == {"Retry-After": str(busy.value.retry_after)}
    assert busy.value.status == 429
    assert busy.value.problem_code == "gsc_busy"
    assert len(fake.filtered_requests(SITE)) == 1


async def test_googles_quota_error_is_gsc_busy_and_slows_the_property(google: Harness) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    fake.quota_after = 0
    limiter = WatchedLimiter()

    with pytest.raises(GscBusyError) as busy:
        await read(await live(google, prop, limiter=limiter))

    assert busy.value.retry_after == QUOTA_RETRY_SECONDS
    assert limiter.slowed == [SITE]


async def test_a_refused_refresh_token_is_reauth_and_a_refused_property_is_no_access(
    google: Harness,
) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    fake.set_filtered(SITE, ("date",), ROWS)

    fake.kill_refresh_token(prop.account)
    with pytest.raises(LiveStateError) as dead:
        await read(await live(google, prop))
    assert dead.value.state == "reauth_required"

    other = await make_property(google.pg, fake, site="sc-domain:other.example")
    fake.statuses["sc-domain:other.example"] = 403
    with pytest.raises(LiveStateError) as refused:
        await read(await live(google, other))
    assert refused.value.state == "no_access"


async def test_a_server_error_is_google_unavailable(google: Harness) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    fake.statuses[SITE] = 500

    with pytest.raises(ServiceUnavailableError) as problem:
        await read(await live(google, prop))

    assert problem.value.status == 503
    assert problem.value.problem_code == "google_unavailable"


async def test_the_access_token_is_asked_for_once_per_object(google: Harness) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    fake.set_filtered(SITE, ("date",), ROWS)
    one = await live(google, prop)

    await read(one)
    await read(one)

    assert len(fake.called(TOKEN_URL)) == 1


async def test_without_a_google_client_there_is_no_live_caller(google: Harness) -> None:
    fake = google.fake
    assert isinstance(fake, FakeSearchConsole)
    prop = await make_property(google.pg, fake)
    async with workspace_transaction(google.resources.sessions, prop.workspace_id) as db:
        facts = await gsc_store.load_integration(db, prop.workspace_id, prop.integration_id, "gsc")
    assert facts is not None
    bare = replace(
        google.resources,
        settings=google.resources.settings.model_copy(update={"google_oauth_client_id": None}),
    )

    assert live_google(bare, facts) is None
