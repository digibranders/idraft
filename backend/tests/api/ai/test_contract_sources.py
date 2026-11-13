"""The contract additions of the cited sources reads (WP-03 T3a; CF-07 to CF-10, OV-N6, OV-N7,
BE-SOURCES-05, BE-SOURCES-06): a request that uses one answers `501 not_implemented` after the
access checks, a request that does not answers as before. WP-14 deletes this file when it writes
the real tests."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.sources_support import GUIDE, Cite, answer, make_world
from tests.api.ai.support import ai_project
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("sources/domains", {"include": "cited_with"}),
        ("sources/domains", {"include": "by_role_by_engine"}),
        ("sources/domains", {"include": "series,cited_with"}),
        ("sources/domains", {"min_support": "2"}),
        ("sources/pages", {"min_support": "2"}),
        ("sources/domains", {"include_unresolved_redirects": "true"}),
        ("sources/pages", {"include_engine_internal": "true"}),
        ("fanout-queries", {"include": "topics"}),
    ],
)
async def test_a_source_addition_answers_501(
    path: str,
    params: dict[str, str],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", path), params=params, headers=viewer.headers
    )

    assert problem(response) == NOT_BUILT


async def test_source_changes_answers_501(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "sources", "changes"),
        params={"kind": "lost", "min_support": "3"},
        headers=viewer.headers,
    )

    assert problem(response) == NOT_BUILT


NEW_ROUTES = ["sources/diversity", "sources/domains/g2.com", "sources/prompts"]


@pytest.mark.parametrize("path", NEW_ROUTES)
async def test_a_new_source_route_answers_501(
    path: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(project_url(workspace, project, "ai", path), headers=viewer.headers)

    assert problem(response) == NOT_BUILT


@pytest.mark.parametrize("path", NEW_ROUTES)
async def test_a_new_source_route_checks_access_first(
    path: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", path)

    assert problem(await api.get(url, headers=billing.headers)) == FORBIDDEN
    assert problem(await api.get(url, headers=outsider.headers)) == NOT_FOUND


async def test_a_registrable_domain_longer_than_253_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", "sources", "domains", "a" * 250 + ".com"),
        headers=viewer.headers,
    )

    assert problem(response) == INVALID


@pytest.mark.parametrize(
    ("path", "params"),
    [("sources/changes", {}), ("sources/domains", {"include": "series"})],
)
async def test_the_source_reads_check_access_first(
    path: str,
    params: dict[str, str],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    billing = await member(resources, migrated, workspace, "billing")
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", path)

    assert problem(await api.get(url, params=params, headers=billing.headers)) == FORBIDDEN
    assert problem(await api.get(url, params=params, headers=outsider.headers)) == NOT_FOUND


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("sources/pages", {"include": "cited_with"}),
        ("sources/changes", {"kind": "gone"}),
        ("sources/changes", {"min_support": "0"}),
        ("sources/changes", {"min_support": "1001"}),
        ("sources/domains", {"filter[country_iso]": "us"}),
        ("sources/domains", {"include": "series,cited_with,by_role_by_engine,series"}),
        ("sources/pages", {"include": "series,series"}),
        ("sources/diversity", {"include": "pages"}),
        ("sources/diversity", {"include": "series,ads,series"}),
        ("fanout-queries", {"include": "series"}),
        ("sources/prompts", {"filter[own_cited]": "maybe"}),
        ("sources/prompts", {"limit": "201"}),
    ],
)
async def test_an_addition_out_of_bounds_is_refused(
    path: str,
    params: dict[str, str],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(
        project_url(workspace, project, "ai", path), params=params, headers=viewer.headers
    )

    assert problem(response) == INVALID


@pytest.mark.parametrize("path", ["sources/domains", "sources/pages"])
async def test_the_source_reads_without_additions_answer_as_before(
    path: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)

    response = await api.get(project_url(workspace, project, "ai", path), headers=viewer.headers)

    assert response.status_code == 200, response.text
    meta = response.json()["meta"]
    assert "series" not in meta
    assert "by_role_by_engine" not in meta


@pytest.mark.parametrize("path", ["sources/domains", "sources/pages"])
async def test_a_plain_source_row_holds_none_of_the_added_fields(
    path: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite(), Cite(GUIDE)])

    response = await api.get(world.url("ai", path), headers=world.owner.headers)

    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert rows
    for row in rows:
        assert not {"series", "cited_with", "category", "category_source"} & row.keys()


def _parameters(operation: dict[str, Any]) -> set[str]:
    return {parameter["name"] for parameter in operation["parameters"]}


def _bound(schema: dict[str, Any], keyword: str) -> Any:
    """A bound of a field, whether the field is nullable (`anyOf`) or not."""
    for candidate in schema.get("anyOf", [schema]):
        if keyword in candidate:
            return candidate[keyword]
    return None


def test_the_api_document_has_the_source_additions() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai"

    assert f"{prefix}/sources/changes" in paths
    for path in ("sources/domains", "sources/pages", "citations", "fanout-queries"):
        assert "filter[country_iso]" in _parameters(paths[f"{prefix}/{path}"]["get"]), path
    for path in ("sources/domains", "sources/pages"):
        names = _parameters(paths[f"{prefix}/{path}"]["get"])
        assert {"include", "min_support"} <= names, path
    for name in (
        "SourceWeekUnits",
        "CitedWith",
        "SourcesWeek",
        "RoleAnswers",
        "EngineRoleUnits",
        "SourceChangeRow",
        "SourceChangesMeta",
        "SourceChangePage",
    ):
        assert name in schemas, name
    optional = {
        "SourceDomainRow": ("series", "cited_with", "category", "category_source"),
        "SourcePageRow": ("series",),
        "SourcesMeta": ("series", "by_role_by_engine"),
    }
    for model, fields in optional.items():
        for field in fields:
            assert field in schemas[model]["properties"], (model, field)
            assert field not in schemas[model].get("required", []), (model, field)
    for model, field, bound in (
        ("SourceDomainRow", "series", 14),
        ("SourcePageRow", "series", 14),
        ("SourcesMeta", "series", 14),
        ("SourcesMeta", "by_role_by_engine", 3),
        ("SourceChangesMeta", "engine_codes", 3),
    ):
        assert _bound(schemas[model]["properties"][field], "maxItems") == bound, (model, field)
    for model, field, bound in (
        ("SourceDomainRow", "category", 64),
        ("SourceChangeRow", "registrable_domain", 253),
    ):
        assert _bound(schemas[model]["properties"][field], "maxLength") == bound, (model, field)
    for path, bound in (("sources/domains", 3), ("sources/pages", 1)):
        (include,) = (
            parameter
            for parameter in paths[f"{prefix}/{path}"]["get"]["parameters"]
            if parameter["name"] == "include"
        )
        # The house list parameters (`filter[engine_code_in]`) publish their bound as `maxLength`.
        assert include["schema"]["maxLength"] == bound, path


def _parameter(operation: dict[str, Any], name: str) -> dict[str, Any]:
    found: list[dict[str, Any]] = [
        parameter for parameter in operation["parameters"] if parameter["name"] == name
    ]
    assert len(found) == 1, name
    return found[0]


def test_the_api_document_has_the_new_source_routes() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai"

    for path in ("sources/diversity", "sources/domains/{registrable_domain}", "sources/prompts"):
        assert f"{prefix}/{path}" in paths, path
    for name in (
        "SourceDiversity",
        "SourceDiversityEngine",
        "SourceDiversityMeta",
        "DiversityWeek",
        "AdPresence",
        "SourceDomainDetail",
        "SourceDomainDetailData",
        "DomainEngineSeries",
        "DomainEngineWeek",
        "DomainPrompt",
        "PromptOwnPagesPage",
        "PromptOwnPagesRow",
        "PromptOwnPagesMeta",
        "OwnPage",
        "FanoutTopic",
    ):
        assert name in schemas, name

    topics = schemas["FanoutQueryRow"]["properties"]["topics"]
    assert "topics" not in schemas["FanoutQueryRow"].get("required", [])
    assert _bound(topics, "maxItems") == 10
    assert schemas["SourceDiversity"]["properties"]["data"]["maxItems"] == 3
    assert _bound(schemas["SourceDiversityMeta"]["properties"]["engine_codes"], "maxItems") == 3
    assert _bound(schemas["SourceDiversityEngine"]["properties"]["series"], "maxItems") == 14
    for field, bound in (
        ("rows", 10),
        ("top_pages", 10),
        ("prompts", 20),
        ("cited_with", 5),
        ("engines", 3),
    ):
        detail = schemas["SourceDomainDetailData"]["properties"][field]
        assert detail["maxItems"] == bound, field

    diversity = paths[f"{prefix}/sources/diversity"]["get"]
    fanout = paths[f"{prefix}/fanout-queries"]["get"]
    assert _parameter(diversity, "include")["schema"]["maxLength"] == 2
    assert _parameter(fanout, "include")["schema"]["maxLength"] == 1
    prompts = paths[f"{prefix}/sources/prompts"]["get"]
    assert "filter[own_cited]" in _parameters(prompts)
    # The rows have no array bound: the keyset page's `limit` is what bounds them.
    assert _parameter(prompts, "limit")["schema"]["maximum"] == 200
    for path in (
        "sources/domains",
        "sources/pages",
        "sources/changes",
        "sources/diversity",
        "sources/domains/{registrable_domain}",
        "sources/prompts",
    ):
        operation = paths[f"{prefix}/{path}"]["get"]
        for name in ("include_unresolved_redirects", "include_engine_internal"):
            assert _parameter(operation, name)["schema"]["default"] is False, (path, name)
