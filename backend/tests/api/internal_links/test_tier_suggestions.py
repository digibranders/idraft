"""Suggested tiers from Search Console clicks and tracked keyword ranks (plan 04 Task 13)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import httpx

from idraft.api.resources import Resources
from idraft.collectors.crawl_store import apply_rules
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import SeedLink, audit_rows, seed_crawl, seed_tiers
from tests.api.internal_links.support_changes import gsc_property, track_keyword
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

# /gone is not live and /hidden is not indexable: neither may be suggested.
PAGES = [
    ("/", 200),
    ("/a", 200),
    ("/b", 200),
    ("/c", 200),
    ("/d", 200),
    ("/gone", 404),
    ("/hidden", 200),
]


async def _site(
    pg: PostgresServer, resources: Resources
) -> tuple[Workspace, uuid.UUID, dict[str, int], list[uuid.UUID]]:
    """A crawl of live pages that a prefix rule makes T3 pages (by rule, so a suggestion may
    change them)."""
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    tiers = await seed_tiers(pg, workspace)
    run, ids = await seed_crawl(pg, workspace, project, PAGES, [SeedLink("/", "/a")])
    await execute(
        pg, "UPDATE seo.crawl_pages SET is_indexable = true, click_depth = 1 WHERE run_id = $1", run
    )
    await execute(
        pg,
        "UPDATE seo.crawl_pages SET is_indexable = false WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/hidden"],
    )
    await execute(
        pg,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/', $3)",
        workspace.id,
        project,
        tiers[2],
    )
    async with workspace_transaction(resources.sessions, workspace.id) as db:
        await apply_rules(db, workspace_id=workspace.id, project_id=project)
    return workspace, project, ids, tiers


async def _clicks(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    ids: dict[str, int],
    clicks: dict[str, int],
) -> None:
    """A connected property whose pull is done, and the clicks of the pages."""
    integration = await gsc_property(pg, workspace, project)
    day = date.today() - timedelta(days=3)
    for path, count in clicks.items():
        await execute(
            pg,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
            "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, $6 * 10)",
            integration,
            day,
            ids[path],
            workspace.id,
            project,
            count,
        )


def _suggestions(workspace: Workspace, project: uuid.UUID) -> str:
    return project_url(workspace, project, "internal-links", "tier-suggestions")


async def test_the_busiest_t3_page_is_suggested_for_t2_with_its_clicks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _clicks(migrated, workspace, project, ids, {"/a": 900, "/b": 5, "/c": 1})

    response = await api.get(_suggestions(workspace, project), headers=viewer.headers)

    body = response.json()
    assert body["meta"]["gsc_state"] == "ok"
    rows = body["data"]
    assert [row["path"] for row in rows] == ["/a"]
    assert (rows[0]["from_tier"]["code"], rows[0]["to_tier"]["code"]) == ("T3", "T2")
    assert rows[0]["reasons"] == [
        {"kind": "clicks", "clicks": 900, "rank": None, "keyword": None, "volume": None}
    ]


async def test_without_search_console_a_ranking_keyword_still_suggests_a_tier(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    viewer = await member(resources, migrated, workspace, "viewer")
    await track_keyword(
        migrated, workspace, project, "big topic", ids["/b"], rank=3, change=None, volume=5000
    )

    response = await api.get(_suggestions(workspace, project), headers=viewer.headers)

    assert response.json()["meta"]["gsc_state"] == "not_connected"
    rows = response.json()["data"]
    assert [row["path"] for row in rows] == ["/b"]
    reason = rows[0]["reasons"][0]
    assert (reason["kind"], reason["rank"], reason["keyword"], reason["volume"]) == (
        "rank",
        3,
        "big topic",
        5000,
    )


async def test_clicks_are_not_used_until_a_page_day_is_stored(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    viewer = await member(resources, migrated, workspace, "viewer")
    await gsc_property(migrated, workspace, project)
    await track_keyword(
        migrated, workspace, project, "big topic", ids["/b"], rank=2, change=None, volume=9000
    )

    response = await api.get(_suggestions(workspace, project), headers=viewer.headers)

    assert response.json()["meta"]["gsc_state"] == "pending"
    assert [row["path"] for row in response.json()["data"]] == ["/b"]
    assert response.json()["data"][0]["reasons"][0]["kind"] == "rank"


async def test_pages_that_are_not_live_and_indexable_are_never_suggested(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    viewer = await member(resources, migrated, workspace, "viewer")
    for path in ("/gone", "/hidden"):
        await track_keyword(
            migrated,
            workspace,
            project,
            f"topic {path}",
            ids[path],
            rank=1,
            change=None,
            volume=9000,
        )

    response = await api.get(_suggestions(workspace, project), headers=viewer.headers)

    assert response.json()["data"] == []


async def test_accept_sets_a_manual_tier_and_it_is_never_suggested_again(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    await _clicks(migrated, workspace, project, ids, {"/a": 900, "/b": 5})
    base = _suggestions(workspace, project)

    accepted = await api.post(f"{base}/accept", json={"all": True}, headers=editor.headers)
    again = await api.get(base, headers=editor.headers)

    assert accepted.json()["data"] == {"matched": 1, "changed": 1}
    assert again.json()["data"] == []
    row = await fetch(
        migrated,
        "SELECT tier_source, set_by FROM core.project_pages WHERE project_id = $1 AND url_id = $2",
        project,
        ids["/a"],
    )
    assert (row[0]["tier_source"], row[0]["set_by"]) == ("manual", editor.user_id)
    assert len(await audit_rows(migrated, workspace, "page_tiers.changed")) == 1


async def test_accept_by_ids_leaves_the_other_suggestions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    await _clicks(migrated, workspace, project, ids, {"/a": 900})
    await track_keyword(
        migrated, workspace, project, "big topic", ids["/b"], rank=2, change=None, volume=9000
    )
    base = _suggestions(workspace, project)

    accepted = await api.post(
        f"{base}/accept",
        json={"url_ids": [str(ids["/a"]), str(ids["/c"])]},
        headers=editor.headers,
    )
    left = await api.get(base, headers=editor.headers)

    # /c is not a suggestion, so only /a qualifies; /b stays listed.
    assert accepted.json()["data"] == {"matched": 1, "changed": 1}
    assert [row["path"] for row in left.json()["data"]] == ["/b"]


async def test_dismiss_hides_a_suggestion_for_the_project_and_is_audited(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    await _clicks(migrated, workspace, project, ids, {"/a": 900})
    base = _suggestions(workspace, project)

    dismissed = await api.post(
        f"{base}/dismiss", json={"url_ids": [str(ids["/a"])]}, headers=editor.headers
    )
    listed = await api.get(base, headers=editor.headers)
    twice = await api.post(f"{base}/dismiss", json={"all": True}, headers=editor.headers)

    assert dismissed.json()["data"] == {"matched": 1, "changed": 1}
    assert listed.json()["data"] == []
    assert twice.json()["data"] == {"matched": 0, "changed": 0}
    assert len(await audit_rows(migrated, workspace, "tier_suggestion.dismissed")) == 2


async def test_a_selection_needs_ids_or_all_and_a_viewer_cannot_accept_or_dismiss(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, _ = await _site(migrated, resources)
    editor = await member(resources, migrated, workspace, "editor")
    viewer = await member(resources, migrated, workspace, "viewer")
    base = _suggestions(workspace, project)

    empty = await api.post(f"{base}/accept", json={}, headers=editor.headers)
    both = await api.post(
        f"{base}/dismiss", json={"all": True, "url_ids": ["1"]}, headers=editor.headers
    )
    accept = await api.post(f"{base}/accept", json={"all": True}, headers=viewer.headers)
    dismiss = await api.post(f"{base}/dismiss", json={"all": True}, headers=viewer.headers)

    assert problem(empty) == (422, "validation_failed")
    assert problem(both) == (422, "validation_failed")
    assert (accept.status_code, dismiss.status_code) == (403, 403)
