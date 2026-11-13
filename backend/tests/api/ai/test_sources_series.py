"""Weekly series of cited sources (WP-14 T2; CF-07, OV-N6; docs/19 section 2.5): with
`include=series` each domain and page row and `meta` carry a point per week of the window, oldest
first, zero filled, a week starting Monday 00:00 in the project's zone. The block is absent unless
asked for. The expected numbers are worked out by hand from the answers below."""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from datetime import time as clock
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from idraft.api.ai.summary import summary_weeks
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    FULL_ANSWERS,
    GUIDE,
    GUIDE_TOP,
    OWN,
    WIKI,
    Cite,
    World,
    answer,
    derivation_of,
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import OWN_HOST, Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

ZONE = ZoneInfo("Europe/Berlin")
EVENTUS, EXAMPLE, WIKIPEDIA = OWN_HOST, "example.org", "wikipedia.org"

# What a row and the meta hold when no block is asked for (as built before WP-14).
DOMAIN_ROW_KEYS = {
    "registrable_domain",
    "domain_role",
    "role_entity_id",
    "citation_units",
    "observations",
    "prompts",
    "engines",
    "source_share",
    "first_seen_at",
    "last_seen_at",
}
PAGE_ROW_KEYS = DOMAIN_ROW_KEYS | {"url_id", "url", "host", "title"}
META_KEYS = {
    "window",
    "include_branded",
    "engine_codes",
    "answers",
    "answers_citing",
    "citation_units",
    "by_role",
}


@dataclass(frozen=True)
class Scene:
    world: World
    prompts: dict[str, Prompt]
    first: date
    last: date

    def week(self, index: int) -> str:
        return (self.first + timedelta(days=7 * index)).isoformat()

    @property
    def window(self) -> dict[str, str]:
        return {"from": self.first.isoformat(), "to": self.last.isoformat()}


