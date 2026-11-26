"""The page search routes (plan 01 task 9, spec sections 7.2 and 9): one page's totals, health and
daily series, and its breakdowns by query, country and device. A page whose history or breakdown
was never fetched is fetched from a fake Search Console, once; nothing here reaches Google."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import date
from typing import Any

import httpx
import pytest

from idraft.api.fp import page_routes
from idraft.api.fp.live import LiveGoogle, live_google
from idraft.api.resources import Resources
from idraft.collectors.gsc_limits import GscLimiter
from idraft.config.settings import Settings
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.fp.pages_support import (
    FINAL,
    connect,
    days,
    marker,
    seed_pages,
    track,
    uncrawled_url,
)
from tests.api.integrations.support import Harness, running
from tests.api.keywords.support import project_url
from tests.api.workspaces.support import make_project
from tests.collectors.gsc_support import SITE, FakeSearchConsole
from tests.conftest import PostgresServer

OCT, SEP = date(2026, 10, 1), date(2026, 9, 1)
OCT_END, SEP_END = date(2026, 10, 31), date(2026, 9, 30)
HISTORY_START = date(2025, 7, 28)
OCTOBER = {"from": "2026-10-01", "to": "2026-10-31"}
World = tuple[Workspace, uuid.UUID, Caller, FakeSearchConsole]


@pytest.fixture
async def google(app_settings: Settings, migrated: PostgresServer) -> AsyncIterator[Harness]:
    """The application with Google configured, talking to a fake Search Console."""
    async with running(app_settings, migrated, FakeSearchConsole()) as harness:
        yield harness


@pytest.fixture
def limiter(monkeypatch: pytest.MonkeyPatch) -> GscLimiter:
    """The budget of the routes' Google caller, a fresh one for the test."""
    shared = GscLimiter()

    def build(resources: Resources, facts: Any) -> LiveGoogle | None:
        built = live_google(resources, facts)
        return None if built is None else replace(built, limiter=shared)

    monkeypatch.setattr(page_routes, "live_google", build)
    return shared


def spend(limiter: GscLimiter) -> None:
    """Take every token of the property's budget."""
    while limiter.try_acquire(user="someone", site=SITE) == 0.0:
        pass


async def world(h: Harness, role: str = "owner") -> World:
    fake = h.fake
    assert isinstance(fake, FakeSearchConsole)
    fake.final_through = FINAL
    workspace = await make_workspace(h.pg)
    caller = await member(h.resources, h.pg, workspace, role)
    return workspace, await make_project(h.pg, workspace.id), caller, fake


async def get(
    h: Harness,
    w: World,
    *parts: object,
    **params: str,
) -> httpx.Response:
    workspace, project_id, caller, _ = w
    return await h.api.get(
        project_url(workspace, project_id, "fp", "page-search", *parts),
        params=params,
        headers=caller.headers,
    )


async def breakdown(
    h: Harness, w: World, page: int, dimension: str, **params: str
) -> httpx.Response:
    """The breakdown of October, compared with the month before unless `params` say otherwise."""
    return await get(h, w, page, "breakdown", dimension=dimension, **{**OCTOBER, **params})


async def pricing(h: Harness, w: World, *, ready: bool = True) -> tuple[uuid.UUID, int]:
    """A `/pricing` with the October and September numbers of spec section 7.2: 317 and 412
    clicks, 41,200 and 39,600 impressions, positions 5.9 and 3.8."""
    workspace, project, _, fake = w
    integration = await connect(h.pg, workspace, project, fake=fake)
    page = (await seed_pages(h.pg, workspace, project, {"/pricing": "Pricing"}))["/pricing"]
    await days(
        h.pg, workspace, project, integration, page, OCT,
        [10] * 30 + [17], [1329] * 30 + [1330], "5.9",
    )  # fmt: skip
    await days(
        h.pg, workspace, project, integration, page, SEP,
        [13] * 29 + [35], [1320] * 30, "3.8",
    )  # fmt: skip
    if ready:
        await marker(h.pg, workspace, project, integration, page, "history", HISTORY_START, FINAL)
    return integration, page


def rows_of(keys: dict[str, tuple[int, int, float]]) -> list[dict[str, Any]]:
    return [
        {"keys": [key], "clicks": clicks, "impressions": impressions, "position": position}
        for key, (clicks, impressions, position) in keys.items()
    ]


