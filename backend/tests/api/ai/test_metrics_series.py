"""A metric over the weeks (contract C8, route 4): the weekly points of the prompts summary's
`total` row, mapped, with the pooling of change C-11 unchanged (a point of fewer than 10 prompts
answering that week holds the trailing four weeks and says so). Read over the seeded world of
`test_prompts_summary` (see the docstring of its `summary` fixture) and over two small worlds of
their own, whose answers are placed in the weeks before this one whatever today is.

World of three answers per prompt (the same as `test_a_series_has_a_point_for_each_week_of_the_
window` of the summary tests). Prompt A: two answers 7 days ago (own brand named, nobody named) and
one 14 days ago (own named). Prompt B: one 14 days ago (own named) and a refusal 21 days ago. The
three weeks are `one`, `two` and `three` (a week, two weeks and three weeks ago):

    one    A 1 of 2 and the 14 day answer behind it: A 2 of 3 over the pool, B 1 of 1:
           (2/3 + 1) = 5/3 of 2 prompts, answers 3 of 4, in 5 (B's refusal is in the pool)
    two    A 1 of 1, B 1 of 1 (a refusal beside it): 2 of 2 prompts, answers 2 of 2, in 3
    three  B's refusal alone: no valid answer: 0 of 0, in 1"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.metrics_support import get_metric, metric_body
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    REFUSAL,
    Answer,
    Summary,
    answer_in_another_project,
    day,
    ingested,
    new_prompts,
    new_world,
    summary_data,
)
from tests.api.ai.test_metrics_overview import _two_versions as two_versions
from tests.api.ai.test_prompts_summary import NEITHER
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import problem
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

SERIES_KEYS = {
    "ai.mention_rate": "mentioned",
    "ai.citation_rate": "cited",
    "ai.share_of_voice": "share_of_voice",
}
NO_WEEKLY_DATA = [
    "ai.prompts_in_scope",
    "ai.valid_answers",
    "ai.mention_and_citation_rate",
    "ai.outcome_mix",
    "ai.outcome_mix.neither",
    "ai.citation_rate_given_citations",
    "ai.first_mention_rate",
    "ai.fanout_presence_rate",
    "ai.fanout_mean_queries",
    "ai.citation_share",
    "ai.recommendation_rate",
    "ai.recommended_given_mentioned",
]


def _monday(of: date) -> date:
    return of - timedelta(days=of.weekday())


def _weeks(first: date, last: date) -> list[str]:
    """The Mondays of the weeks the days touch."""
    weeks, week = [], _monday(first)
    while week <= last:
        weeks.append(week.isoformat())
        week += timedelta(days=7)
    return weeks


def _series(body: dict[str, Any], engine: str, entity: str | None = None) -> dict[str, Any]:
    found = [s for s in body["data"] if s["engine_code"] == engine and s.get("entity_id") == entity]
    assert len(found) == 1, (engine, entity)
    series: dict[str, Any] = found[0]
    return series


def _points(series: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {point["t"]: point for point in series["points"]}


def _counts(cell: dict[str, Any]) -> tuple[Any, Any, Any]:
    return cell["numerator"], cell["denominator"], cell["n_observations"]


def _codes(response: httpx.Response) -> set[tuple[str, str]]:
    return {(item["path"], item["code"]) for item in response.json()["errors"]}


def _today() -> date:
    return datetime.now(UTC).date()  # The project is in UTC.


async def test_a_series_has_a_point_per_week_oldest_first_for_each_engine(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    first, last = _today() - timedelta(days=27), _today()
    body = await metric_body(
        seeded,
        api,
        "ai.mention_rate",
        "series",
        **{"from": first.isoformat(), "to": last.isoformat()},
    )

    assert [(s["metric"], s["engine_code"]) for s in body["data"]] == [
        ("ai.mention_rate", CHATGPT),
        ("ai.mention_rate", GEMINI),
    ]
    for series in body["data"]:
        assert [point["t"] for point in series["points"]] == _weeks(first, last)
        assert series["granularity"] == "week"
        assert (series["unit"], series["aggregation"]) == ("ratio", "prompt_weighted")
        assert (series["is_estimate"], series["method_version"]) == (False, 1)
        assert series["window"] == {
            "from": first.isoformat(),
            "to": last.isoformat(),
            "timezone": "UTC",
        }
        assert series["filters"] == {
            "include_branded": False,
            "branded_only": False,
            "country_iso": None,
            "term_id": None,
        }
        assert series["method"] == "Valid answers that name the own brand, prompt weighted."
        assert "entity_id" not in series
        assert "compare" not in series
    # No average of the engines: a series is per engine.
    assert body["meta"]["engine_codes"] == [CHATGPT, GEMINI]
    assert body["meta"]["window"] == series["window"]
    share = await metric_body(seeded, api, "ai.share_of_voice", "series")
    assert {s["aggregation"] for s in share["data"]} == {"observation_weighted"}
    for point in (p for s in share["data"] for p in s["points"]):
        assert "pooled" not in point


async def test_the_points_are_the_summary_total_points(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = (await summary_data(seeded, api, include="total,series", rows="none"))["total"]

    for key, name in SERIES_KEYS.items():
        body = await metric_body(seeded, api, key, "series")

        for engine in total["engines"]:
            points = _series(body, engine["engine_code"])["points"]
            assert [p["t"] for p in points] == [w["week_start"] for w in engine["series"]], key
            for point, week in zip(points, engine["series"], strict=True):
                cell = week[name]
                assert (point["value"], *_counts(point)) == (
                    cell["value"],
                    cell["numerator"],
                    cell["denominator"],
                    cell["n_observations"],
                ), (key, week["week_start"])
                assert point["n_prompts"] == week["prompts"]
                assert point["is_pooled"] == week["is_pooled"]
                assert point.get("pool") == week.get("pool")
                assert point.get("pooled") == cell["pooled"]
                assert ("pool" in point) == point["is_pooled"]


async def test_a_week_with_fewer_than_ten_prompts_is_pooled_and_says_so(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    world = await new_world(resources, migrated)
    prompts = await new_prompts(migrated, world, ["a", "b"])
    world = replace(world, prompts=prompts)
    await ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [
            Answer("a", OWN_ONLY, (), 7),
            Answer("a", NEITHER, (), 7),
            Answer("a", OWN_ONLY, (), 14),
            Answer("b", OWN_ONLY, (), 14),
            Answer("b", REFUSAL, (), 21),
        ],
    )

    body = await metric_body(world, api, "ai.mention_rate", "series")

    series = _series(body, CHATGPT)
    today = _today()
    one, two, three = (_monday(today - timedelta(days=7 * n)).isoformat() for n in (1, 2, 3))
    points = _points(series)
    assert [point["t"] for point in series["points"]] == _weeks(today - timedelta(days=27), today)
    # Two prompts answer: every point of the series holds the trailing weeks, inside the window.
    assert {point["is_pooled"] for point in series["points"]} == {True}
    assert {point["pool"]["reason"] for point in series["points"]} == {"few_prompts"}
    assert {point["pool"]["below_prompts"] for point in series["points"]} == {10}
    assert _counts(points[one]) == (pytest.approx(5 / 3), 2, 5)
    assert points[one]["value"] == pytest.approx(5 / 6)
    assert points[one]["pooled"] == {"successes": 3, "trials": 4}
    assert points[one]["n_prompts"] == 1
    assert (
        points[one]["pool"]["window"]["to"]
        == (date.fromisoformat(one) + timedelta(days=6)).isoformat()
    )
    assert _counts(points[two]) == (2, 2, 3)
    assert points[two]["value"] == 1.0
    assert points[two]["n_prompts"] == 2
    assert points[two]["pooled"] == {"successes": 2, "trials": 2}
    assert points[two]["pool"]["weeks"] <= 4
    # B's refusal alone: an answer, and no valid one.
    assert _counts(points[three]) == (0, 0, 1)
    assert points[three]["value"] is None
    assert points[three]["n_prompts"] == 0
    # A pool never reaches before the window.
    opens = (today - timedelta(days=27)).isoformat()
    assert all(point["pool"]["window"]["from"] >= opens for point in series["points"])
    # The current week holds the trailing four weeks, all the answers: the window's cell.
    summary_total = (await summary_data(world, api, include="total", rows="none"))["total"]
    window_cell = summary_total["engines"][0]["mentioned"]
    assert _counts(series["points"][-1]) == _counts(window_cell)


async def test_a_week_with_ten_prompts_answering_is_its_own_week_and_not_pooled(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """Ten prompts answer once each, a week ago: four name the own brand. Ten is the limit: the
    week is its own."""
    world = await new_world(resources, migrated)
    names = [f"p{n}" for n in range(10)]
    world = replace(world, prompts=await new_prompts(migrated, world, names))
    await ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [Answer(name, OWN_ONLY if n < 4 else NEITHER, (), 7) for n, name in enumerate(names)],
    )

    body = await metric_body(world, api, "ai.mention_rate", "series")

    points = _points(_series(body, CHATGPT))
    week = points[_monday(_today() - timedelta(days=7)).isoformat()]
    assert (week["is_pooled"], "pool" in week) == (False, False)
    assert _counts(week) == (4, 10, 10)
    assert week["value"] == pytest.approx(0.4)
    assert (week["n_prompts"], week["pooled"]) == (10, {"successes": 4, "trials": 10})
    # The weeks before it had no prompt answering: pooled, and nothing in the pool.
    before = points[_monday(_today() - timedelta(days=14)).isoformat()]
    assert before["is_pooled"] is True
    assert (before["value"], _counts(before)) == (None, (0, 0, 0))
    assert before["pool"]["reason"] == "few_prompts"


async def test_the_first_and_last_points_are_partial(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """From a Wednesday to the Tuesday three weeks on: the first week is cut at the Wednesday, the
    last at the Tuesday, and the two weeks between are whole."""
    first = _today() - timedelta(days=60)
    while first.weekday() != 2:
        first -= timedelta(days=1)
    last = first + timedelta(days=20)

    body = await metric_body(
        seeded,
        api,
        "ai.mention_rate",
        "series",
        **{"from": first.isoformat(), "to": last.isoformat()},
    )

    points = _series(body, CHATGPT)["points"]
    assert [point["t"] for point in points] == [
        (first - timedelta(days=2) + timedelta(days=7 * n)).isoformat() for n in range(4)
    ]
    assert [point["is_partial"] for point in points] == [True, False, False, True]
    # A window that ends on a Sunday and starts on a Monday cuts no week.
    monday = _monday(first)
    whole = await metric_body(
        seeded,
        api,
        "ai.mention_rate",
        "series",
        **{"from": monday.isoformat(), "to": (monday + timedelta(days=13)).isoformat()},
    )
    assert [p["is_partial"] for p in _series(whole, CHATGPT)["points"]] == [False, False]


async def test_the_week_that_holds_today_is_partial(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """A window that reaches a week past today: the week of today is inside it, whole, and still
    partial (its days to come have no answers yet); the week before is not."""
    today = _today()
    body = await metric_body(
        seeded,
        api,
        "ai.mention_rate",
        "series",
        **{
            "from": (today - timedelta(days=20)).isoformat(),
            "to": (today + timedelta(days=7)).isoformat(),
        },
    )

    points = _points(_series(body, CHATGPT))
    this_week = _monday(today)
    assert points[this_week.isoformat()]["is_partial"] is True
    assert points[(this_week - timedelta(days=7)).isoformat()]["is_partial"] is False


async def test_a_series_per_listed_entity_and_engine(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    total = (await summary_data(seeded, api, include="total,series,entities", rows="none"))["total"]
    own, rival = str(seeded.own), str(seeded.rival)

    mention = await metric_body(
        seeded, api, "ai.mention_rate", "series", entity_ids=f"{seeded.rival},{seeded.own}"
    )
    share = await metric_body(seeded, api, "ai.share_of_voice", "series", entity_ids=rival)

    # Engines by code, the own entity first within each; no entity, no average.
    assert [(s["engine_code"], s["entity_id"]) for s in mention["data"]] == [
        (CHATGPT, own),
        (CHATGPT, rival),
        (GEMINI, own),
        (GEMINI, rival),
    ]
    assert [(s["engine_code"], s["entity_id"]) for s in share["data"]] == [
        (CHATGPT, rival),
        (GEMINI, rival),
    ]
    assert mention["data"][1]["method"] == "Valid answers that name the entity, prompt weighted."
    for body, name in ((mention, "mentioned"), (share, "share_of_voice")):
        for series in body["data"]:
            engine = next(e for e in total["engines"] if e["engine_code"] == series["engine_code"])
            for point, week in zip(series["points"], engine["series"], strict=True):
                cell = next(c for c in week["entities"] if c["entity_id"] == series["entity_id"])[
                    name
                ]
                assert (point["value"], *_counts(point)) == (
                    cell["value"],
                    cell["numerator"],
                    cell["denominator"],
                    cell["n_observations"],
                )
                assert point.get("pooled") == cell["pooled"]
                assert point["n_prompts"] == week["prompts"]
                assert point["is_pooled"] == week["is_pooled"]
    # Three prompts: every point holds the trailing four weeks, so the last is the whole window.
    # The rival is named in providers 1 and 4: 2/5 of one prompt over 3 prompts, answers 2 of 7.
    last = _series(mention, CHATGPT, rival)["points"][-1]
    assert _counts(last) == (pytest.approx(0.4), 3, 8)
    assert last["pooled"] == {"successes": 2, "trials": 7}
    assert _counts(_series(mention, CHATGPT, own)["points"][-1]) == (pytest.approx(1.4), 3, 8)
    # Share of voice: the rival 1/2 + 1 of the 4 answers that name a tracked entity, the own 2.5.
    assert _counts(_series(share, CHATGPT, rival)["points"][-1]) == (1.5, 4, 8)
    both = await metric_body(
        seeded, api, "ai.share_of_voice", "series", entity_ids=f"{seeded.own},{rival}"
    )
    assert _counts(_series(both, CHATGPT, own)["points"][-1]) == (2.5, 4, 8)


async def test_entity_ids_are_for_mention_rate_and_share_of_voice_only_and_tracked_entities(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    response = await get_metric(
        seeded, api, "ai.citation_rate", "series", entity_ids=str(seeded.own)
    )

    assert problem(response) == (422, "validation_failed")
    assert ("entity_ids", "not_supported") in _codes(response)
    # An id that names no tracked entity is left out: nothing to draw, and 200.
    nobody = await metric_body(
        seeded, api, "ai.mention_rate", "series", entity_ids="0000004a-7c1e-4a52-9b3d-00000000004a"
    )
    assert nobody["data"] == []


async def test_granularity_week_is_the_default_and_day_is_422_not_built(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    default = await get_metric(seeded, api, "ai.mention_rate", "series")
    week = await get_metric(seeded, api, "ai.mention_rate", "series", granularity="week")

    assert default.status_code == 200
    assert week.json() == default.json()
    for granularity in ("day", "month"):
        refused = await get_metric(
            seeded, api, "ai.mention_rate", "series", granularity=granularity
        )

        assert problem(refused) == (422, "validation_failed")
        assert ("granularity", "not_built") in _codes(refused)


async def test_series_follows_the_branded_term_country_and_engine_scope(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """Every scope the summary has: with so few prompts the last point holds all the answers of
    the window, and equals the value of the same scope on route 3."""
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["providers"].id,
    )
    scopes: dict[str, dict[str, str]] = {
        "default": {},
        "branded": {"include_branded": "true"},
        "branded only": {"branded_only": "true"},
        "term": {"filter[term]": str(seeded.topics["soc"])},
        "country": {"filter[country_iso]": "IN"},
        "empty market": {"filter[country_iso]": "FR"},
        "gemini": {"filter[engine_code_in]": GEMINI},
    }

    for name, scope in scopes.items():
        body = await metric_body(seeded, api, "ai.mention_rate", "series", **scope)
        value = await metric_body(seeded, api, "ai.mention_rate", **scope)

        engines = [s["engine_code"] for s in body["data"]]
        assert engines == [v["engine_code"] for v in value["data"] if "engine_code" in v], name
        for series in body["data"]:
            last = series["points"][-1]
            same = next(v for v in value["data"] if v.get("engine_code") == series["engine_code"])
            assert (last["value"], *_counts(last)) == (same["value"], *_counts(same)), name
            assert last.get("pooled") == same.get("pooled"), name
    chatgpt = {
        name: _series(await metric_body(seeded, api, "ai.mention_rate", "series", **scope), CHATGPT)
        for name, scope in scopes.items()
        if name != "gemini"
    }
    # Providers 2/5 + pricing 0/1 + misc 1/1 over 3 prompts: the default scope.
    assert _counts(chatgpt["default"]["points"][-1]) == (pytest.approx(1.4), 3, 8)
    # The branded prompt names the brand in its one answer: 1.4 + 1 over 4 prompts, answers 4 of 8.
    assert _counts(chatgpt["branded"]["points"][-1]) == (pytest.approx(2.4), 4, 9)
    assert chatgpt["branded"]["points"][-1]["pooled"] == {"successes": 4, "trials": 8}
    assert chatgpt["branded"]["filters"]["include_branded"] is True
    assert _counts(chatgpt["branded only"]["points"][-1]) == (1, 1, 1)
    # Managed SOC: providers 2/5 and pricing 0/1 over 2 prompts, 6 valid answers of 7.
    assert _counts(chatgpt["term"]["points"][-1]) == (pytest.approx(0.4), 2, 7)
    assert chatgpt["term"]["points"][-1]["pooled"] == {"successes": 2, "trials": 6}
    # Providers alone, the only prompt of that market.
    assert _counts(chatgpt["country"]["points"][-1]) == (pytest.approx(0.4), 1, 6)
    assert chatgpt["country"]["filters"]["country_iso"] == "IN"
    # No prompt in a market: points of zero and no value, not of 0.
    for point in chatgpt["empty market"]["points"]:
        assert (point["value"], _counts(point), point["n_prompts"]) == (None, (0, 0, 0), 0)


async def test_a_series_key_without_weekly_data_is_501_naming_it_and_the_route(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for key in NO_WEEKLY_DATA:
        response = await get_metric(seeded, api, key, "series")

        assert problem(response) == (501, "not_implemented"), key
        assert response.json()["detail"] == f"Not built yet: {key} on series.", key
    for key in ("ai.sentiment", "ai.flip_rate"):
        response = await get_metric(seeded, api, key, "series")

        assert response.json()["detail"] == f"Not built yet: {key}.", key
    for key in SERIES_KEYS:
        assert (await get_metric(seeded, api, key, "series")).status_code == 200, key


async def test_a_series_of_an_unknown_key_is_404_and_checked_before_the_project(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    for key in ("ai.nope", "seo.top3_count"):
        assert problem(await get_metric(seeded, api, key, "series")) == (404, "unknown_metric")
    for key in SERIES_KEYS:
        assert problem(await get_metric(seeded, api, key, "series")) == (404, "not_found"), key


async def test_series_points_are_at_most_fourteen(api: httpx.AsyncClient, seeded: Summary) -> None:
    """92 days start and end on the same weekday, so they touch 14 weeks whatever today is."""
    body = await metric_body(
        seeded, api, "ai.mention_rate", "series", **{"from": day(91), "to": day(0)}
    )

    for series in body["data"]:
        assert len(series["points"]) == 14
    assert [p["t"] for p in body["data"][0]["points"]] == _weeks(
        _today() - timedelta(days=91), _today()
    )
    too_long = await get_metric(
        seeded, api, "ai.mention_rate", "series", **{"from": day(92), "to": day(0)}
    )
    assert problem(too_long) == (422, "window_too_large")
    assert too_long.json()["limit_days"] == 92


async def test_the_meta_of_a_series_names_the_days_each_configuration_took_effect(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    window = {"from": day(40), "to": day(-1)}
    one = await metric_body(seeded, api, "ai.share_of_voice", "series", **window)
    assert "entity_config_changes" not in one["meta"]
    await two_versions(
        migrated,
        worker_db,
        import_store,
        seeded,
        (datetime(2026, 10, 3, 10, 0, tzinfo=UTC), datetime(2026, 11, 5, 23, 30, tzinfo=UTC)),
    )

    meta = (await metric_body(seeded, api, "ai.share_of_voice", "series", **window))["meta"]

    assert meta["entity_config_versions"] == [1, 2]
    assert meta["entity_config_changes"] == [
        {"version": 1, "from": "2026-10-03"},
        {"version": 2, "from": "2026-11-05"},
    ]


async def test_another_projects_and_workspaces_answers_are_not_in_a_series(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    asked = {"include_branded": "true", "entity_ids": f"{seeded.own},{seeded.rival}"}
    before = [
        (await get_metric(seeded, api, key, "series", **asked)).json()
        for key in ("ai.mention_rate", "ai.share_of_voice")
    ] + [(await get_metric(seeded, api, "ai.citation_rate", "series")).json()]
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    after = [
        (await get_metric(seeded, api, key, "series", **asked)).json()
        for key in ("ai.mention_rate", "ai.share_of_voice")
    ] + [(await get_metric(seeded, api, "ai.citation_rate", "series")).json()]

    assert after == before


async def test_a_series_that_nothing_answered_has_points_of_zero(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await metric_body(
        seeded,
        api,
        "ai.citation_rate",
        "series",
        **{"from": day(80), "to": day(60)},
    )

    for series in body["data"]:
        assert series["points"], series["engine_code"]
        for point in series["points"]:
            assert (point["value"], _counts(point)) == (None, (0, 0, 0))
            assert point["n_prompts"] == 0
