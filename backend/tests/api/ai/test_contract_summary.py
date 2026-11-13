"""Contract C2, prompts summary (docs/ai-visibility/contracts/c2-summary.md): each addition
answers 501 once the caller may use the route; left out, the summary answers as before."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from idraft.api.schemas.ai import EngineSummary, EntityCells, WeekCells
from tests.api.ai import test_prompts_summary
from tests.api.ai.support import ai_project
from tests.api.ai.test_prompts_summary import Summary, _summary
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

SUMMARY_PATH = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary"
# The seeded world of the summary tests: six prompts, two engines, answers over several weeks.
seeded = test_prompts_summary.summary
# A fixed id: the test ids hold it, and every xdist worker must collect the same ones.
_UUID = uuid.UUID("3b1c5f0e-7a64-4d52-9c0a-1f2e8d6b4a97")

# Every value of the contract the summary does not build yet, one for each parameter at least.
NOT_BUILT_OPTIONS = [
    {"include": "series,co_mentions"},
    {"include": "total,co_mentions"},
    {"filter[outcome]": "neither"},
    {"filter[opportunity]": "named_not_cited"},
    {"filter[opportunity]": f"lost_to:{_UUID}"},
    {"group_by": "country"},
]


@pytest.mark.parametrize("params", NOT_BUILT_OPTIONS, ids=str)
async def test_a_summary_option_that_is_not_built_answers_501(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params=params,
        headers=viewer.headers,
    )

    assert problem(response) == NOT_BUILT


async def test_the_summary_checks_access_before_it_says_not_built(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "prompts-summary")
    params = {"include": "co_mentions"}

    refused = await api.get(url, params=params, headers=billing.headers)
    unseen = await api.get(url, params=params, headers=outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(unseen) == NOT_FOUND


@pytest.mark.parametrize("params", NOT_BUILT_OPTIONS, ids=str)
async def test_every_unbuilt_option_is_refused_to_a_member_who_may_not_read(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params=params,
        headers=billing.headers,
    )

    assert problem(response) == FORBIDDEN


async def test_the_summary_checks_access_before_it_checks_a_value(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params={"compare": "previous_decade"},
        headers=billing.headers,
    )

    assert problem(response) == FORBIDDEN


async def test_a_value_out_of_the_contract_is_refused_before_one_not_built(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params={"group_by": "language", "include": "co_mentions"},
        headers=viewer.headers,
    )

    assert problem(response) == INVALID


@pytest.mark.parametrize(
    "params",
    [
        {"compare": "previous_decade"},
        {"compare_from": "2026-01-01"},
        {"compare_to": "2026-01-10"},
        {"compare_from": "2026-01-10", "compare_to": "2026-01-01"},
        {"compare_from": "2026-01-01", "compare_to": "nope"},
        {"rows": "all"},
        {"filter[opportunity]": "lost_to:nope"},
        {"filter[opportunity]": "xnamed_not_citedx"},
        {"filter[opportunity]": "xnamed_not_cited"},
        {"filter[opportunity]": "named_not_citedx"},
        {"filter[opportunity]": "named_not_cited\n"},
        {"filter[opportunity]": f"xlost_to:{_UUID}"},
        {"filter[opportunity]": f"lost_to:{_UUID}x"},
        {"filter[opportunity]": f"lost_to:{_UUID}\n"},
        {"filter[opportunity]": f"lost_to:{_UUID}0"},
        {"filter[opportunity]": f"lost_to:{str(_UUID).upper()}"},
        {"group_by": "language"},
        {"filter[outcome]": "lost"},
    ],
    ids=str,
)
async def test_an_option_value_out_of_the_contract_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params=params,
        headers=viewer.headers,
    )

    assert problem(response) == INVALID


async def test_a_compare_window_is_at_most_92_days(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "prompts-summary")

    longest = await api.get(
        url,
        params={"compare_from": "2026-01-01", "compare_to": "2026-04-02"},
        headers=viewer.headers,
    )
    too_long = await api.get(
        url,
        params={"compare_from": "2026-01-01", "compare_to": "2026-04-03"},
        headers=viewer.headers,
    )

    assert longest.status_code == 200, longest.text
    assert problem(too_long) == (422, "window_too_large")
    assert too_long.json()["limit_days"] == 92


@pytest.mark.parametrize(
    "params",
    [
        {"compare": "previous_period"},
        {"compare": "previous_year"},
        {"compare_from": "2026-01-05", "compare_to": "2026-01-10"},
        {"compare": "none", "compare_from": "2026-01-05", "compare_to": "2026-01-10"},
    ],
    ids=str,
)
async def test_every_compare_option_is_built_and_states_its_window(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params=params,
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert set(data["compare_window"]) == {"from", "to", "timezone"}
    assert data["previous_answers"] == 0


TOTAL_AND_ROWS_OPTIONS = [
    {"include": "total"},
    {"rows": "topics"},
    {"rows": "none"},
    {"include": "total", "rows": "none"},
    {"include": "series,entities,total", "rows": "topics", "compare": "previous_period"},
]


@pytest.mark.parametrize("params", TOTAL_AND_ROWS_OPTIONS, ids=str)
async def test_the_total_and_rows_options_are_built(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    billing = await member(resources, migrated, workspace, "billing")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "prompts-summary")

    response = await api.get(url, params=params, headers=viewer.headers)
    refused = await api.get(url, params=params, headers=billing.headers)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert ("total" in data) == ("total" in params.get("include", ""))
    if params.get("rows") == "none":
        assert (data["prompts"], data["topics"]) == ([], [])
    assert problem(refused) == FORBIDDEN


def test_the_api_document_no_longer_says_total_and_rows_are_not_built() -> None:
    document = build_openapi()
    parameters = {
        item["name"]: item for item in document["paths"][SUMMARY_PATH]["get"]["parameters"]
    }
    total = document["components"]["schemas"]["PromptsSummary"]["properties"]["total"]

    assert "Not built yet" not in parameters["rows"]["description"]
    assert "`total` and `co_mentions` are not built" not in parameters["include"]["description"]
    assert "`total`; `co_mentions` is not built" in parameters["include"]["description"]
    assert "Not returned yet" not in total["description"]
    assert "include=total" in total["description"]
    # Still not built: the sentence of the route names what remains, and not what was built.
    route = document["paths"][SUMMARY_PATH]["get"]["description"]
    assert "`include=total`, `include=co_mentions`" not in route
    assert "`include=co_mentions`, `filter[outcome]`" in route


@pytest.mark.parametrize(
    "params", [{}, {"compare": "none"}, {"include": "series,entities"}], ids=str
)
async def test_the_defaults_and_the_built_options_answer_as_before(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    params: dict[str, str],
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "prompts-summary"),
        params=params,
        headers=viewer.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    for absent in ("compare_window", "previous_answers", "total", "co_mentions", "by_country"):
        assert absent not in data


@pytest.mark.parametrize("params", [{}, {"include": "series,entities"}], ids=str)
async def test_the_additions_are_left_out_of_a_summary_that_does_not_build_them(
    api: httpx.AsyncClient, seeded: Summary, params: dict[str, str]
) -> None:
    response = await _summary(seeded, api, **params)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    engines = [engine for row in (*data["prompts"], *data["topics"]) for engine in row["engines"]]
    assert engines
    for engine in engines:
        assert "previous" not in engine
        for point in engine.get("series", []):
            assert "entities" not in point
        for cells in engine.get("entities", []):
            assert "previous" not in cells
    if params:
        # Something is there to carry the nested keys, so their absence is not vacuous.
        assert all(engine["series"] and engine["entities"] for engine in engines)


def _cell() -> dict[str, object]:
    return {"value": None, "numerator": 0, "denominator": 0, "n_observations": 0}


def test_a_summary_without_the_additions_is_a_valid_summary() -> None:
    outcomes = {
        name: _cell() for name in ("mentioned_and_cited", "mentioned_only", "cited_only", "neither")
    }
    engine = {
        "engine_code": "chatgpt_web",
        "mentioned": _cell(),
        "cited": _cell(),
        "outcomes": outcomes,
        "share_of_voice": _cell(),
    }
    week = {
        "week_start": "2026-01-05",
        "prompts": 0,
        "is_pooled": False,
        "mentioned": _cell(),
        "cited": _cell(),
        "share_of_voice": _cell(),
    }
    entity = {
        "entity_id": str(uuid.uuid4()),
        "mentioned": _cell(),
        "share_of_voice": _cell(),
    }

    assert "previous" not in EngineSummary.model_validate(engine).model_dump(mode="json")
    point = WeekCells.model_validate(week).model_dump(mode="json")
    assert "entities" not in point
    assert "pool" not in point
    assert "previous" not in EntityCells.model_validate(entity).model_dump(mode="json")


def test_the_api_document_has_no_trace_of_the_not_asked_default() -> None:
    """`previous` is left out when no compare was asked and null when there is no data; the
    sentinel that tells them apart stays out of the document: no component of its own, and the
    property is an optional `Inner or null`."""
    schemas = build_openapi()["components"]["schemas"]

    assert not [name for name in schemas if "asked" in name.lower()]
    for model, inner in (("EngineSummary", "EngineCells"), ("EntityCells", "EntityPreviousCells")):
        assert schemas[model]["properties"]["previous"]["anyOf"] == [
            {"$ref": f"#/components/schemas/{inner}"},
            {"type": "null"},
        ]
        assert "previous" not in schemas[model].get("required", [])


def test_the_api_document_has_the_summary_additions() -> None:
    document = build_openapi()
    schemas = document["components"]["schemas"]

    parameters = document["paths"][SUMMARY_PATH]["get"]["parameters"]
    names = {parameter["name"] for parameter in parameters}
    assert {
        "compare",
        "compare_from",
        "compare_to",
        "rows",
        "filter[outcome]",
        "filter[opportunity]",
        "group_by",
    } <= names
    compare = next(item for item in parameters if item["name"] == "compare")
    assert set(compare["schema"]["enum"]) == {"none", "previous_period", "previous_year"}
    include = next(item for item in parameters if item["name"] == "include")
    array = next(option for option in include["schema"]["anyOf"] if option["type"] == "array")
    assert set(array["items"]["enum"]) == {
        "series",
        "entities",
        "total",
        "co_mentions",
    }

    for name in (
        "EngineCells",
        "EntityPreviousCells",
        "SummaryTotal",
        "CoMentionPair",
        "EngineCoMentions",
        "CountrySummary",
        "PointPool",
    ):
        assert name in schemas, name
    # The point fields that are always there (C-10) are required; `pool` is not.
    assert {"prompts", "is_pooled"} <= set(schemas["WeekCells"]["required"])
    assert set(schemas["PointPool"]["required"]) == {"weeks", "window", "reason", "below_prompts"}
    assert schemas["PointPool"]["properties"]["reason"]["enum"] == ["prompt_point", "few_prompts"]

    optional = {
        "EngineSummary": {"previous"},
        "EntityCells": {"previous"},
        "WeekCells": {"entities", "pool"},
        "PromptsSummary": {
            "compare_window",
            "previous_answers",
            "total",
            "co_mentions",
            "by_country",
        },
    }
    for name, fields in optional.items():
        assert fields <= set(schemas[name]["properties"]), name
        assert not fields & set(schemas[name].get("required", [])), name
