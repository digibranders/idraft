"""What changed between crawls and the alert settings (plan 04 Task 10)."""

from __future__ import annotations

import time
import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _ready(
    pg: PostgresServer, sessions: Sessions
) -> tuple[Workspace, uuid.UUID, uuid.UUID, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    older, newer, ids, tiers = await two_crawls(pg, workspace, project)
    await enrich_run(
        sessions,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=newer),
        deadline=time.monotonic() + 120,
    )
    return workspace, project, older, newer, ids, tiers


async def test_the_summary_counts_both_scopes_and_the_links_lost_to_important_pages(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, older, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "summary"),
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert data["state"] == "ready"
    assert data["previous_run_id"] == str(older)
    assert (data["editorial_lost"], data["editorial_added"]) == (2, 2)
    assert (data["all_lost"], data["all_added"]) == (1, 2)
    assert (data["lost_to_top"], data["important_max_position"]) == (2, 2)
    assert (data["pages_added"], data["pages_lost"]) == (0, 0)
    assert data["alert"] == {
        "lost_links": 2,
        "max_position": 2,
        "threshold": 1,
        "channel": "app",
        "delivery_state": "shown_in_app",
    }


async def test_the_summary_follows_the_alert_settings_and_a_tier_change_moves_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, ids, tiers = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    url = project_url(workspace, project, "internal-links", "changes", "summary")
    await execute(
        migrated,
        "UPDATE core.projects SET settings = jsonb_build_object('internal_links', "
        "jsonb_build_object('alerts', jsonb_build_object('threshold', 3))) WHERE id = $1",
        project,
    )
    below = await api.get(url, headers=viewer.headers)
    # /pricing moves to T4: it no longer counts as important.
    await execute(
        migrated,
        "UPDATE core.project_pages SET tier_id = $3 WHERE project_id = $1 AND url_id = $2",
        project,
        ids["/pricing"],
        tiers[3],
    )
    moved = await api.get(url, headers=viewer.headers)

    assert below.json()["data"]["alert"] is None
    assert below.json()["data"]["lost_to_top"] == 2
    assert moved.json()["data"]["lost_to_top"] == 0


async def test_a_first_crawl_and_a_crawl_still_being_enriched_say_so(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "internal-links", "changes", "summary")

    pending = await api.get(url, headers=viewer.headers)
    await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=run),
        deadline=time.monotonic() + 60,
    )
    first = await api.get(url, headers=viewer.headers)

    assert pending.json()["data"]["state"] == "pending"
    assert first.json()["data"]["state"] == "first_crawl"
    assert first.json()["data"]["alert"] is None


async def test_a_crawl_whose_enrichment_failed_before_its_changes_says_unavailable(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    await execute(migrated, "UPDATE seo.crawl_runs SET enrich_state = 'failed' WHERE id = $1", run)

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "summary"),
        headers=viewer.headers,
    )

    assert response.json()["data"]["state"] == "unavailable"


async def test_lost_links_list_t1_first_with_priority_and_what_still_links_the_pair(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    base = project_url(workspace, project, "internal-links", "changes", "links")

    lost = await api.get(base, params={"change": "lost"}, headers=viewer.headers)
    top = await api.get(base, params={"change": "lost", "only": "top"}, headers=viewer.headers)
    added = await api.get(
        base, params={"change": "added", "link_scope": "all"}, headers=viewer.headers
    )

    rows = lost.json()["data"]
    assert [(row["source"]["path"], row["target"]["path"]) for row in rows] == [
        ("/blog", "/pricing"),
        ("/blog/a", "/pricing"),
    ]
    assert {row["priority"] for row in rows} == {"lost_to_t1"}
    assert [row["still_linked_by"] for row in rows] == [None, "navigation"]
    assert rows[0]["target"]["tier"]["code"] == "T1"
    assert lost.json()["meta"]["total"] == 2
    assert lost.json()["meta"]["truncated"] is False
    assert len(top.json()["data"]) == 2
    assert {row["priority"] for row in added.json()["data"]} == {"none"}


async def test_the_list_says_when_the_stored_changes_were_cut_at_the_cap(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Sessions,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    monkeypatch.setattr("idraft.api.internal_links.changes.CHANGES_MAX", 2)
    base = project_url(workspace, project, "internal-links", "changes", "links")

    lost = await api.get(base, params={"change": "lost"}, headers=viewer.headers)
    # The cut is a fact of the stored rows of that change and scope, whatever the filter shows.
    top_none = await api.get(
        base, params={"change": "lost", "only": "top", "limit": 1}, headers=viewer.headers
    )
    added = await api.get(base, params={"change": "added"}, headers=viewer.headers)

    assert lost.json()["meta"]["truncated"] is True
    assert top_none.json()["meta"]["truncated"] is True
    assert added.json()["meta"]["truncated"] is True


async def test_the_link_lists_of_a_crawl_without_its_links_are_gone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, newer, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")
    await execute(
        migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", newer
    )

    links = await api.get(
        project_url(workspace, project, "internal-links", "changes", "links"),
        params={"change": "lost"},
        headers=viewer.headers,
    )
    summary = await api.get(
        project_url(workspace, project, "internal-links", "changes", "summary"),
        headers=viewer.headers,
    )

    assert problem(links) == (410, "links_dropped")
    assert summary.status_code == 200


async def test_the_lost_links_come_as_csv(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "links"),
        params={"change": "lost", "format": "csv"},
        headers=viewer.headers,
    )

    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.splitlines()
    assert lines[0] == "Change,Source,Target,Anchor,Link type,Target tier,Still linked from"
    assert len(lines) == 3


async def test_pages_that_moved_most_come_with_their_numbers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(
        project_url(workspace, project, "internal-links", "changes", "pages"),
        headers=viewer.headers,
    )

    rows = response.json()["data"]
    # Both moved by two; the tie is broken by path.
    assert [(row["page"]["path"], row["editorial_in_delta"]) for row in rows] == [
        ("/blog/b", 2),
        ("/pricing", -2),
    ]
    assert rows[1]["editorial_in"] == 0


async def test_a_member_of_another_workspace_gets_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, _, _, _, _ = await _ready(migrated, worker_db)
    outsider_workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, outsider_workspace, "viewer")

    for tail in ("summary", "links", "pages"):
        response = await api.get(
            project_url(workspace, project, "internal-links", "changes", tail),
            params={"change": "lost"} if tail == "links" else {},
            headers=outsider.headers,
        )
        assert problem(response)[0] in (403, 404), tail


async def test_alert_settings_merge_and_email_and_slack_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    url = project_url(workspace, project, "settings")

    first = await api.patch(
        url, json={"internal_links": {"alerts": {"threshold": 5}}}, headers=editor.headers
    )
    second = await api.patch(
        url, json={"internal_links": {"alerts": {"max_position": 1}}}, headers=editor.headers
    )
    refused = await api.patch(
        url, json={"internal_links": {"alerts": {"channel": "email"}}}, headers=editor.headers
    )
    slack = await api.patch(
        url, json={"internal_links": {"alerts": {"channel": "slack"}}}, headers=editor.headers
    )
    kept = await api.get(url, headers=editor.headers)

    assert first.status_code == 200, first.text
    assert second.json()["data"]["internal_links"]["alerts"] == {
        "enabled": True,
        "max_position": 1,
        "threshold": 5,
        "channel": "app",
    }
    assert problem(refused) == (422, "validation_failed")
    assert "channel_unavailable" in refused.text
    assert problem(slack) == (422, "validation_failed")
    assert kept.json()["data"]["internal_links"]["alerts"]["channel"] == "app"
