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
from tests.api.ai.support import ai_project
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

COUNTRY = {"filter[country_iso]": "US"}


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("sources/domains", {"include": "series"}),
        ("sources/domains", {"include": "cited_with"}),
        ("sources/domains", {"include": "by_role_by_engine"}),
        ("sources/domains", {"min_support": "2"}),
        ("sources/pages", {"include": "series"}),
        ("sources/pages", {"min_support": "2"}),
        ("sources/domains", COUNTRY),
        ("sources/pages", COUNTRY),
        ("citations", COUNTRY),
        ("fanout-queries", COUNTRY),
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
        ("sources/domains", {"filter[country_iso]": "us"}),
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


def _parameters(operation: dict[str, Any]) -> set[str]:
    return {parameter["name"] for parameter in operation["parameters"]}


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
