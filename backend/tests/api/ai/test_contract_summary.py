"""Contract C2, prompts summary (docs/ai-visibility/contracts/c2-summary.md): each addition
answers 501 once the caller may use the route; left out, the summary answers as before."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.support import ai_project
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

SUMMARY_PATH = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary"


@pytest.mark.parametrize(
    "params",
    [
        {"compare": "previous_period"},
        {"include": "total"},
        {"include": "series,co_mentions"},
        {"rows": "topics"},
        {"rows": "none"},
        {"filter[outcome]": "neither"},
        {"filter[opportunity]": "named_not_cited"},
        {"filter[opportunity]": f"lost_to:{uuid.uuid4()}"},
        {"group_by": "country"},
    ],
)
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
    params = {"compare": "previous_period"}

    refused = await api.get(url, params=params, headers=billing.headers)
    unseen = await api.get(url, params=params, headers=outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(unseen) == NOT_FOUND


@pytest.mark.parametrize(
    "params",
    [
        {"compare": "previous_year"},
        {"rows": "all"},
        {"filter[opportunity]": "lost_to:nope"},
        {"group_by": "language"},
        {"filter[outcome]": "lost"},
    ],
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


def test_the_api_document_has_the_summary_additions() -> None:
    document = build_openapi()
    schemas = document["components"]["schemas"]

    parameters = document["paths"][SUMMARY_PATH]["get"]["parameters"]
    names = {parameter["name"] for parameter in parameters}
    assert {"compare", "rows", "filter[outcome]", "filter[opportunity]", "group_by"} <= names
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
    ):
        assert name in schemas, name

    optional = {
        "EngineSummary": {"previous"},
        "EntityCells": {"previous"},
        "WeekCells": {"entities"},
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
