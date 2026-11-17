"""The Tier flow tab and the worklist counts (spec 7.2 and 7.6)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from idraft.collectors.crawl_store import recompute_tier_flow
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_matrix_has_untiered_as_its_own_row_and_every_tier_in_the_strip(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, _, _ = await read_site(migrated, workspace, project)
    async with workspace_transaction(resources.sessions, workspace.id) as db:
        await recompute_tier_flow(db, workspace_id=workspace.id, run_id=run)

    response = await api.get(
        project_url(workspace, project, "internal-links", "tier-flow"), headers=viewer.headers
    )

    data = response.json()["data"]
    cells = {
        (
            None if cell["from_tier"] is None else cell["from_tier"]["code"],
            None if cell["to_tier"] is None else cell["to_tier"]["code"],
        ): cell["links"]
        for cell in data["cells"]
    }
    assert cells == {("T3", "T1"): 1, ("T1", "T3"): 1, (None, "T3"): 1, (None, None): 3}
    strip = {
        None if row["tier"] is None else row["tier"]["code"]: row["pages"] for row in data["tiers"]
    }
    assert strip == {"T1": 1, "T2": 0, "T3": 1, "T4": 0, None: 5}
    assert data["stale"] is False


async def test_worklist_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await read_site(migrated, workspace, project)

    response = await api.get(
        project_url(workspace, project, "internal-links", "worklists"), headers=viewer.headers
    )

    data = response.json()["data"]
    assert (data["broken_and_redirected"], data["links_to_non_indexable"]) == (2, 0)
    # /pricing (T1) has one editorial linking page: under 3.
    assert data["under_linked_t1"] == 1
