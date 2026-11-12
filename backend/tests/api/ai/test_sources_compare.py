"""New sources (plan D2 Task 3; docs/16 C5): with `compare=previous_period` each domain and
page row says how often it was cited in as many days just before the window, 0 when it was not,
and the answer states that window and its answers."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.exceptions import RequestValidationError

from idraft.api.ai.sources import previous_dates
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    FULL_SUPERSEDED,
    GUIDE,
    OWN,
    WIKI,
    Cite,
    World,
    answer,
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute, fetch
from tests.api.entities.support import problem
from tests.collectors.ai_support import OWN_HOST, Prompt, add_prompt
from tests.conftest import PostgresServer

FIRST_MINUTE = timedelta(minutes=1)
LAST_MINUTE = timedelta(hours=23, minutes=59)


def _day(days: int, zone: tzinfo = UTC) -> str:
    return (datetime.now(zone).date() - timedelta(days=days)).isoformat()


def _window() -> dict[str, str]:
    """The last 5 days: 4 days ago to today. The window before is 9 to 5 days ago."""
    return {"from": _day(4), "to": _day(0)}


async def _edge(
    pg: PostgresServer,
    world: World,
    prompt: Prompt,
    days: int,
    offset: timedelta,
    zone: tzinfo = UTC,
) -> int:
    """An answer citing the own page `offset` after the start of the local day `days` before
    today in `zone`: the first or the last minute of a day, where a window begins or ends."""
    day = datetime.now(zone).date() - timedelta(days=days)
    instant = datetime(day.year, day.month, day.day, tzinfo=zone) + offset
    days_ago = (datetime.now(UTC) - instant).total_seconds() / 86400
    return await answer(pg, world, prompt, days_ago=days_ago, cites=[world.own_cite()])


@pytest.fixture
async def world(resources: Resources, migrated: PostgresServer) -> World:
    """One prompt, UTC days. The window is 4 days ago to today, the window before it 9 to 5 days
    ago. In the window: the own page and the guide (1 day ago), the own page (2 days ago and the
    first minute of 4 days ago, where the window begins). In the window before: the own page (6
    days ago), the own page and wiki (7), the own page in the last minute of 5 days ago (where
    it ends, just before the window) and in the first minute of 9 days ago (where it begins).
    The last minute of 10 days ago is before both: no count may hold it."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    own = world.own_cite()
    await answer(migrated, world, prompt, days_ago=1, cites=[own, Cite(GUIDE)])
    await answer(migrated, world, prompt, days_ago=2, cites=[own])
    await _edge(migrated, world, prompt, 4, FIRST_MINUTE)
    await _edge(migrated, world, prompt, 5, LAST_MINUTE)
    await answer(migrated, world, prompt, days_ago=6, cites=[own])
    await answer(migrated, world, prompt, days_ago=7, cites=[own, Cite(WIKI)])
    await _edge(migrated, world, prompt, 9, FIRST_MINUTE)
    await _edge(migrated, world, prompt, 10, LAST_MINUTE)
    return world


async def _get(world: World, api: httpx.AsyncClient, path: str, **params: Any) -> httpx.Response:
    return await api.get(
        world.url("ai", "sources", path),
        params={**_window(), **params},
        headers=world.owner.headers,
    )


async def test_each_domain_says_how_often_it_was_cited_in_the_window_before(
    api: httpx.AsyncClient, world: World
) -> None:
    response = await _get(world, api, "domains", compare="previous_period")

    assert response.status_code == 200, response.text
    rows = {row["registrable_domain"]: row for row in response.json()["data"]}
    # Wiki was cited only before: it is not a row of this window.
    assert set(rows) == {OWN_HOST, "example.org"}
    # In the window: 1 and 2 days ago and the first minute of 4 days ago.
    assert rows[OWN_HOST]["citation_units"] == 3
    # Before it: 6 and 7 days ago, the last minute of 5 days ago and the first minute of 9 days
    # ago. A window one day longer or shorter, or one that cut the first or last day short,
    # changes this count; the answer 10 days ago and the one that starts the window are not in it.
    assert rows[OWN_HOST]["previous"] == {"citation_units": 4, "observations": 4}
    assert rows["example.org"]["previous"] == {"citation_units": 0, "observations": 0}
    meta = response.json()["meta"]
    assert meta["compare_window"]["from"] == _day(9)
    assert meta["compare_window"]["to"] == _day(5)
    assert meta["answers"] == 3
    assert meta["previous_answers"] == 4


async def test_each_page_says_it_too(api: httpx.AsyncClient, world: World) -> None:
    response = await _get(world, api, "pages", compare="previous_period")

    rows = {row["url"]: row["previous"] for row in response.json()["data"]}
    assert rows == {
        OWN: {"citation_units": 4, "observations": 4},
        GUIDE: {"citation_units": 0, "observations": 0},
    }


