"""Setting tiers on pages: bulk by ids or filter, manual Untiered, reset to rule (spec 5.2)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, audit_rows, seed_crawl, seed_tiers
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/pricing", 200), ("/blog/a", 200), ("/blog/b", 200), ("/gone", 404)]


async def _tiers(pg: PostgresServer, project: uuid.UUID) -> dict[int, tuple[uuid.UUID | None, str]]:
    rows = await fetch(
        pg,
        "SELECT url_id, tier_id, tier_source FROM core.project_pages WHERE project_id = $1",
        project,
    )
    return {row["url_id"]: (row["tier_id"], row["tier_source"]) for row in rows}


async def test_an_editor_sets_a_tier_on_selected_pages_and_the_flow_follows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated, workspace, project, PAGES, [SeedLink("/blog/a", "/pricing", "content")]
    )

    response = await api.put(
        project_url(workspace, project, "pages", "tiers"),
        json={"url_ids": [str(ids["/pricing"]), "999999999"], "tier_id": str(t1)},
        headers=editor.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"matched": 1, "changed": 1}
    assert (await _tiers(migrated, project))[ids["/pricing"]] == (t1, "manual")
    flow = await fetch(
        migrated,
        "SELECT to_tier_id, links FROM seo.crawl_tier_flow "
        "WHERE run_id = $1 AND scope = 'editorial'",
        run,
    )
    assert [(row["to_tier_id"], row["links"]) for row in flow] == [(t1, 1)]
    assert len(await audit_rows(migrated, workspace, "page_tiers.changed")) == 1


async def test_a_filter_selects_every_matching_page_and_null_is_manual_untiered(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)

    response = await api.put(
        project_url(workspace, project, "pages", "tiers"),
        json={"filter": {"q": "/blog/"}, "tier_id": None},
        headers=editor.headers,
    )

    assert response.json()["data"] == {"matched": 2, "changed": 2}
    tiers = await _tiers(migrated, project)
    assert tiers == {ids["/blog/a"]: (None, "manual"), ids["/blog/b"]: (None, "manual")}


async def test_reset_to_rule_removes_the_manual_tier(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'exact', '/pricing', $3)",
        workspace.id,
        project,
        t1,
    )
    url = project_url(workspace, project, "pages", "tiers")
    await api.put(
        url, json={"url_ids": [str(ids["/pricing"])], "tier_id": str(t2)}, headers=editor.headers
    )

    response = await api.post(
        f"{url}/reset", json={"url_ids": [str(ids["/pricing"])]}, headers=editor.headers
    )

    assert response.json()["data"] == {"matched": 1, "changed": 1}
    assert (await _tiers(migrated, project))[ids["/pricing"]] == (t1, "rule")


async def test_a_tier_of_another_workspace_is_refused_and_nothing_is_written(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    other_tier, *_ = await seed_tiers(migrated, await make_workspace(migrated, name="Other"))
    _, ids = await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "pages", "tiers")

    foreign = await api.put(
        url,
        json={"url_ids": [str(ids["/"])], "tier_id": str(other_tier)},
        headers=editor.headers,
    )
    unknown = await api.put(
        url,
        json={"url_ids": [str(ids["/"])], "tier_id": str(uuid.uuid4())},
        headers=editor.headers,
    )

    assert problem(foreign) == (422, "validation_failed")
    assert problem(unknown) == (422, "validation_failed")
    assert await _tiers(migrated, project) == {}


async def test_urls_outside_this_projects_crawl_are_never_written(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A URL another project, another workspace or no crawl found has no row to change: it is
    left out of `matched`, and the foreign key on `core.project_pages` is never reached."""
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    other_project = await keyword_project(migrated, workspace)
    other_workspace = await make_workspace(migrated, name="Other")
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, [("/", 200)])
    _, elsewhere = await seed_crawl(migrated, workspace, other_project, [("/only-there", 200)])
    foreign_project = await keyword_project(migrated, other_workspace)
    _, foreign = await seed_crawl(migrated, other_workspace, foreign_project, [("/theirs", 200)])
    url = project_url(workspace, project, "pages", "tiers")
    strangers = [str(elsewhere["/only-there"]), str(foreign["/theirs"]), "9223372036854775807"]

    set_tier = await api.put(
        url, json={"url_ids": strangers, "tier_id": str(t1)}, headers=editor.headers
    )
    reset = await api.post(f"{url}/reset", json={"url_ids": strangers}, headers=editor.headers)

    assert set_tier.json()["data"] == {"matched": 0, "changed": 0}
    assert reset.json()["data"] == {"matched": 0, "changed": 0}
    written = await fetch(
        migrated,
        "SELECT 1 FROM core.project_pages WHERE workspace_id = ANY($1::uuid[])",
        [workspace.id, other_workspace.id],
    )
    assert written == []


async def test_a_project_of_another_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    other = await make_workspace(migrated, name="Other")
    foreign_project = await keyword_project(migrated, other)
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, other, foreign_project, [("/", 200)])

    response = await api.put(
        project_url(workspace, foreign_project, "pages", "tiers"),
        json={"url_ids": ["1"], "tier_id": str(t1)},
        headers=editor.headers,
    )

    assert response.status_code == 404


async def test_a_body_names_ids_or_a_filter_and_no_more_than_the_limits(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    await seed_crawl(migrated, workspace, project, PAGES)
    url = project_url(workspace, project, "pages", "tiers")

    both = await api.put(
        url,
        json={"url_ids": ["1"], "filter": {"q": "/"}, "tier_id": str(t1)},
        headers=editor.headers,
    )
    neither = await api.put(url, json={"tier_id": str(t1)}, headers=editor.headers)
    too_many = await api.put(
        url,
        json={"url_ids": [str(n) for n in range(1, 5_002)], "tier_id": str(t1)},
        headers=editor.headers,
    )

    assert problem(both) == (422, "validation_failed")
    assert problem(neither) == (422, "validation_failed")
    assert problem(too_many) == (422, "validation_failed")


async def test_viewers_cannot_set_tiers_and_there_must_be_a_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    body = {"url_ids": ["1"], "tier_id": str(t1)}
    url = project_url(workspace, project, "pages", "tiers")

    assert (await api.put(url, json=body, headers=viewer.headers)).status_code == 403
    assert problem(await api.put(url, json=body, headers=editor.headers)) == (404, "no_crawl")
