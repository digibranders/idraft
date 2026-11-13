"""Contract C8 (docs/ai-visibility/contracts/c8-metrics.md) and C5 (c5-competitors.md): the seven
Overview aggregate routes answer who may call them (401, 404, 403), refuse a value outside the
contract (422) and only then answer `501 not_implemented`, until WP-32 builds their bodies. The
notes are the spec: every worked example in them must be a body the models write."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import BaseModel

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from idraft.api.schemas import ai_metrics
from tests.api.ai.metrics_support import (
    BREAKDOWN,
    COMPETITOR_ROUTES,
    COMPETITORS,
    LONGEST,
    METRIC,
    METRIC_ROUTES,
    OVERVIEW,
    OVERVIEW_AI,
    ROUTES,
    SERIES,
    TOO_LONG,
    Route,
    World,
)
from tests.api.entities.support import problem
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
OK = (200, "ok")
# The routes WP-32 has built: a good request answers 200 and no longer 501.
BUILT = {OVERVIEW.name, OVERVIEW_AI.name, COMPETITORS.name}
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")
TOO_LARGE = (422, "window_too_large")

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
NOTES = Path(__file__).parents[4] / "docs" / "ai-visibility" / "contracts"
COMPARES = [route for route in ROUTES if route.compares]
NO_COMPARE = [route for route in ROUTES if not route.compares]
ENTITY_ID = "0000004a-7c1e-4a52-9b3d-00000000004a"


@pytest.fixture
async def world(api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer) -> World:
    return await World(api).build(resources, migrated)


def _answer(response: httpx.Response) -> tuple[int, str]:
    """The (status, code) of a problem; a success is `OK`."""
    return OK if response.status_code == 200 else problem(response)


def _reached(route: Route) -> tuple[int, str]:
    """What a good request answers: 200 on a built route, 501 on a stub."""
    return OK if route.name in BUILT else NOT_BUILT


def _codes(response: httpx.Response) -> set[tuple[str, str]]:
    """The (parameter, code) of every item of a 422."""
    return {(item["path"], item["code"]) for item in response.json()["errors"]}


async def test_every_route_checks_access_in_order(world: World) -> None:
    """A caller without a session gets 401, a member of another workspace 404 (a bad value does
    not turn it into a 422), a role without `data:read` 403; a reader gets the 422 of a bad
    value, and 501 for a good one."""
    for route in ROUTES:
        bad = {"compare": "previous_decade"} if route.compares else {"include_branded": "maybe"}
        for params, answer in ((bad, INVALID), (TOO_LONG, TOO_LARGE), ({}, _reached(route))):
            asked = {**route.needs, **params}
            url = world.url(route)

            anonymous = await world.api.get(url, params=asked)
            unseen = await world.api.get(url, params=asked, headers=world.outsider.headers)
            refused = await world.api.get(url, params=asked, headers=world.billing.headers)
            read = await world.api.get(url, params=asked, headers=world.viewer.headers)

            assert problem(anonymous) == (401, "unauthenticated"), route.name
            assert problem(unseen) == NOT_FOUND, route.name
            assert problem(refused) == FORBIDDEN, route.name
            assert _answer(read) == answer, (route.name, params)


@pytest.mark.parametrize("name", ["window", "panel_id", "tz", "subject", "prompt_ids", "engines"])
async def test_an_unknown_query_parameter_is_422(world: World, name: str) -> None:
    """The doc 19 parameters the contract does not accept are refused, not ignored (C8 C-1)."""
    for route in ROUTES:
        response = await world.read(route, **{name: "x"})

        assert problem(response) == INVALID, (route.name, name)
        assert (name, "extra_forbidden") in _codes(response), (route.name, name)


@pytest.mark.parametrize("name", ["compare", "compare_from", "compare_to"])
async def test_compare_is_not_accepted_by_series_and_breakdown(world: World, name: str) -> None:
    for route in NO_COMPARE:
        response = await world.read(route, **{name: "2026-01-01"})

        assert problem(response) == INVALID, route.name
        assert (name, "extra_forbidden") in _codes(response), route.name


async def test_compare_is_accepted_by_the_other_five(world: World) -> None:
    for route in COMPARES:
        for params in (
            {"compare": "previous_period"},
            {"compare": "previous_year"},
            {"compare": "none"},
            {"compare_from": "2025-12-01", "compare_to": "2025-12-28"},
        ):
            assert _answer(await world.read(route, **params)) == _reached(route), (
                route.name,
                params,
            )


@pytest.mark.parametrize(
    "params",
    [
        {"compare_from": "2025-12-01"},
        {"compare_to": "2025-12-28"},
        {"compare_from": "2025-12-28", "compare_to": "2025-12-01"},
        {"compare_from": "2025-12-01", "compare_to": "nope"},
    ],
)
async def test_a_compare_window_is_both_dates_in_order(
    world: World, params: dict[str, str]
) -> None:
    for route in COMPARES:
        assert problem(await world.read(route, **params)) == INVALID, (route.name, params)


async def test_a_window_is_at_most_92_days_and_in_order(world: World) -> None:
    for route in ROUTES:
        longest = await world.read(route, **LONGEST)
        too_long = await world.read(route, **TOO_LONG)
        backwards = await world.read(route, **{"from": "2026-01-10", "to": "2026-01-01"})
        nonsense = await world.read(route, **{"from": "2026-13-01"})

        assert _answer(longest) == _reached(route), route.name
        assert problem(too_long) == TOO_LARGE, route.name
        assert too_long.json()["limit_days"] == 92, route.name
        assert problem(backwards) == INVALID, route.name
        assert ("from", "range_invalid") in _codes(backwards), route.name
        assert problem(nonsense) == INVALID, route.name
    for route in COMPARES:
        response = await world.read(route, compare_from="2026-01-01", compare_to="2026-04-03")
        assert problem(response) == TOO_LARGE, route.name


async def test_the_scope_parameters_are_accepted_by_all_seven(world: World) -> None:
    scope = {
        "filter[engine_code_in]": "chatgpt_web,gemini_web",
        "include_branded": "true",
        "branded_only": "false",
        "filter[country_iso]": "US",
        "filter[term]": ENTITY_ID,
    }
    for route in ROUTES:
        assert _answer(await world.read(route, **scope)) == _reached(route), route.name


@pytest.mark.parametrize(
    "params",
    [
        {"filter[engine_code_in]": "bing"},
        {"filter[engine_code_in]": "chatgpt_web,gemini_web,google_ai_mode,chatgpt_web"},
        {"filter[country_iso]": "us"},
        {"filter[country_iso]": "USA"},
        {"filter[term]": "nope"},
        {"include_branded": "maybe"},
        {"compare": "previous_decade"},
    ],
)
async def test_a_scope_value_outside_its_bounds_is_422(
    world: World, params: dict[str, str]
) -> None:
    for route in ROUTES:
        if "compare" in params and not route.compares:
            continue
        assert problem(await world.read(route, **params)) == INVALID, (route.name, params)


@pytest.mark.parametrize("granularity", ["day", "month"])
async def test_granularity_day_and_month_are_422_with_the_field_code_not_built(
    world: World, granularity: str
) -> None:
    response = await world.read(SERIES, granularity=granularity)

    assert problem(response) == INVALID
    assert ("granularity", "not_built") in _codes(response)


async def test_granularity_week_is_the_only_value(world: World) -> None:
    assert problem(await world.read(SERIES, granularity="week")) == NOT_BUILT
    other = await world.read(SERIES, granularity="hour")
    assert problem(other) == INVALID
    assert ("granularity", "not_built") not in _codes(other)
    for route in [route for route in ROUTES if route is not SERIES]:
        response = await world.read(route, granularity="week")

        assert ("granularity", "extra_forbidden") in _codes(response), route.name


DIMENSIONS = [
    "topic",
    "intent",
    "funnel_stage",
    "engine",
    "country",
    "language",
    "persona",
    "prompt_type",
]


@pytest.mark.parametrize("dimension", DIMENSIONS)
async def test_the_breakdown_takes_each_of_the_eight_dimensions(
    world: World, dimension: str
) -> None:
    assert problem(await world.read(BREAKDOWN, dimension=dimension)) == NOT_BUILT


async def test_the_breakdown_needs_a_dimension_of_the_eight(world: World) -> None:
    missing = await world.api.get(world.url(BREAKDOWN), headers=world.viewer.headers)
    bogus = await world.read(BREAKDOWN, dimension="bogus")

    assert problem(missing) == INVALID
    assert ("dimension", "missing") in _codes(missing)
    assert problem(bogus) == INVALID
    assert ("dimension", "enum") in _codes(bogus) or ("dimension", "literal_error") in _codes(bogus)
    for route in [route for route in ROUTES if route is not BREAKDOWN]:
        response = await world.read(route, dimension="topic")
        assert ("dimension", "extra_forbidden") in _codes(response), route.name


@pytest.mark.parametrize("key", ["AI.Mention", "x" * 65, "1ai", "ai mention", "ai-mention", ".ai"])
async def test_a_metric_key_of_the_wrong_form_is_422(world: World, key: str) -> None:
    for route in _routes_of(key):
        assert problem(await world.read(route)) == INVALID, (key, route.tail)


def _routes_of(key: str) -> list[Route]:
    """Routes 3, 4 and 5 for one metric key."""
    base = ("ai", "metrics", key)
    return [
        Route("value", base, True),
        Route("series", (*base, "series"), False),
        Route("breakdown", (*base, "breakdown"), False, BREAKDOWN.needs),
    ]


async def test_a_metric_key_of_the_right_form_reaches_the_stub(world: World) -> None:
    for key in ("ai.mention_rate", "ai.outcome_mix.neither", "a", "x" * 64):
        for route in _routes_of(key):
            assert problem(await world.read(route)) == NOT_BUILT, (key, route.tail)


async def test_entity_ids_are_at_most_twenty_uuids_on_the_value_series_and_competitors(
    world: World,
) -> None:
    ids = [f"{n:08x}-7c1e-4a52-9b3d-{n:012x}" for n in range(21)]
    for route in (METRIC, SERIES, *COMPETITOR_ROUTES[:1]):
        at_most = await world.read(route, entity_ids=",".join(ids[:20]))
        # The competitors read is built: twenty ids that name no entity answer 200
        if route.name in BUILT:
            assert at_most.status_code == 200, route.name
        else:
            assert problem(at_most) == NOT_BUILT, route.name
        assert problem(await world.read(route, entity_ids=",".join(ids))) == INVALID, route.name
        assert problem(await world.read(route, entity_ids="nope")) == INVALID, route.name
    for route in (OVERVIEW, BREAKDOWN, COMPETITOR_ROUTES[1]):
        response = await world.read(route, entity_ids=ids[0])
        assert ("entity_ids", "extra_forbidden") in _codes(response), route.name


# Contract C8 and C5 published in the API document.
CLIENT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
PATHS = {
    "ai/metrics/overview": {"get"},
    "overview/ai": {"get"},
    "ai/metrics/{metric}": {"get"},
    "ai/metrics/{metric}/series": {"get"},
    "ai/metrics/{metric}/breakdown": {"get"},
    "ai/competitors": {"get"},
    "overview/competitors": {"get"},
}
SCOPE = {
    "from",
    "to",
    "filter[engine_code_in]",
    "include_branded",
    "branded_only",
    "filter[country_iso]",
    "filter[term]",
}
COMPARE = {"compare", "compare_from", "compare_to"}
# The query parameters of each route, besides the scope and the compare parameters.
OWN = {
    "ai/metrics/overview": set(),
    "overview/ai": set(),
    "ai/metrics/{metric}": {"entity_ids"},
    "ai/metrics/{metric}/series": {"entity_ids", "granularity"},
    "ai/metrics/{metric}/breakdown": {"dimension"},
    "ai/competitors": {"entity_ids", "include", "lost_limit", "sources_limit"},
    "overview/competitors": set(),
}


def _enums(schema: Any) -> set[str]:
    """Every value of every `enum` (and `const`, which a one value literal is) of a JSON schema."""
    found: set[str] = set()
    if isinstance(schema, dict):
        found.update(str(value) for value in schema.get("enum", []))
        if "const" in schema:
            found.add(str(schema["const"]))
        for child in schema.values():
            found |= _enums(child)
    elif isinstance(schema, list):
        for child in schema:
            found |= _enums(child)
    return found


def _operation(document: dict[str, Any], tail: str) -> dict[str, Any]:
    operation: dict[str, Any] = document["paths"][f"{CLIENT}/{tail}"]["get"]
    return operation


PATHS_WITHOUT_COMPARE = {"ai/metrics/{metric}/series", "ai/metrics/{metric}/breakdown"}


def test_the_api_document_has_the_seven_routes() -> None:
    document = build_openapi()
    schemas = document["components"]["schemas"]

    for tail, methods in PATHS.items():
        assert set(document["paths"][f"{CLIENT}/{tail}"]) == methods, tail
        names = {
            parameter["name"]
            for parameter in _operation(document, tail)["parameters"]
            if parameter["in"] == "query"
        }
        compare = set() if tail in PATHS_WITHOUT_COMPARE else COMPARE
        assert names == SCOPE | OWN[tail] | compare, tail
    breakdown = _operation(document, "ai/metrics/{metric}/breakdown")["parameters"]
    parameters = {
        parameter["name"]: parameter
        for tail in (
            "ai/metrics/{metric}/breakdown",
            "ai/competitors",
            "ai/metrics/{metric}/series",
        )
        for parameter in _operation(document, tail)["parameters"]
    }
    assert _enums(parameters["dimension"]) == set(DIMENSIONS)
    assert _enums(parameters["include"]) == {"lost_prompts", "top_sources"}
    assert _enums(parameters["granularity"]) == {"week"}
    assert parameters["dimension"]["required"] is True
    metric = next(p for p in breakdown if p["name"] == "metric")
    assert metric["in"] == "path"
    assert metric["schema"]["pattern"] == r"^[a-z][a-z0-9_.]{0,63}$"

    required = {name: set(schema.get("required", [])) for name, schema in schemas.items()}
    assert "metric" in required["AiMetricValue"]
    for name, member in (
        ("AiMetricValue", "previous"),
        ("AiMetricValue", "ci"),
        ("AiMetricValue", "pooled"),
        ("AiMetricValue", "suppressed_reason"),
        ("AiMetricPoint", "pool"),
        ("AiMetricPoint", "pooled"),
        ("AiCompetitorEngine", "lost_prompts"),
        ("AiCompetitor", "top_sources"),
        ("OverviewCompetitorRow", "seo"),
        ("OverviewCompetitors", "seo_other_domains"),
        ("AiMetricMeta", "compare_window"),
        ("AiMetricMeta", "previous_answers"),
        ("AiMetricMeta", "entity_config_changes"),
        ("AiOverview", "topics_in_scope"),
        ("AiCompetitorEngine", "lost_prompts_total"),
        ("AiCompetitorEngine", "lost_prompts_with_min_answers"),
    ):
        assert member in schemas[name]["properties"], (name, member)
        assert member not in required[name], (name, member)
    for name in (
        "AiOverviewResponse",
        "AiMetricResponse",
        "AiSeriesResponse",
        "AiBreakdownResponse",
        "AiCompetitorsResponse",
        "OverviewCompetitorsResponse",
    ):
        assert name in schemas, name


def test_ci_is_the_interval_of_doc_16_and_doc_19() -> None:
    """`{low, high, level: 0.95, method}`, as docs/16 section 2 and docs/19 section 2.6 write it."""
    ci = build_openapi()["components"]["schemas"]["AiCi"]

    assert set(ci["properties"]) == {"low", "high", "level", "method"}
    level = ci["properties"]["level"]
    assert (level["minimum"], level["maximum"]) == (0.95, 0.95)
    assert _enums(ci["properties"]["method"]) == {
        "wilson",
        "bootstrap_cluster",
        "normal_fixed_panel",
    }


def test_the_documented_routes_describe_what_they_will_do() -> None:
    """The text is final (F14): it says what the route returns, and nothing about a stub."""
    document = build_openapi()
    for tail in PATHS:
        operation = _operation(document, tail)
        text = f"{operation['summary']} {operation['description']}"

        assert operation["summary"], tail
        assert operation["description"], tail
        assert text.isascii(), tail
        assert not re.search(r"501|not built|not implemented|stub", text, re.IGNORECASE), tail


def _models() -> list[type[BaseModel]]:
    return [
        value
        for value in vars(ai_metrics).values()
        if isinstance(value, type)
        and issubclass(value, BaseModel)
        and value.__module__ == ai_metrics.__name__
    ]


def test_the_metric_models_describe_every_field() -> None:
    models = _models()
    assert len(models) >= 20
    for model in models:
        for name, info in model.model_fields.items():
            assert info.description, f"{model.__name__}.{name} has no description"
            assert info.description.isascii(), f"{model.__name__}.{name}"


EXAMPLE = re.compile(r"^Model: `(\w+)`\.\n\n```json\n(.*?)\n```", re.MULTILINE | re.DOTALL)
EXAMPLES = {
    "c8-metrics.md": [
        "AiOverviewResponse",
        "AiMetricResponse",
        "AiSeriesResponse",
        "AiBreakdownResponse",
    ],
    "c5-competitors.md": ["AiCompetitorsResponse", "OverviewCompetitorsResponse"],
}


@pytest.mark.parametrize("note", EXAMPLES)
def test_the_examples_in_the_notes_validate_against_the_models(note: str) -> None:
    """Every json block is a body the model writes back unchanged: nothing the model does not
    know, nothing left out that it writes, and an optional member present only when set."""
    found = EXAMPLE.findall((NOTES / note).read_text())

    assert [name for name, _ in found] == EXAMPLES[note]
    for name, block in found:
        model = getattr(ai_metrics, name)
        example = json.loads(block)

        written = model.model_validate(example).model_dump(mode="json", by_alias=True)

        assert written == example, name


def _example(note: str, name: str) -> dict[str, Any]:
    block = dict(EXAMPLE.findall((NOTES / note).read_text()))[name]
    example: dict[str, Any] = json.loads(block)
    return example


def _written(name: str, body: dict[str, Any]) -> dict[str, Any]:
    written: dict[str, Any] = (
        getattr(ai_metrics, name).model_validate(body).model_dump(mode="json", by_alias=True)
    )
    return written


def test_the_optional_context_members_are_absent_unless_set() -> None:
    """`topics_in_scope` and `entity_config_changes` are left out of the body when they are not
    set, and the three lost prompt members come and go together (they need
    `include=lost_prompts`, and a competitor row)."""
    overview = _example("c8-metrics.md", "AiOverviewResponse")
    assert "topics_in_scope" in overview["data"]
    assert "entity_config_changes" in overview["meta"]
    del overview["data"]["topics_in_scope"]
    del overview["meta"]["entity_config_changes"]
    bare = _written("AiOverviewResponse", overview)
    assert "topics_in_scope" not in bare["data"]
    assert "entity_config_changes" not in bare["meta"]

    lost = ("lost_prompts", "lost_prompts_total", "lost_prompts_with_min_answers")
    competitors = _example("c5-competitors.md", "AiCompetitorsResponse")
    entries = [entry for row in competitors["data"] for entry in row["by_engine"]]
    assert {tuple(key in entry for key in lost) for entry in entries} == {
        (True, True, True),
        (False, False, False),
    }
    for entry in entries:
        for key in lost:
            entry.pop(key, None)
    for entry in [
        e
        for row in _written("AiCompetitorsResponse", competitors)["data"]
        for e in row["by_engine"]
    ]:
        assert not set(lost) & set(entry)


def test_an_example_shows_that_value_is_not_successes_over_trials() -> None:
    """The headline of a prompt weighted rate is the mean of the prompts' rates (1.4 of 3 prompts),
    not the answers behind it (3 of 7): a client must not divide `pooled` itself."""
    body = _example("c8-metrics.md", "AiBreakdownResponse")
    cells = [value for row in body["data"] for value in row["values"]]

    assert any(
        cell["pooled"]["successes"] / cell["pooled"]["trials"] != cell["value"] for cell in cells
    )
    cell = cells[0]
    assert (cell["numerator"], cell["denominator"], cell["pooled"]) == (
        1.4,
        3.0,
        {"successes": 3, "trials": 7},
    )


def test_the_overview_route_is_declared_before_the_metric_route() -> None:
    document = build_openapi()
    paths = list(document["paths"])

    assert paths.index(f"{CLIENT}/ai/metrics/overview") < paths.index(
        f"{CLIENT}/ai/metrics/{{metric}}"
    )
    assert METRIC_ROUTES.index(OVERVIEW) < METRIC_ROUTES.index(METRIC)