async def test_no_answer_before_gives_zeros_and_no_previous_answers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """With nothing in the window before every `previous` is 0 and 0 (docs: the plan's Decision
    8), and `meta.previous_answers` of 0 is what tells a client that no data is behind the
    zeros, as opposed to a source that is new in a window that has data before it."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite(), Cite(GUIDE)])
    zeros = {"citation_units": 0, "observations": 0}

    for path in ("domains", "pages"):
        response = await _get(world, api, path, compare="previous_period")

        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["data"]) == 2
        assert all(row["previous"] == zeros for row in body["data"]), body["data"]
        assert body["meta"]["answers"] == 1
        assert body["meta"]["previous_answers"] == 0
        assert body["meta"]["compare_window"]["from"] == _day(9)
        assert body["meta"]["compare_window"]["to"] == _day(5)


@pytest.mark.parametrize(
    ("first", "last", "expected"),
    [
        # Leap day: 1 to 5 March 2028 is 5 days, the window before is 25 to 29 February.
        (date(2028, 3, 1), date(2028, 3, 5), (date(2028, 2, 25), date(2028, 2, 29))),
        # The same days in a year without one.
        (date(2027, 3, 1), date(2027, 3, 5), (date(2027, 2, 24), date(2027, 2, 28))),
        # A month boundary inside the window before.
        (date(2026, 3, 3), date(2026, 3, 5), (date(2026, 2, 28), date(2026, 3, 2))),
        # A year boundary.
        (date(2027, 1, 3), date(2027, 1, 5), (date(2026, 12, 31), date(2027, 1, 2))),
        # One day: the day before.
        (date(2026, 11, 12), date(2026, 11, 12), (date(2026, 11, 11), date(2026, 11, 11))),
        # The default 28 days.
        (date(2026, 10, 16), date(2026, 11, 12), (date(2026, 9, 18), date(2026, 10, 15))),
    ],
)
def test_previous_dates_are_as_many_days_ending_the_day_before(
    first: date, last: date, expected: tuple[date, date]
) -> None:
    before_first, before_last = previous_dates(first, last)

    assert (before_first, before_last) == expected
    assert before_last == first - timedelta(days=1)
    assert (before_last - before_first) == (last - first)


def test_previous_dates_before_the_first_date_that_exists_are_out_of_range() -> None:
    with pytest.raises(RequestValidationError):
        previous_dates(date.min + timedelta(days=2), date.min + timedelta(days=5))


async def test_the_default_window_is_28_days_and_the_one_before_is_the_28_before_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """No `from` and `to`: 27 days ago to today, and 55 to 28 days ago before it."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    # The answer tables keep the last and the current month by default: 56 days is more.
    for table in ("ai.observations", "ai.citations", "ai.observation_facts"):
        await execute(migrated, f"SELECT ops.ensure_monthly_partitions('{table}'::regclass, 3, 1)")
    await _edge(migrated, world, prompt, 27, FIRST_MINUTE)
    await _edge(migrated, world, prompt, 28, LAST_MINUTE)
    await _edge(migrated, world, prompt, 55, FIRST_MINUTE)
    await _edge(migrated, world, prompt, 56, LAST_MINUTE)
    both = {"citation_units": 2, "observations": 2}

    for path, row_key, row_value in (
        ("domains", "registrable_domain", OWN_HOST),
        ("pages", "url", OWN),
    ):
        response = await api.get(
            world.url("ai", "sources", path),
            params={"compare": "previous_period"},
            headers=world.owner.headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert [(row[row_key], row["citation_units"], row["previous"]) for row in body["data"]] == [
            (row_value, 1, both)
        ]
        meta = body["meta"]
        assert (meta["window"]["from"], meta["window"]["to"]) == (_day(27), _day(0))
        assert (meta["compare_window"]["from"], meta["compare_window"]["to"]) == (
            _day(55),
            _day(28),
        )
        assert (meta["answers"], meta["previous_answers"]) == (1, 2)


async def test_both_windows_follow_the_project_timezone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """In Asia/Kolkata (UTC+5:30) a local day begins at 18:30 UTC the evening before, so the
    first and last minutes of the local days fall on other UTC days: the counts hold only if
    both windows are cut at local midnight."""
    zone = ZoneInfo("Asia/Kolkata")
    world = await make_world(resources, migrated)
    await execute(
        migrated,
        "UPDATE core.projects SET timezone = 'Asia/Kolkata' WHERE id = $1",
        world.project.id,
    )
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    await _edge(migrated, world, prompt, 4, FIRST_MINUTE, zone)
    await _edge(migrated, world, prompt, 5, LAST_MINUTE, zone)
    await _edge(migrated, world, prompt, 9, FIRST_MINUTE, zone)
    # A second answer early on the first day of the window before. The window cut in UTC instead
    # is 5:30 hours late: it would lose both of these and take in the one that starts the window
    # (one answer for two), so one answer there is not enough to tell the cuts apart.
    await _edge(migrated, world, prompt, 9, timedelta(hours=2), zone)
    await _edge(migrated, world, prompt, 10, LAST_MINUTE, zone)

    response = await api.get(
        world.url("ai", "sources", "domains"),
        params={"from": _day(4, zone), "to": _day(0, zone), "compare": "previous_period"},
        headers=world.owner.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["data"]
    assert row["citation_units"] == 1
    assert row["previous"] == {"citation_units": 3, "observations": 3}
    meta = body["meta"]
    assert meta["window"]["timezone"] == meta["compare_window"]["timezone"] == "Asia/Kolkata"
    assert (meta["compare_window"]["from"], meta["compare_window"]["to"]) == (
        _day(9, zone),
        _day(5, zone),
    )
    assert (meta["answers"], meta["previous_answers"]) == (1, 3)


async def test_without_compare_nothing_of_it_is_in_the_answer(
    api: httpx.AsyncClient, world: World
) -> None:
    for path in ("domains", "pages"):
        response = await _get(world, api, path)
        body = response.json()
        assert all("previous" not in row for row in body["data"])
        assert "compare_window" not in body["meta"]
        assert "previous_answers" not in body["meta"]


async def test_only_the_period_before_is_built(api: httpx.AsyncClient, world: World) -> None:
    response = await _get(world, api, "domains", compare="previous_year")

    assert problem(response) == (422, "validation_failed")


async def _full_previous(
    pg: PostgresServer, full: World, first: str, last: str
) -> dict[str, dict[str, tuple[int, int]]]:
    """What each domain and page of `full_project` was cited, and in how many answers, among the
    answers of the days `first` to `last` that nothing replaced. Each answer cites 10 of the 50
    pages, the ones numbered (id + 1) to (id + 10) modulo 50, and page n is on `site{n % 20}.net`;
    only the answers' ids come from the database."""
    since = datetime.fromisoformat(first).replace(tzinfo=UTC)
    until = datetime.fromisoformat(last).replace(tzinfo=UTC) + timedelta(days=1)
    rows = await fetch(
        pg,
        "SELECT id FROM ai.observations WHERE project_id = $1 AND observed_at >= $2 "
        "AND observed_at < $3 AND superseded_by IS NULL",
        full.project.id,
        since,
        until,
    )
    pages = {f"https://www.site{n % 20}.net/page{n}": (0, 0) for n in range(50)}
    domains = {f"site{n}.net": (0, 0) for n in range(20)}
    for row in rows:
        cited = [(row["id"] + step) % 50 for step in range(1, 11)]
        for number in cited:
            url = f"https://www.site{number % 20}.net/page{number}"
            units, seen = pages[url]
            pages[url] = (units + 1, seen + 1)
        sites = [number % 20 for number in cited]
        for site in set(sites):
            units, seen = domains[f"site{site}.net"]
            domains[f"site{site}.net"] = (units + sites.count(site), seen + 1)
    return {"domains": domains, "pages": pages}


async def test_a_full_project_compares_fast_without_statistics(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """3,600 answers 3 days apart, 300 of them replaced by a newer one. The last 11 days hold
    the answers 0 to 9 days old (4 a pair), the 11 days before them those 12 to 21 days old. The
    first read of the freshly loaded project (no ANALYZE) must not nest its loops: 15 s is the
    hard limit."""
    full = await full_project(resources, migrated)
    expected = await _full_previous(migrated, full, _day(21), _day(11))
    params: dict[str, str | int] = {
        "from": _day(10),
        "to": _day(0),
        "compare": "previous_period",
        "limit": 200,
    }
    for path, rows in (("domains", 20), ("pages", 50)):
        started = time.perf_counter()
        response = await api.get(
            full.url("ai", "sources", path), params=params, headers=full.owner.headers
        )
        assert time.perf_counter() - started < 15

        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["data"]) == rows
        assert body["meta"]["answers"] == 4 * 450
        assert body["meta"]["previous_answers"] == 4 * 450 - FULL_SUPERSEDED
        assert sum(row["previous"]["citation_units"] for row in body["data"]) == (
            (4 * 450 - FULL_SUPERSEDED) * 10
        )
        key = "registrable_domain" if path == "domains" else "url"
        shown = {
            row[key]: (row["previous"]["citation_units"], row["previous"]["observations"])
            for row in body["data"]
        }
        assert shown == expected[path]

    # The domains are cited unevenly (page n is on site n % 20 and 50 is not a multiple of 20),
    # so a row given another domain's counts is seen. Every page is cited alike: the page rows
    # check the total and the per-row equality, not a mix up of keys.
    assert len(set(expected["domains"].values())) > 1


async def test_compare_adds_two_statements(
    api: httpx.AsyncClient, resources: Resources, world: World
) -> None:
    await _get(world, api, "domains")
    with statements(resources) as plain:
        await _get(world, api, "domains")
    with statements(resources) as compared:
        await _get(world, api, "domains", compare="previous_period")

    assert len(compared) - len(plain) == 2, compared
