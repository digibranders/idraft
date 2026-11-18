"""Link opportunities: a page mentions a topic of another page without an editorial link
(plan 04 Task 12, decisions D11 to D13)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def _mention(
    pg: PostgresServer, run: uuid.UUID, workspace: Workspace, source: int, target: int, phrase: str
) -> None:
    await execute(
        pg,
        "INSERT INTO seo.crawl_mentions (run_id, workspace_id, source_url_id, target_url_id, "
        "phrase, context, origin) VALUES ($1, $2, $3, $4, $5, $6, 'keyword')",
        run,
        workspace.id,
        source,
        target,
        phrase,
        f"Many teams look for {phrase} first.",
    )


async def _site(
    pg: PostgresServer,
) -> tuple[Workspace, uuid.UUID, uuid.UUID, dict[str, int]]:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, newer, ids, _ = await two_crawls(pg, workspace, project)
    # Every page is reachable and live, as ingest leaves a healthy crawl.
    await execute(pg, "UPDATE seo.crawl_pages SET click_depth = 1 WHERE run_id = $1", newer)
    return workspace, project, newer, ids


async def test_an_open_mention_is_listed_with_both_pages_and_the_suggested_anchor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    body = response.json()
    row = body["data"][0]
    assert row["key"] == f"{ids['/blog']}>{ids['/pricing']}"
    assert (row["source"]["path"], row["target"]["path"]) == ("/blog", "/pricing")
    assert row["target"]["tier"]["code"] == "T1"
    assert (row["phrase"], row["anchor"], row["status"], row["origin"]) == (
        "pricing plans",
        "pricing plans",
        "open",
        "keyword",
    )
    assert "pricing plans" in row["context"]
    assert body["meta"]["counts"] == {"open": 1, "accepted": 0, "dismissed": 0}


async def test_a_pair_that_has_an_editorial_link_is_not_an_opportunity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    # /blog/a links to /blog/b in its text in the latest crawl.
    await _mention(migrated, run, workspace, ids["/blog/a"], ids["/blog/b"], "soc pricing")
    # A page that mentions itself is not one either.
    await _mention(migrated, run, workspace, ids["/blog"], ids["/blog"], "blog")

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    assert response.json()["data"] == []


async def test_a_source_that_cannot_be_reached_from_home_is_left_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET click_depth = NULL WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/blog"],
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    assert response.json()["data"] == []


async def test_a_page_that_is_not_live_and_indexable_is_neither_source_nor_target(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/blog/b"], "blog b topics")
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET status_code = 404 WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/pricing"],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET is_indexable = false WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/"],
    )

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"), headers=viewer.headers
    )

    assert response.json()["data"] == []


async def test_accept_dismiss_and_undo_are_kept_for_the_project_and_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/pricing"], "plans and pricing")
    base = project_url(workspace, project, "internal-links", "opportunities")
    pair = {"source_url_id": str(ids["/blog"]), "target_url_id": str(ids["/pricing"])}

    accepted = await api.put(
        f"{base}/decisions", json={"items": [pair], "status": "accepted"}, headers=editor.headers
    )
    again = await api.put(
        f"{base}/decisions", json={"items": [pair], "status": "accepted"}, headers=editor.headers
    )
    listed = await api.get(base, params={"status": "accepted"}, headers=editor.headers)
    undone = await api.put(
        f"{base}/decisions", json={"items": [pair], "status": "open"}, headers=editor.headers
    )
    counts = (await api.get(base, headers=editor.headers)).json()["meta"]["counts"]

    assert accepted.json()["data"] == {"matched": 1, "changed": 1}
    assert again.json()["data"] == {"matched": 1, "changed": 0}
    assert [row["status"] for row in listed.json()["data"]] == ["accepted"]
    assert undone.json()["data"] == {"matched": 1, "changed": 1}
    assert counts == {"open": 2, "accepted": 0, "dismissed": 0}
    row = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'link_opportunity.decided'",
        workspace.id,
    )
    assert row["n"] == 3


async def test_a_viewer_cannot_decide_and_a_pair_outside_the_crawl_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    base = project_url(workspace, project, "internal-links", "opportunities")
    body = {
        "items": [{"source_url_id": str(ids["/"]), "target_url_id": str(ids["/blog/b"])}],
        "status": "dismissed",
    }

    refused = await api.put(f"{base}/decisions", json=body, headers=viewer.headers)
    nothing = await api.put(f"{base}/decisions", json=body, headers=editor.headers)

    assert problem(refused)[0] == 403
    assert nothing.json()["data"] == {"matched": 0, "changed": 0}


async def test_a_pair_off_the_list_cannot_be_decided_but_a_stored_decision_can_be_undone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    # Listed; linked in the text already; and a mention whose target is gone.
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/blog/a"], ids["/blog/b"], "soc pricing")
    await _mention(migrated, run, workspace, ids["/"], ids["/blog/a"], "blog a topics")
    base = project_url(workspace, project, "internal-links", "opportunities")

    def pair(source: str, target: str) -> dict[str, str]:
        return {"source_url_id": str(ids[source]), "target_url_id": str(ids[target])}

    items = [pair("/blog", "/pricing"), pair("/blog/a", "/blog/b"), pair("/", "/blog/a")]
    await api.put(
        f"{base}/decisions",
        json={"items": [pair("/blog", "/pricing")], "status": "accepted"},
        headers=editor.headers,
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET status_code = 404 WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/blog/a"],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET status_code = 404 WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/pricing"],
    )

    dismissed = await api.put(
        f"{base}/decisions",
        json={"items": [*items[1:], items[0]], "status": "dismissed"},
        headers=editor.headers,
    )
    undone = await api.put(
        f"{base}/decisions", json={"items": items, "status": "open"}, headers=editor.headers
    )

    # Nothing qualifies any more (a dead target, a link in the text, a dead target again).
    assert dismissed.json()["data"] == {"matched": 0, "changed": 0}
    # The accepted pair has a decision row, so it can be reopened although it left the list.
    assert undone.json()["data"] == {"matched": 1, "changed": 1}


async def test_planned_fixes_export_accepted_rows_or_the_open_ones(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/pricing"], "plans and pricing")
    base = project_url(workspace, project, "internal-links", "opportunities")

    open_rows = await api.get(base, params={"export": "planned"}, headers=editor.headers)
    await api.put(
        f"{base}/decisions",
        json={
            "items": [{"source_url_id": str(ids["/"]), "target_url_id": str(ids["/pricing"])}],
            "status": "accepted",
        },
        headers=editor.headers,
    )
    accepted = await api.get(base, params={"export": "planned"}, headers=editor.headers)
    listed = await api.get(base, params={"format": "csv"}, headers=editor.headers)

    assert open_rows.headers["content-type"].startswith("text/csv")
    assert len(open_rows.text.splitlines()) == 3
    assert open_rows.text.splitlines()[0] == "Source URL,Target URL,Anchor,Context,Status"
    assert len(accepted.text.splitlines()) == 2
    assert accepted.text.endswith("accepted\n")
    assert len(listed.text.splitlines()) == 3


async def test_the_export_does_not_let_a_cell_run_as_a_formula(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "=SUM(1)")

    response = await api.get(
        project_url(workspace, project, "internal-links", "opportunities"),
        params={"export": "planned"},
        headers=editor.headers,
    )

    assert ",'=SUM(1)," in response.text


async def test_filters_by_status_target_tier_and_search(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, run, ids = await _site(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await _mention(migrated, run, workspace, ids["/blog"], ids["/pricing"], "pricing plans")
    await _mention(migrated, run, workspace, ids["/"], ids["/blog/b"], "blog b topics")
    base = project_url(workspace, project, "internal-links", "opportunities")

    t1 = await api.get(base, params={"filter[target_tier]": "1"}, headers=viewer.headers)
    t3 = await api.get(base, params={"filter[target_tier]": "3"}, headers=viewer.headers)
    none = await api.get(base, params={"filter[target_tier]": "none"}, headers=viewer.headers)
    search = await api.get(base, params={"q": "/blog/b"}, headers=viewer.headers)
    dismissed = await api.get(base, params={"status": "dismissed"}, headers=viewer.headers)
    unknown = await api.get(base, params={"tier": "1"}, headers=viewer.headers)

    assert [row["target"]["path"] for row in t1.json()["data"]] == ["/pricing"]
    assert [row["target"]["path"] for row in t3.json()["data"]] == ["/blog/b"]
    assert none.json()["data"] == []
    assert [row["target"]["path"] for row in search.json()["data"]] == ["/blog/b"]
    assert dismissed.json()["data"] == []
    assert problem(unknown)[0] == 422


async def test_another_workspaces_member_sees_nothing_of_the_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, _ = await _site(migrated)
    other = await make_workspace(migrated)
    outsider = await member(resources, migrated, other, "editor")
    base = project_url(workspace, project, "internal-links", "opportunities")

    listed = await api.get(base, headers=outsider.headers)
    decided = await api.put(
        f"{base}/decisions",
        json={"items": [{"source_url_id": "1", "target_url_id": "2"}], "status": "dismissed"},
        headers=outsider.headers,
    )

    assert problem(listed)[0] in (403, 404)
    assert problem(decided)[0] in (403, 404)
