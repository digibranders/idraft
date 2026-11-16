"""CSV import of tiers: url and tier, pending rows, errors by line (spec 5.2)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import seed_crawl, seed_tiers, set_website
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_rows_apply_and_unknown_urls_are_kept_as_pending(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/", 200), ("/pricing", 200)])
    csv = (
        "url,tier\nhttps://example.com/pricing,T1\nhttps://example.com/new-page,supporting pages\n"
    )

    response = await api.post(
        project_url(workspace, project, "pages", "tiers", "import"),
        json={"csv": csv},
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["accepted"], data["applied"], data["errors"]) == (2, True, [])
    assert data["pending"] == [{"line": 3, "url": "https://example.com/new-page"}]
    rows = await fetch(
        migrated, "SELECT url_id, tier_id FROM core.project_pages WHERE project_id = $1", project
    )
    tiers = {row["url_id"]: row["tier_id"] for row in rows}
    assert tiers[ids["/pricing"]] == t1
    assert t2 in tiers.values()


async def test_any_error_applies_nothing_and_names_its_line(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, [("/pricing", 200)])
    csv = "url,tier\nhttps://example.com/pricing,T1\nhttps://example.com/x,Gold\nnot a url,T2\n"

    response = await api.post(
        project_url(workspace, project, "pages", "tiers", "import"),
        json={"csv": csv},
        headers=editor.headers,
    )

    data = response.json()["data"]
    assert data["applied"] is False
    assert [(error["line"], error["code"]) for error in data["errors"]] == [
        (3, "unknown_tier"),
        (4, "invalid_url"),
    ]
    written = await fetch(
        migrated, "SELECT 1 FROM core.project_pages WHERE project_id = $1", project
    )
    assert written == []


async def test_other_sites_foreign_tiers_and_a_missing_column_are_errors(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    await seed_tiers(migrated, workspace)
    other = await make_workspace(migrated, name="Other")
    foreign_tier, *_ = await seed_tiers(migrated, other)
    await execute(
        migrated,
        "UPDATE core.page_tier_levels SET name = 'Their secret tier' WHERE id = $1",
        foreign_tier,
    )
    url = project_url(workspace, project, "pages", "tiers", "import")
    csv = "﻿url,tier\nhttps://elsewhere.org/page,T1\nhttps://example.com/a,Their secret tier\n"

    refused = await api.post(url, json={"csv": csv}, headers=editor.headers)
    no_column = await api.post(url, json={"csv": "page,level\n/a,T1\n"}, headers=editor.headers)

    assert [(e["line"], e["code"]) for e in refused.json()["data"]["errors"]] == [
        (2, "other_site"),
        (3, "unknown_tier"),
    ]
    assert [(e["line"], e["code"]) for e in no_column.json()["data"]["errors"]] == [
        (1, "missing_column")
    ]
    written = await fetch(
        migrated, "SELECT 1 FROM core.project_pages WHERE project_id = $1", project
    )
    assert written == []


async def test_a_project_without_a_website_takes_no_rows_and_viewers_cannot_import(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    url = project_url(workspace, project, "pages", "tiers", "import")
    csv = "url,tier\nhttps://example.com/a,T1\n"

    blank = await api.post(url, json={"csv": csv}, headers=editor.headers)
    denied = await api.post(url, json={"csv": csv}, headers=viewer.headers)

    assert [e["code"] for e in blank.json()["data"]["errors"]] == ["other_site"]
    assert denied.status_code == 403