def _days_ago(day: date, hour: int = 12, minute: int = 0) -> float:
    """How long before now the project-local `day` at `hour:minute` was."""
    instant = datetime.combine(day, clock(hour, minute), tzinfo=ZONE)
    return (datetime.now(UTC) - instant).total_seconds() / 86400


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Berlin, three whole weeks `m0`, `m1`, `m2` (Monday to Sunday) ending on the last Sunday.
    Counted answers, the week each lies in in brackets:

      a1 ChatGPT  Tue m0         own page, guide, wiki     3 units
      a2 Gemini   Wed m0         guide                     1 unit
      b1 ChatGPT  Mon m1 00:30   own page, wiki            2 units (Sunday in UTC)
      b2 ChatGPT  Fri m1         no citations at all

    Week m2 has no answer. Left out: a refusal in m1, an answer the Sunday before the window and
    an answer of m0 that a newer one replaced, each citing the own page."""
    world = await make_world(resources, migrated)
    await execute(
        migrated,
        "UPDATE core.projects SET timezone = 'Europe/Berlin' WHERE id = $1",
        world.project.id,
    )
    today = datetime.now(ZONE).date()
    last = today - timedelta(days=today.weekday() + 1)
    first = last - timedelta(days=20)
    prompts = {
        "a": await add_prompt(migrated, world.project, "Best managed SOC providers?"),
        "b": await add_prompt(migrated, world.project, "How much does a managed SOC cost?"),
    }
    own = world.own_cite()

    async def add(prompt: str, day: date, cites: list[Cite], **kw: Any) -> None:
        hour, minute = kw.pop("at", (12, 0))
        await answer(
            migrated,
            world,
            prompts[prompt],
            days_ago=_days_ago(day, hour, minute),
            cites=cites,
            **kw,
        )

    await add("a", first + timedelta(days=1), [own, Cite(GUIDE), Cite(WIKI)])
    await add("a", first + timedelta(days=2), [Cite(GUIDE)], engine="gemini_web")
    await add("b", first + timedelta(days=7), [own, Cite(WIKI)], at=(0, 30))
    await add("b", first + timedelta(days=11), [])
    await add("a", first + timedelta(days=8), [own], valid=False)
    await add("a", first - timedelta(days=1), [own])
    await add("a", first + timedelta(days=3), [own, Cite(GUIDE)], superseded=True)
    return Scene(world, prompts, first, last)


async def _get(scene: Scene, api: httpx.AsyncClient, *path: str, **params: Any) -> httpx.Response:
    response = await api.get(
        scene.world.url("ai", *path),
        params={**scene.window, **params},
        headers=scene.world.owner.headers,
    )
    assert response.status_code == 200, response.text
    return response


def _points(row: dict[str, Any]) -> list[tuple[str, int, int]]:
    return [(p["week_start"], p["citation_units"], p["observations"]) for p in row["series"]]


def _by_source(body: dict[str, Any]) -> dict[Any, Any]:
    return {(row["registrable_domain"], row["domain_role"]): row for row in body["data"]}


async def test_each_domain_row_has_a_point_per_week_oldest_first(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    body = (await _get(scene, api, "sources", "domains", include="series")).json()

    rows = _by_source(body)
    w0, w1, w2 = (scene.week(i) for i in range(3))
    assert {key: _points(row) for key, row in rows.items()} == {
        (EVENTUS, "own"): [(w0, 1, 1), (w1, 1, 1), (w2, 0, 0)],
        (EXAMPLE, "third_party"): [(w0, 2, 2), (w1, 0, 0), (w2, 0, 0)],
        (WIKIPEDIA, "third_party"): [(w0, 1, 1), (w1, 1, 1), (w2, 0, 0)],
    }
    for row in rows.values():
        assert [p["week_start"] for p in row["series"]] == [
            week.isoformat() for week in summary_weeks(scene.first, scene.last)
        ]
        assert sum(p["citation_units"] for p in row["series"]) == row["citation_units"]


async def test_a_week_without_citations_is_a_zero_point(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    body = (await _get(scene, api, "sources", "domains", include="series")).json()

    zero_week = scene.week(2)
    assert body["meta"]["series"][2] == {
        "week_start": zero_week,
        "answers": 0,
        "citation_units": 0,
        "distinct_domains": 0,
    }
    for row in body["data"]:
        assert row["series"][2] == {"week_start": zero_week, "citation_units": 0, "observations": 0}


async def test_meta_series_counts_answers_units_and_domains_per_week(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """b2 cites nothing and still counts as an answer of its week."""
    body = (await _get(scene, api, "sources", "domains", include="series")).json()

    meta = body["meta"]
    assert [
        (p["week_start"], p["answers"], p["citation_units"], p["distinct_domains"])
        for p in meta["series"]
    ] == [(scene.week(0), 2, 4, 3), (scene.week(1), 2, 2, 2), (scene.week(2), 0, 0, 0)]
    assert sum(p["answers"] for p in meta["series"]) == meta["answers"] == 4
    assert sum(p["citation_units"] for p in meta["series"]) == meta["citation_units"] == 6


async def test_weeks_start_on_monday_in_the_project_zone(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """b1 is Monday 00:30 in Berlin, which is Sunday in UTC: it belongs to the Monday's week."""
    monday = datetime.combine(scene.first + timedelta(days=7), clock(0, 30), tzinfo=ZONE)
    assert monday.astimezone(UTC).date() == scene.first + timedelta(days=6)

    body = (await _get(scene, api, "sources", "domains", include="series")).json()

    own = _by_source(body)[(EVENTUS, "own")]
    assert _points(own)[:2] == [(scene.week(0), 1, 1), (scene.week(1), 1, 1)]
    assert [p["answers"] for p in body["meta"]["series"]][:2] == [2, 2]


