"""Older crawls (plan 04 Task 9, decision D15): the crawl list says what each crawl still
holds, links of a dropped crawl are gone with a plain error, and an older crawl's tier flow
follows today's tiers."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

_DROPPED = "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1"
_PREVIOUS = "UPDATE seo.crawl_runs SET previous_run_id = $2 WHERE id = $1"


async def test_the_crawl_list_says_which_crawls_still_hold_their_links(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, newer, _, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(migrated, _DROPPED, older)
    await execute(migrated, _PREVIOUS, newer, older)

    response = await api.get(project_url(workspace, project, "link-crawls"), headers=viewer.headers)

    runs = {run["run_id"]: run for run in response.json()["data"]}
    assert runs[str(older)]["links_available"] is False
    assert runs[str(newer)]["links_available"] is True
    assert runs[str(newer)]["previous_run_id"] == str(older)
    assert runs[str(newer)]["enrich_state"] == "pending"


async def test_links_of_a_dropped_crawl_are_gone_but_its_pages_are_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, _, ids, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(migrated, _DROPPED, older)
    base = project_url(workspace, project, "internal-links")

    pages = await api.get(f"{base}/pages", params={"run": str(older)}, headers=viewer.headers)
    edges = await api.get(f"{base}/edges", params={"run": str(older)}, headers=viewer.headers)
    neighbors = await api.get(
        f"{base}/neighbors",
        params={"run": str(older), "url_id": ids["/"], "direction": "out"},
        headers=viewer.headers,
    )

    assert pages.status_code == 200
    assert pages.json()["meta"]["links_available"] is False
    assert problem(edges) == (410, "links_dropped")
    assert problem(neighbors) == (410, "links_dropped")

    detail = await api.get(
        f"{base}/pages/{ids['/']}", params={"run": str(older)}, headers=viewer.headers
    )
    assert detail.status_code == 200
    assert detail.json()["data"]["links_available"] is False
    # Its tier flow cannot be recomputed: the stored rows come back marked stale.
    flow = await api.get(f"{base}/tier-flow", params={"run": str(older)}, headers=viewer.headers)
    assert flow.status_code == 200
    assert flow.json()["data"]["stale"] is True


async def test_an_older_crawls_tier_flow_follows_the_tiers_of_today(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    older, newer, _, _ = await two_crawls(migrated, workspace, project)
    base = project_url(workspace, project, "internal-links")

    url = f"{base}/tier-flow"
    old = await api.get(
        url, params={"run": str(older), "scope": "editorial"}, headers=viewer.headers
    )
    latest = await api.get(
        url, params={"run": str(newer), "scope": "editorial"}, headers=viewer.headers
    )

    cells = {
        (
            None if cell["from_tier"] is None else cell["from_tier"]["code"],
            None if cell["to_tier"] is None else cell["to_tier"]["code"],
        ): cell["links"]
        for cell in old.json()["data"]["cells"]
    }
    # Two editorial pairs (/blog and /blog/a to /pricing, a T1 page) from untiered pages.
    assert cells == {(None, "T1"): 2}
    assert old.json()["data"]["stale"] is False
    # The latest crawl keeps its stored flow, which nothing has computed in this test.
    assert latest.json()["data"]["cells"] == []
