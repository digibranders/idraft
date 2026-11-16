"""The Links tab (spec 7.3)."""

from __future__ import annotations

import csv
import io

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_edges_filter_by_tier_and_worklist_template_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, _, tiers = await read_site(migrated, workspace, project)
    url = project_url(workspace, project, "internal-links", "edges")

    to_t1 = await api.get(
        url, params={"scope": "all", "filter[target_tier]": str(tiers[0])}, headers=viewer.headers
    )
    broken = await api.get(
        url,
        params={"scope": "all", "filter[worklist]": "broken_and_redirected"},
        headers=viewer.headers,
    )

    assert [(row["source"]["path"], row["scope"]) for row in to_t1.json()["data"]] == [
        ("/", "template"),
        ("/blog/a", "editorial"),
    ]
    assert {
        (row["target"]["path"], row["target"]["status_code"]) for row in broken.json()["data"]
    } == {("/old", 301), ("/gone", 404)}
    assert to_t1.json()["data"][0]["target"]["tier"]["code"] == "T1"


async def test_edges_filter_by_placement_status_page_and_path_and_the_csv_matches_the_list(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, ids, _ = await read_site(migrated, workspace, project)
    for anchor, new in (("Old", "=cmd()"), ("Gone", "@home"), ("Next", "+1"), ("Previous", "-1")):
        await execute(
            migrated,
            "UPDATE seo.crawl_links SET anchor = $2 WHERE anchor = $1 AND workspace_id = $3",
            anchor,
            new,
            workspace.id,
        )
    url = project_url(workspace, project, "internal-links", "edges")
    asked: list[dict[str, str | int]] = [
        {"scope": "all", "filter[placement]": "content,navigation"},
        {"scope": "all", "filter[target_status]": "3xx,4xx"},
        {"scope": "all", "filter[source]": ids["/blog/b"]},
        {"scope": "all", "filter[target]": ids["/blog/a"], "q_source": "blog"},
        {"scope": "auto_generated", "q_target": "/blog"},
        {},
    ]

    for params in asked:
        as_json = await api.get(url, params={**params, "limit": 200}, headers=viewer.headers)
        as_csv = await api.get(url, params={**params, "format": "csv"}, headers=viewer.headers)

        rows = list(csv.DictReader(io.StringIO(as_csv.text)))
        listed = as_json.json()["data"]
        assert [(row["source_url"], row["target_url"], row["scope"]) for row in rows] == [
            (edge["source"]["url"], edge["target"]["url"], edge["scope"]) for edge in listed
        ], params
        assert len(rows) == as_json.json()["meta"]["total"], params
        assert not any(row["anchor"].startswith(("=", "+", "-", "@")) for row in rows), params
    only = await api.get(
        url, params={"scope": "all", "filter[target_status]": "3xx,4xx"}, headers=viewer.headers
    )
    assert {edge["target"]["path"] for edge in only.json()["data"]} == {"/old", "/gone"}
    by_source = await api.get(
        url, params={"scope": "all", "filter[source]": ids["/blog/b"]}, headers=viewer.headers
    )
    assert {edge["source"]["path"] for edge in by_source.json()["data"]} == {"/blog/b"}
    quoted = await api.get(
        url,
        params={"scope": "all", "format": "csv", "filter[source]": ids["/blog/b"]},
        headers=viewer.headers,
    )
    assert {row["anchor"] for row in csv.DictReader(io.StringIO(quoted.text))} == {
        "'=cmd()",
        "'@home",
        "'-1",
    }


async def test_an_empty_tier_filter_is_a_validation_error_on_the_pages_and_the_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    for route, name in (
        ("pages", "filter[tier]"),
        ("edges", "filter[source_tier]"),
        ("edges", "filter[target_tier]"),
    ):
        url = project_url(workspace, project, "internal-links", route)
        for empty in ("", ","):
            refused = await api.get(url, params={name: empty}, headers=viewer.headers)
            assert problem(refused) == (422, "validation_failed"), (route, name, empty)
        as_csv = await api.get(url, params={name: "", "format": "csv"}, headers=viewer.headers)
        assert problem(as_csv) == (422, "validation_failed"), (route, name)