async def test_a_page_with_stored_history_answers_without_asking_google(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    workspace, project, _, fake = w
    _, page = await pricing(google, w)
    await track(google.pg, workspace, project, [page])

    response = await get(google, w, page)

    assert response.status_code == 200, response.text
    body = response.json()
    data = body["data"]
    assert (data["url_id"], data["path"], data["title"], data["tier_id"]) == (
        str(page),
        "/pricing",
        "Pricing",
        None,
    )
    assert data["url"] == "https://example.com/pricing"
    assert data["tracked"] is True
    assert (data["current"]["clicks"], data["current"]["impressions"]) == (317, 41200)
    assert data["previous"]["clicks"] == 412
    assert data["health"]["verdict"] == "declining"
    assert data["health"]["flags"] == ["position_slipped"]
    assert len(data["series"]) == 31
    assert len(data["previous_series"]) == 30
    assert data["previous_series"][0]["date"] == "2026-09-01"
    assert body["meta"]["state"] == "ok"
    assert body["meta"]["window"] == {"from": "2026-10-01", "to": "2026-10-31", "days": 31}
    assert body["meta"]["compare_window"] == {"from": "2026-09-01", "to": "2026-09-30", "days": 30}
    assert body["meta"]["history_from"] == "2025-07-28"
    assert body["meta"]["retry_after"] is None
    assert fake.requests == []


async def test_a_day_without_a_row_is_zero_with_no_position(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    workspace, project, _, fake = w
    integration = await connect(google.pg, workspace, project, fake=fake)
    page = (await seed_pages(google.pg, workspace, project, {"/p": None}))["/p"]
    await days(
        google.pg, workspace, project, integration, page, OCT, [10, 0, 5], [100, 50, 20], "4.0"
    )
    await marker(google.pg, workspace, project, integration, page, "history", HISTORY_START, FINAL)

    response = await get(google, w, page, compare="none", **OCTOBER)

    body = response.json()
    series = body["data"]["series"]
    assert len(series) == 31
    assert series[0] == {
        "date": "2026-10-01",
        "clicks": 10,
        "impressions": 100,
        "position": pytest.approx(4.0),
    }
    assert series[3] == {"date": "2026-10-04", "clicks": 0, "impressions": 0, "position": None}
    assert body["data"]["previous"] is None
    assert body["data"]["previous_series"] == []
    assert body["meta"]["compare_window"] is None


async def test_the_first_open_fetches_the_history_then_answers_from_it(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    workspace, project, _, fake = w
    await connect(google.pg, workspace, project, fake=fake)
    page = (await seed_pages(google.pg, workspace, project, {"/pricing": "Pricing"}))["/pricing"]
    fake.set_filtered(
        SITE,
        ("date",),
        [
            {"keys": ["2026-10-01"], "clicks": 4, "impressions": 40, "position": 2.0},
            {"keys": ["2026-10-02"], "clicks": 5, "impressions": 50, "position": 3.0},
        ],
    )

    first = await get(google, w, page, compare="none", **OCTOBER)

    assert first.status_code == 200, first.text
    body = first.json()
    assert body["meta"]["history_from"] is not None
    assert [point["clicks"] for point in body["data"]["series"][:3]] == [4, 5, 0]
    assert body["data"]["series"][0]["position"] == pytest.approx(2.0)
    assert body["data"]["current"]["clicks"] == 9
    assert len(fake.filtered_requests(SITE)) == 1

    second = await get(google, w, page, compare="none", **OCTOBER)

    assert second.json()["data"]["current"]["clicks"] == 9
    assert len(fake.filtered_requests(SITE)) == 1


async def test_a_first_open_that_cannot_reach_google_answers_200_with_no_numbers(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    _, page = await pricing(google, w, ready=False)
    spend(limiter)

    response = await get(google, w, page)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["meta"]["history_from"] is None
    assert body["meta"]["retry_after"] >= 1
    data = body["data"]
    assert (data["current"], data["previous"], data["health"]) == (None, None, None)
    assert (data["series"], data["previous_series"]) == ([], [])
    assert w[3].requests == []


async def test_a_page_outside_the_project_is_not_found(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    workspace, project, _, fake = w
    await connect(google.pg, workspace, project, fake=fake)
    await seed_pages(google.pg, workspace, project, {"/pricing": None})
    elsewhere = await uncrawled_url(google.pg, "/elsewhere")
    other = await world(google)
    await connect(google.pg, other[0], other[1], fake=fake)
    foreign = (await seed_pages(google.pg, other[0], other[1], {"/pricing": None}))["/pricing"]

    for url_id in (elsewhere, 999_999_999_999):
        assert problem(await get(google, w, url_id)) == (404, "not_found")
        assert problem(await breakdown(google, w, url_id, "query")) == (404, "not_found")
    # A page of another workspace, asked through that workspace's project and this caller.
    crossed = (workspace, other[1], w[2], fake)
    assert problem(await get(google, crossed, foreign)) == (404, "not_found")
    assert fake.requests == []


async def test_not_connected_and_pending_answer_200_with_no_numbers(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    workspace, project, _, fake = w
    page = (await seed_pages(google.pg, workspace, project, {"/pricing": None}))["/pricing"]

    bare = await get(google, w, page)

    assert bare.status_code == 200, bare.text
    assert bare.json()["meta"]["state"] == "not_connected"
    assert bare.json()["meta"]["window"] is None
    assert bare.json()["data"]["current"] is None
    assert bare.json()["data"]["series"] == []

    await connect(google.pg, workspace, project, window_end=None, recent_done=False, fake=fake)

    pending = await get(google, w, page)
    rows = await breakdown(google, w, page, "country")

    assert pending.json()["meta"]["state"] == "pending"
    assert pending.json()["meta"]["final_through"] is None
    assert pending.json()["data"]["current"] is None
    assert rows.status_code == 200, rows.text
    assert rows.json()["data"] == []
    assert rows.json()["meta"]["state"] == "pending"
    assert fake.requests == []


async def test_a_breakdown_is_fetched_once_and_served_from_the_store(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    fake = w[3]
    _, page = await pricing(google, w)
    fake.set_filtered(
        SITE,
        ("country",),
        rows_of({"usa": (120, 14100, 5.7), "ind": (88, 9000, 6.2)}),
        period=(OCT, OCT_END),
    )
    fake.set_filtered(
        SITE,
        ("country",),
        rows_of({"ind": (201, 9400, 3.1), "gbr": (10, 100, 4.0)}),
        period=(SEP, SEP_END),
    )

    response = await breakdown(google, w, page, "country")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["key"] for row in body["data"]] == ["USA", "IND", "GBR"]
    usa, ind, gbr = body["data"]
    assert usa["previous"] is None
    assert gbr["current"] is None
    assert ind["current"]["clicks"] == 88
    assert ind["current"]["ctr"] == pytest.approx(88 / 9000)
    assert ind["current"]["position"] == pytest.approx(6.2)
    assert ind["previous"]["position"] == pytest.approx(3.1)
    assert body["meta"]["dimension"] == "country"
    assert body["meta"]["row_limit"] == 50
    assert body["meta"]["truncated"] is False
    assert body["meta"]["fetched_at"] is not None
    sent = fake.filtered_requests(SITE)
    assert [request["dimensions"] for request in sent] == [["country"], ["country"]]
    assert {request["startDate"] for request in sent} == {"2026-10-01", "2026-09-01"}

    again = await breakdown(google, w, page, "country")

    assert again.json()["data"] == body["data"]
    assert len(fake.filtered_requests(SITE)) == 2


async def test_the_query_breakdown_asks_for_25000_rows_and_serves_the_top_100(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    fake = w[3]
    _, page = await pricing(google, w)
    fake.set_filtered(
        SITE, ("query",), rows_of({f"query {n:03d}": (200 - n, 1000, 4.0) for n in range(130)})
    )

    response = await breakdown(google, w, page, "query", compare="none")

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["data"]) == 100
    assert body["data"][0]["key"] == "query 000"
    assert body["meta"]["row_limit"] == 100
    assert body["meta"]["truncated"] is True
    (sent,) = fake.filtered_requests(SITE)
    assert (sent["rowLimit"], sent["startRow"]) == (25_000, 0)
    stored = await fetchrow(
        google.pg,
        "SELECT query_count, query_count_capped FROM fp.gsc_page_fetches "
        "WHERE url_id = $1 AND kind = 'query'",
        page,
    )
    assert (stored["query_count"], stored["query_count_capped"]) == (130, False)

    await breakdown(google, w, page, "query", compare="none")

    assert len(fake.filtered_requests(SITE)) == 1


async def test_coverage_is_the_rows_clicks_over_the_page_s_clicks(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    workspace, project, _, fake = w
    integration = await connect(google.pg, workspace, project, fake=fake)
    ids = await seed_pages(google.pg, workspace, project, {"/busy": None, "/quiet": None})
    await days(google.pg, workspace, project, integration, ids["/busy"], OCT, [100], [1000], "5.0")
    await days(google.pg, workspace, project, integration, ids["/quiet"], OCT, [0], [10], "5.0")
    fake.set_filtered(
        SITE, ("query",), rows_of({"a": (50, 500, 4.0), "b": (30, 300, 5.0), "c": (8, 80, 6.0)})
    )

    busy = await breakdown(google, w, ids["/busy"], "query", compare="none")
    quiet = await breakdown(google, w, ids["/quiet"], "query", compare="none")

    assert busy.json()["meta"]["coverage"] == pytest.approx(0.88)
    assert quiet.json()["meta"]["coverage"] is None


async def test_a_breakdown_that_cannot_be_fetched_is_429_gsc_busy_with_retry_after(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    _, page = await pricing(google, w)
    spend(limiter)

    response = await breakdown(google, w, page, "device")

    assert problem(response) == (429, "gsc_busy")
    assert int(response.headers["Retry-After"]) >= 1
    assert response.json()["retry_after_seconds"] == int(response.headers["Retry-After"])
    assert w[3].requests == []


async def test_a_stored_breakdown_is_served_when_the_budget_is_spent(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    fake = w[3]
    _, page = await pricing(google, w)
    fake.set_filtered(
        SITE, ("device",), rows_of({"mobile": (30, 300, 4.0), "desktop": (20, 200, 5.0)})
    )
    fetched = await breakdown(google, w, page, "device", compare="none")
    spend(limiter)

    again = await breakdown(google, w, page, "device", compare="none")

    assert again.status_code == 200, again.text
    assert again.json()["data"] == fetched.json()["data"]
    assert [row["key"] for row in again.json()["data"]] == ["MOBILE", "DESKTOP"]
    assert len(fake.filtered_requests(SITE)) == 1


async def test_reauth_required_serves_stored_breakdowns_and_fetches_nothing(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    fake = w[3]
    integration, page = await pricing(google, w)
    fake.set_filtered(
        SITE, ("country",), rows_of({"usa": (120, 14100, 5.7)}), period=(OCT, OCT_END)
    )
    stored = await breakdown(google, w, page, "country", compare="none")
    await execute(
        google.pg,
        "UPDATE fp.connections SET status = 'reauth_required' "
        "WHERE id = (SELECT connection_id FROM fp.integrations WHERE id = $1)",
        integration,
    )

    served = await breakdown(google, w, page, "country", compare="none")
    unstored = await breakdown(
        google, w, page, "country", compare="none", **{"from": "2026-09-01", "to": "2026-09-30"}
    )

    assert served.json()["meta"]["state"] == "reauth_required"
    assert served.json()["data"] == stored.json()["data"]
    assert unstored.status_code == 200, unstored.text
    assert unstored.json()["data"] == []
    assert unstored.json()["meta"]["state"] == "reauth_required"
    assert len(fake.filtered_requests(SITE)) == 1


async def test_a_refused_property_answers_stored_rows_and_a_server_error_is_503(
    google: Harness, limiter: GscLimiter
) -> None:
    w = await world(google)
    fake = w[3]
    _, page = await pricing(google, w, ready=False)
    fake.statuses[SITE] = 403

    detail = await get(google, w, page)
    rows = await breakdown(google, w, page, "query")

    assert detail.status_code == 200, detail.text
    assert detail.json()["meta"]["state"] == "no_access"
    assert detail.json()["data"]["current"] is None
    assert rows.json()["meta"]["state"] == "no_access"
    assert rows.json()["data"] == []

    fake.statuses[SITE] = 500
    detail = await get(google, w, page)
    rows = await breakdown(google, w, page, "query")

    assert detail.status_code == 200, detail.text
    assert detail.json()["data"]["current"] is None
    assert detail.json()["meta"]["retry_after"] is None
    assert problem(rows) == (503, "google_unavailable")


async def test_an_unknown_dimension_is_422(google: Harness, limiter: GscLimiter) -> None:
    w = await world(google)
    _, page = await pricing(google, w)

    response = await breakdown(google, w, page, "page")

    assert problem(response) == (422, "validation_failed")


async def test_a_window_over_92_days_is_refused(google: Harness, limiter: GscLimiter) -> None:
    w = await world(google)
    _, page = await pricing(google, w)

    response = await get(google, w, page, **{"from": "2026-07-01", "to": "2026-10-31"})

    assert problem(response) == (422, "window_too_large")
