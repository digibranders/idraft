"""Request ids of core.urls travel as strings, like the ids in responses: a 64-bit id does not
survive a JSON number in a browser (the web client types them as strings)."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import seed_crawl
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

PROJECT = "/api/v1/workspaces/{workspace_id}/projects/{project_id}"
ABOVE_JS_SAFE = "9007199254740993"
INT64_MAX = "9223372036854775807"


def _parameter(document: dict[str, Any], path: str, method: str, name: str) -> dict[str, Any]:
    operation = document["paths"][path][method]
    return next(p for p in operation["parameters"] if p["name"] == name)


def _types(schema: dict[str, Any]) -> set[str]:
    options = schema.get("anyOf") or [schema]
    return {str(option["type"]) for option in options if "type" in option}


def test_the_document_types_every_request_id_as_a_string() -> None:
    document = build_openapi()
    base = f"{PROJECT}/internal-links"

    path_id = _parameter(document, f"{base}/pages/{{url_id}}", "get", "url_id")
    neighbors = _parameter(document, f"{base}/neighbors", "get", "url_id")
    source = _parameter(document, f"{base}/edges", "get", "filter[source]")
    target = _parameter(document, f"{base}/edges", "get", "filter[target]")
    for parameter in (path_id, neighbors, source, target):
        assert _types(parameter["schema"]) - {"null"} == {"string"}, parameter

    tiers = document["components"]["schemas"]["PageTierSet"]["properties"]["url_ids"]
    items = (tiers.get("anyOf") or [tiers])[0]["items"]
    assert items["type"] == "string"


@pytest.mark.parametrize("raw", [ABOVE_JS_SAFE, INT64_MAX])
async def test_an_id_above_the_safe_range_of_a_json_number_is_a_valid_string_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, raw: str
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "internal-links")

    page = await api.get(f"{url}/pages/{raw}", headers=viewer.headers)
    edges = await api.get(
        f"{url}/edges",
        params={"filter[source]": raw, "filter[target]": raw},
        headers=viewer.headers,
    )
    neighbors = await api.get(
        f"{url}/neighbors", params={"url_id": raw, "direction": "in"}, headers=viewer.headers
    )

    # The id is valid and in no crawl: not found, never a validation error.
    assert (page.status_code, neighbors.status_code) == (404, 404)
    assert edges.status_code == 200
    assert edges.json()["data"] == []


@pytest.mark.parametrize("raw", ["0", "-1", "01", "9223372036854775808", "abc", "1.5", " 7", ""])
async def test_a_request_id_that_is_not_a_positive_int64_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, raw: str
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "internal-links")

    page = await api.get(f"{url}/pages/{raw or '%20'}", headers=viewer.headers)
    edges = await api.get(f"{url}/edges", params={"filter[source]": raw}, headers=viewer.headers)

    assert page.status_code in (404, 422)
    assert edges.status_code == 422


async def test_bulk_bodies_take_string_ids_and_still_whole_numbers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/", 200), ("/a", 200)])
    first, second = list(ids.values())[:2]
    url = project_url(workspace, project, "pages", "tiers", "reset")

    as_strings = await api.post(
        url, json={"url_ids": [str(first), ABOVE_JS_SAFE]}, headers=editor.headers
    )
    as_numbers = await api.post(url, json={"url_ids": [second]}, headers=editor.headers)
    refused = await api.post(url, json={"url_ids": ["0"]}, headers=editor.headers)

    assert as_strings.status_code == 200, as_strings.text
    assert as_numbers.status_code == 200, as_numbers.text
    assert refused.status_code == 422
