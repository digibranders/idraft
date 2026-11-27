"""The fake Search Console's filtered reads: what it serves, refuses and counts."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Literal

import httpx
import pytest

from idraft.providers.google.client import AnalyticsRow, DimensionFilter, GoogleClient
from idraft.providers.google.errors import GoogleResponseError
from tests.collectors.gsc_support import SITE, FakeSearchConsole
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET

PAGE = "https://example.com/pricing"
PAGE_FILTER = DimensionFilter("page", "equals", PAGE)
QUERY_FILTER = DimensionFilter("query", "includingRegex", "crm")


async def _no_wait(seconds: float) -> None:
    return None


async def _session() -> tuple[FakeSearchConsole, GoogleClient, str]:
    fake = FakeSearchConsole()
    account = fake.account("person@example.com", [(SITE, "siteOwner")])
    google = GoogleClient(
        httpx.AsyncClient(transport=fake.transport),
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        sleep=_no_wait,
        jitter=lambda: 0.0,
    )
    token = await google.refresh(account.refresh_token)
    return fake, google, token.access_token


def _filtered_row(day: date, query: str, clicks: int) -> dict[str, Any]:
    return {"keys": [day.isoformat(), query], "clicks": clicks, "impressions": 10, "position": 2.0}


async def _read(
    google: GoogleClient,
    token: str,
    fake: FakeSearchConsole,
    **changes: Any,
) -> list[AnalyticsRow]:
    options: dict[str, Any] = {
        "start_date": fake.final_through - timedelta(days=2),
        "end_date": fake.final_through + timedelta(days=2),
        "dimensions": ("date", "query"),
        "filters": (PAGE_FILTER,),
    }
    return await google.search_analytics(token, SITE, **{**options, **changes})


async def test_a_day_after_the_final_days_is_served_to_all_data_only() -> None:
    fake, google, token = await _session()
    final = fake.final_through
    days = [final - timedelta(days=1), final, final + timedelta(days=1)]
    fake.set_filtered(
        SITE, ("date", "query"), [_filtered_row(day, "crm", n) for n, day in enumerate(days)]
    )

    states: dict[Literal["final", "all"], list[str]] = {}
    for state in ("final", "all"):
        rows = await _read(google, token, fake, data_state=state)
        states[state] = [row.keys[0] for row in rows]

    assert states["final"] == [days[0].isoformat(), days[1].isoformat()]
    assert states["all"] == [day.isoformat() for day in days]


async def test_a_page_filter_with_property_aggregation_is_refused_and_a_query_filter_is_not() -> (
    None
):
    fake, google, token = await _session()
    fake.set_filtered(SITE, ("date", "query"), [_filtered_row(fake.final_through, "crm", 1)])

    with pytest.raises(GoogleResponseError, match="400"):
        await _read(google, token, fake, aggregation="byProperty")
    # A page filter among others is still a page filter.
    with pytest.raises(GoogleResponseError, match="400"):
        await _read(
            google, token, fake, aggregation="byProperty", filters=(QUERY_FILTER, PAGE_FILTER)
        )

    rows = await _read(google, token, fake, aggregation="byProperty", filters=(QUERY_FILTER,))
    assert [row.clicks for row in rows] == [1]


async def test_rows_are_paged_with_start_row_and_row_limit() -> None:
    fake, google, token = await _session()
    days = [fake.final_through - timedelta(days=back) for back in range(4)]
    fake.set_filtered(
        SITE, ("date", "query"), [_filtered_row(day, "crm", n) for n, day in enumerate(days)]
    )

    window = {"start_date": days[-1]}
    first = await _read(google, token, fake, start_row=0, row_limit=3, **window)
    second = await _read(google, token, fake, start_row=3, row_limit=3, **window)
    beyond = await _read(google, token, fake, start_row=6, row_limit=3, **window)

    assert [row.clicks for row in first] == [0, 1, 2]
    assert [row.clicks for row in second] == [3]
    assert beyond == []


async def test_only_a_filtered_read_counts_as_filtered() -> None:
    fake, google, token = await _session()
    fake.set_filtered(SITE, ("date", "query"), [_filtered_row(fake.final_through, "crm", 1)])

    await _read(google, token, fake)
    await _read(google, token, fake, dimensions=("date", "page"), filters=())
    await _read(google, token, fake, dimensions=("date", "query", "country"), filters=())

    assert len(fake.filtered_requests()) == 1
    assert len(fake.filtered_requests("sc-domain:other.example")) == 0
    assert len(fake.page_requests()) == 1
    assert len(fake.detail_requests()) == 1


async def test_a_position_set_for_a_page_is_the_one_the_date_page_read_serves() -> None:
    fake, google, token = await _session()
    day = fake.final_through
    fake.set_day(SITE, day, [])
    fake.set_page_day(SITE, day, [(PAGE, 4, 40), ("https://example.com/other", 1, 10)])
    fake.page_positions[PAGE] = 7.5

    rows = await _read(google, token, fake, dimensions=("date", "page"), filters=())

    assert {row.keys[1]: row.position for row in rows} == {
        PAGE: 7.5,
        "https://example.com/other": 3.0,
    }
