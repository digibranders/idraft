"""The strip counts of the keyword list (`include=counts`): one read for six counts."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import keyword_project, project_url, tracked_id
from tests.conftest import PostgresServer

# The latest check of each keyword: the top 3, the top 10, the top 20, deeper, and beyond the
# depth (checked, not found). A sixth keyword is never checked and has no rank state at all.
RANKS: list[int | None] = [2, 8, 15, 40, None]


async def _seeded(
    api: httpx.AsyncClient, resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = await keyword_project(pg, workspace)
    for number, rank in enumerate(RANKS):
        tracked = await tracked_id(api, workspace, project, owner, f"kw {number}")
        await execute(
            pg,
            "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, "
            "project_id, last_observed_at, current_rank, current_depth_requested) "
            "SELECT id, workspace_id, project_id, now(), $2, 100 "
            "FROM seo.tracked_keywords WHERE id = $1",
            uuid.UUID(tracked),
            rank,
        )
    await tracked_id(api, workspace, project, owner, "never checked")
    return workspace, project, owner


async def _page(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    **query: str,
) -> dict[str, object]:
    response = await api.get(
        project_url(workspace, project, "tracked-keywords"),
        params={"limit": "1", **query},
        headers=caller.headers,
    )
    assert response.status_code == 200, response.text
    page: dict[str, object] = response.json()["page"]
    return page


async def test_the_counts_split_the_filtered_keywords_by_rank(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _seeded(api, resources, migrated)
    page = await _page(api, workspace, project, owner, include="counts")
    # The keyword never checked is in the total and in no other count: "beyond" means checked
    # and not found, as the filter `rank_is_null=true` does.
    assert page["counts"] == {
        "total": 6,
        "ranked": 4,
        "beyond": 1,
        "top3": 1,
        "top10": 2,
        "top20": 3,
    }
    assert page["total"] == 6


async def test_the_counts_follow_the_filters_and_a_count_they_rule_out_is_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _seeded(api, resources, migrated)
    page = await _page(
        api, workspace, project, owner, include="counts", **{"filter[rank_gte]": "10"}
    )
    assert page["counts"] == {
        "total": 2,
        "ranked": 2,
        "beyond": 0,
        "top3": 0,
        "top10": 0,
        "top20": 1,
    }


async def test_the_counts_are_left_out_unless_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _seeded(api, resources, migrated)
    page = await _page(api, workspace, project, owner)
    assert page.get("counts") is None