async def test_the_first_week_counts_only_the_windows_days(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """From the Wednesday of the first week: a1 (Tuesday) is out, a2 (Wednesday) is in, and the
    first point is still that week's Monday."""
    wednesday = (scene.first + timedelta(days=2)).isoformat()

    body = (
        await _get(scene, api, "sources", "domains", include="series", **{"from": wednesday})
    ).json()

    rows = _by_source(body)
    assert [p["week_start"] for p in body["meta"]["series"]] == [scene.week(i) for i in range(3)]
    assert _points(rows[(EXAMPLE, "third_party")])[0] == (scene.week(0), 1, 1)
    assert _points(rows[(EVENTUS, "own")])[:2] == [(scene.week(0), 0, 0), (scene.week(1), 1, 1)]
    assert body["meta"]["series"][0]["answers"] == 1


async def test_page_rows_have_series_and_meta_series_too(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    pages = (await _get(scene, api, "sources", "pages", include="series")).json()
    domains = (await _get(scene, api, "sources", "domains", include="series")).json()

    w0, w1, w2 = (scene.week(i) for i in range(3))
    by_url = {row["url"]: _points(row) for row in pages["data"]}
    assert by_url == {
        OWN: [(w0, 1, 1), (w1, 1, 1), (w2, 0, 0)],
        GUIDE: [(w0, 2, 2), (w1, 0, 0), (w2, 0, 0)],
        WIKI: [(w0, 1, 1), (w1, 1, 1), (w2, 0, 0)],
    }
    assert pages["meta"]["series"] == domains["meta"]["series"]


async def test_series_with_compare_and_filters_follow_the_scope(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(
        scene,
        api,
        "sources",
        "domains",
        include="series",
        compare="previous_period",
        **{"filter[engine_code_in]": "gemini_web"},
    )

    body = response.json()
    [row] = body["data"]
    assert row["registrable_domain"] == EXAMPLE
    assert _points(row) == [(scene.week(0), 1, 1), (scene.week(1), 0, 0), (scene.week(2), 0, 0)]
    assert row["previous"] == {"citation_units": 0, "observations": 0}
    assert body["meta"]["compare_window"]
    assert [(p["answers"], p["citation_units"]) for p in body["meta"]["series"]] == [
        (1, 1),
        (0, 0),
        (0, 0),
    ]


async def test_page_series_with_compare_and_an_engine_filter_follow_the_scope(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    body = (
        await _get(
            scene,
            api,
            "sources",
            "pages",
            include="series",
            compare="previous_period",
            **{"filter[engine_code_in]": "gemini_web"},
        )
    ).json()

    [row] = body["data"]
    assert row["url"] == GUIDE
    assert _points(row) == [(scene.week(0), 1, 1), (scene.week(1), 0, 0), (scene.week(2), 0, 0)]
    assert row["previous"] == {"citation_units": 0, "observations": 0}
    assert body["meta"]["compare_window"]
    assert [(p["answers"], p["citation_units"]) for p in body["meta"]["series"]] == [
        (1, 1),
        (0, 0),
        (0, 0),
    ]


@pytest.fixture
async def doubled(migrated: PostgresServer, scene: Scene) -> Scene:
    """Two answers in the empty week m2: one lists the wiki page twice (two `citation_index`
    rows, one unit) and one cites two pages of example.org (two units, one answer, one domain)."""
    for prompt, day, cites in (
        ("a", 1, [Cite(WIKI), Cite(WIKI)]),
        ("b", 2, [Cite(GUIDE), Cite(GUIDE_TOP)]),
    ):
        await answer(
            migrated,
            scene.world,
            scene.prompts[prompt],
            days_ago=_days_ago(scene.first + timedelta(days=14 + day)),
            cites=cites,
        )
    return scene


async def test_a_page_listed_twice_and_two_pages_of_one_domain_count_once_per_unit(
    api: httpx.AsyncClient, doubled: Scene
) -> None:
    body = (await _get(doubled, api, "sources", "domains", include="series")).json()

    rows = _by_source(body)
    w0, w1, w2 = (doubled.week(i) for i in range(3))
    assert _points(rows[(WIKIPEDIA, "third_party")]) == [(w0, 1, 1), (w1, 1, 1), (w2, 1, 1)]
    assert _points(rows[(EXAMPLE, "third_party")]) == [(w0, 2, 2), (w1, 0, 0), (w2, 2, 1)]
    assert [
        (p["answers"], p["citation_units"], p["distinct_domains"]) for p in body["meta"]["series"]
    ] == [(2, 4, 3), (2, 2, 2), (2, 3, 2)]
    for row in rows.values():
        assert sum(p["citation_units"] for p in row["series"]) == row["citation_units"]


async def test_page_series_count_a_page_listed_twice_once(
    api: httpx.AsyncClient, doubled: Scene
) -> None:
    body = (await _get(doubled, api, "sources", "pages", include="series")).json()

    w2 = doubled.week(2)
    by_url = {row["url"]: _points(row)[2] for row in body["data"]}
    assert by_url == {OWN: (w2, 0, 0), GUIDE: (w2, 1, 1), GUIDE_TOP: (w2, 1, 1), WIKI: (w2, 1, 1)}


async def test_weeks_follow_the_zone_across_a_clock_change(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Berlin put its clocks forward on Sunday 2026-03-29, so Monday 00:30 on the 30th is Sunday
    22:30 in UTC and not 23:30: a week cut with a fixed +01:00 offset would file it in the week
    before. The rows are written for the fixed days (the partitions of that month are made when
    the database has none), so the test does not move with the calendar."""
    month = date(2026, 3, 1)
    for table in ("observations", "observation_facts", "citations"):
        await execute(
            migrated,
            f"CREATE TABLE IF NOT EXISTS ai.{table}_p202603 PARTITION OF ai.{table} "
            f"FOR VALUES FROM ('{month} 00:00:00+00') TO ('2026-04-01 00:00:00+00')",
        )
    world = await make_world(resources, migrated)
    await execute(
        migrated,
        "UPDATE core.projects SET timezone = 'Europe/Berlin' WHERE id = $1",
        world.project.id,
    )
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    local = [
        (date(2026, 3, 23), 0, 30),
        (date(2026, 3, 29), 23, 30),
        (date(2026, 3, 30), 0, 30),
        (date(2026, 3, 30), 23, 30),
    ]
    for day, hour, minute in local:
        await answer(
            migrated, world, prompt, days_ago=_days_ago(day, hour, minute), cites=[Cite(GUIDE)]
        )

    response = await api.get(
        world.url("ai", "sources", "domains"),
        params={"from": "2026-03-23", "to": "2026-04-05", "include": "series"},
        headers=world.owner.headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(p["week_start"], p["answers"]) for p in body["meta"]["series"]] == [
        ("2026-03-23", 2),
        ("2026-03-30", 2),
    ]
    [row] = body["data"]
    assert _points(row) == [("2026-03-23", 2, 2), ("2026-03-30", 2, 2)]


async def test_a_role_filter_narrows_the_rows_and_not_the_weekly_denominators(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    whole = (await _get(scene, api, "sources", "domains", include="series")).json()

    narrowed = (
        await _get(
            scene,
            api,
            "sources",
            "domains",
            include="series",
            **{"filter[domain_role_in]": "own"},
        )
    ).json()

    assert [row["registrable_domain"] for row in narrowed["data"]] == [EVENTUS]
    assert narrowed["meta"]["series"] == whole["meta"]["series"]


async def test_branded_prompts_are_left_out_of_the_series_unless_asked(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    branded = await add_prompt(migrated, scene.world.project, "Is Eventus any good?", branded=True)
    await answer(
        migrated,
        scene.world,
        branded,
        days_ago=_days_ago(scene.first + timedelta(days=3)),
        cites=[scene.world.own_cite()],
    )

    plain = (await _get(scene, api, "sources", "domains", include="series")).json()
    asked = (
        await _get(scene, api, "sources", "domains", include="series", include_branded="true")
    ).json()

    assert plain["meta"]["series"][0]["answers"] == 2
    assert asked["meta"]["series"][0]["answers"] == 3
    assert asked["meta"]["series"][0]["citation_units"] == 5
    own = _by_source(asked)[(EVENTUS, "own")]
    assert _points(own)[0] == (scene.week(0), 2, 2)


async def test_a_ninety_two_day_window_has_at_most_fourteen_weeks(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    today = datetime.now(ZONE).date()
    first = today - timedelta(days=91)

    body = (
        await _get(
            scene,
            api,
            "sources",
            "domains",
            include="series",
            **{"from": first.isoformat(), "to": today.isoformat()},
        )
    ).json()

    weeks = [week.isoformat() for week in summary_weeks(first, today)]
    assert 13 <= len(weeks) <= 14
    assert [p["week_start"] for p in body["meta"]["series"]] == weeks
    for row in body["data"]:
        assert [p["week_start"] for p in row["series"]] == weeks
        assert sum(p["citation_units"] for p in row["series"]) == row["citation_units"]


@pytest.mark.parametrize(
    ("path", "row_keys"), [("domains", DOMAIN_ROW_KEYS), ("pages", PAGE_ROW_KEYS)]
)
async def test_without_include_there_is_no_series(
    path: str, row_keys: set[str], api: httpx.AsyncClient, scene: Scene
) -> None:
    body = (await _get(scene, api, "sources", path)).json()

    assert body["data"]
    for row in body["data"]:
        assert set(row) == row_keys
    assert set(body["meta"]) == META_KEYS


@pytest.mark.parametrize("path", ["domains", "pages"])
async def test_series_adds_two_statements(
    path: str, api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    """The weekly points of the page's rows, and the weekly totals of the scope."""
    await _get(scene, api, "sources", path)
    with statements(resources) as plain:
        await _get(scene, api, "sources", path)
    with statements(resources) as with_series:
        await _get(scene, api, "sources", path, include="series")

    assert len(with_series) - len(plain) == 2, with_series


async def test_a_full_project_series_reads_as_many_statements_as_a_small_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """3,600 answers (300 replaced) with 36,000 citations: the same statements as the small
    world, cold, without statistics, and the weekly points add up to the rows' totals."""
    full = await full_project(resources, migrated)
    started = time.perf_counter()
    cold = await api.get(
        full.url("ai", "sources", "domains"),
        params={"include": "series", "limit": "50"},
        headers=full.owner.headers,
    )
    assert time.perf_counter() - started < 15
    assert cold.status_code == 200, cold.text
    await _get(scene, api, "sources", "domains", include="series")
    with statements(resources) as small:
        await _get(scene, api, "sources", "domains", include="series")
    with statements(resources) as large:
        response = await api.get(
            full.url("ai", "sources", "domains"),
            params={"include": "series", "limit": "50"},
            headers=full.owner.headers,
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["page"]["total"] == len(body["data"]) == 20
    assert sum(p["citation_units"] for row in body["data"] for p in row["series"]) == (
        FULL_ANSWERS * 10
    )
    assert sum(p["answers"] for p in body["meta"]["series"]) == FULL_ANSWERS
    assert len(large) == len(small), large


async def test_series_of_another_project_of_the_workspace_count_nothing(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    before = (await _get(scene, api, "sources", "domains", include="series")).json()
    world = scene.world
    other_project = Project(
        world.project.workspace_id, await make_project(migrated, world.workspace.id)
    )
    other = replace(
        world, project=other_project, derivation_id=await derivation_of(migrated, other_project)
    )
    prompt = await add_prompt(migrated, other_project, "Best managed SOC providers?")
    for days in (1, 2):
        await answer(
            migrated,
            other,
            prompt,
            days_ago=_days_ago(scene.first + timedelta(days=days)),
            cites=[Cite(GUIDE)],
        )

    after = (await _get(scene, api, "sources", "domains", include="series")).json()

    assert after == before
