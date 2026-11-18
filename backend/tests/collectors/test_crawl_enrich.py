"""The `crawl_enrich` job: what a crawl changed against the one before, the alert, and the
anchor counts (plan 04 Task 6, decisions D1 to D5)."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import crawl_enrich
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.internal_links.support import seed_crawl
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]


async def _enrich(sessions: Sessions, workspace_id: uuid.UUID, run_id: uuid.UUID) -> None:
    outcome = await enrich_run(
        sessions,
        None,
        CrawlEnrichTask(workspace_id=workspace_id, run_id=run_id),
        deadline=time.monotonic() + 120,
    )
    assert not outcome.failed
    assert not outcome.busy


async def _pairs(
    pg: PostgresServer, run: uuid.UUID, change: str, scope: str
) -> dict[tuple[str, str], str | None]:
    rows = await fetch(
        pg,
        "SELECT su.path AS source, tu.path AS target, c.still_linked_by FROM "
        "seo.crawl_link_changes c JOIN core.urls su ON su.id = c.source_url_id "
        "JOIN core.urls tu ON tu.id = c.target_url_id "
        "WHERE c.run_id = $1 AND c.change = $2 AND c.scope = $3",
        run,
        change,
        scope,
    )
    return {(row["source"], row["target"]): row["still_linked_by"] for row in rows}


async def test_lost_and_added_pairs_are_stored_per_scope_with_what_still_links_them(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    older, newer, _, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    assert await _pairs(migrated, newer, "lost", "editorial") == {
        ("/blog", "/pricing"): None,
        ("/blog/a", "/pricing"): "navigation",
    }
    assert await _pairs(migrated, newer, "lost", "all") == {("/blog", "/pricing"): None}
    assert set(await _pairs(migrated, newer, "added", "editorial")) == {
        ("/blog", "/blog/b"),
        ("/blog/a", "/blog/b"),
    }
    row = (
        await fetch(
            migrated,
            "SELECT previous_run_id, enrich_state, enrich_phase FROM seo.crawl_runs WHERE id = $1",
            newer,
        )
    )[0]
    assert (row["previous_run_id"], row["enrich_state"], row["enrich_phase"]) == (
        older,
        "done",
        "done",
    )


async def test_pages_that_moved_have_a_row_and_the_others_have_none(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, ids, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    rows = {
        row["url_id"]: row
        for row in await fetch(
            migrated,
            "SELECT url_id, is_new, editorial_in_delta FROM seo.crawl_page_changes "
            "WHERE run_id = $1",
            newer,
        )
    }
    assert set(rows) == {ids["/pricing"], ids["/blog/b"]}
    assert rows[ids["/pricing"]]["editorial_in_delta"] == -2
    assert rows[ids["/blog/b"]]["editorial_in_delta"] == 2
    assert not rows[ids["/pricing"]]["is_new"]


async def test_links_lost_to_t1_raise_one_alert_shown_in_the_app(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    rows = await fetch(
        migrated,
        "SELECT lost_links, max_position, threshold, channel, delivery_state "
        "FROM seo.crawl_alerts WHERE run_id = $1",
        newer,
    )
    assert [tuple(row.values()) for row in rows] == [(2, 2, 1, "app", "shown_in_app")]


async def test_a_disabled_alert_or_one_below_its_threshold_is_not_recorded(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE core.projects SET settings = jsonb_build_object('internal_links', "
        "jsonb_build_object('alerts', jsonb_build_object('threshold', 3))) WHERE id = $1",
        project,
    )

    await _enrich(worker_db, workspace.id, newer)

    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", newer)


async def test_a_chosen_email_channel_is_recorded_as_unavailable(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await execute(
        migrated,
        "UPDATE core.projects SET settings = jsonb_build_object('internal_links', "
        "jsonb_build_object('alerts', jsonb_build_object('channel', 'email'))) WHERE id = $1",
        project,
    )

    await _enrich(worker_db, workspace.id, newer)

    state = await fetch(
        migrated, "SELECT delivery_state FROM seo.crawl_alerts WHERE run_id = $1", newer
    )
    assert state[0]["delivery_state"] == "channel_unavailable"


async def test_editorial_anchor_counts_and_generic_ones_are_stored_per_page(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, ids, _ = await two_crawls(migrated, workspace, project)

    await _enrich(worker_db, workspace.id, newer)

    row = (
        await fetch(
            migrated,
            "SELECT editorial_anchors, generic_anchors FROM seo.crawl_pages "
            "WHERE run_id = $1 AND url_id = $2",
            newer,
            ids["/blog/b"],
        )
    )[0]
    assert (row["editorial_anchors"], row["generic_anchors"]) == (2, 1)


async def test_the_first_crawl_has_no_changes_and_no_alert(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    first, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])

    await _enrich(worker_db, workspace.id, first)

    run = (
        await fetch(
            migrated,
            "SELECT previous_run_id, enrich_state FROM seo.crawl_runs WHERE id = $1",
            first,
        )
    )[0]
    assert run["previous_run_id"] is None
    assert run["enrich_state"] == "done"
    assert not await fetch(
        migrated, "SELECT 1 FROM seo.crawl_link_changes WHERE run_id = $1", first
    )
    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", first)


async def test_running_it_again_leaves_the_same_rows(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await _enrich(worker_db, workspace.id, newer)
    before = await _pairs(migrated, newer, "lost", "editorial")

    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET enrich_state = 'pending', enrich_phase = NULL WHERE id = $1",
        newer,
    )
    await _enrich(worker_db, workspace.id, newer)

    assert await _pairs(migrated, newer, "lost", "editorial") == before
    alerts = await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", newer)
    assert len(alerts) == 1


async def test_a_task_names_its_own_workspace_and_touches_nothing_else(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)

    outcome = await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=other.id, run_id=newer),
        deadline=time.monotonic() + 60,
    )

    assert outcome.phase is None
    assert outcome.steps == 0
    state = await fetch(migrated, "SELECT enrich_state FROM seo.crawl_runs WHERE id = $1", newer)
    assert state[0]["enrich_state"] == "pending"


async def test_a_crawl_whose_predecessor_lost_its_links_still_gets_page_changes(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    older, newer, ids, _ = await two_crawls(migrated, workspace, project)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", older)
    await execute(
        migrated, "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1", older
    )

    await _enrich(worker_db, workspace.id, newer)

    assert not await fetch(
        migrated, "SELECT 1 FROM seo.crawl_link_changes WHERE run_id = $1", newer
    )
    pages = await fetch(
        migrated, "SELECT url_id FROM seo.crawl_page_changes WHERE run_id = $1", newer
    )
    assert {row["url_id"] for row in pages} == {ids["/pricing"], ids["/blog/b"]}


async def test_an_overtaken_pass_writes_nothing_and_does_not_reopen_a_finished_crawl(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await _enrich(worker_db, workspace.id, newer)
    # A second pass that read the crawl at its first phase, before the first pass finished.
    stale = crawl_enrich._Run(
        id=newer,
        workspace_id=workspace.id,
        project_id=project,
        created_at=datetime.now(UTC),
        phase="changes",
        offset=0,
        links_kept=True,
    )

    applied = await crawl_enrich._changes(worker_db, None, stale)

    assert not applied
    state = await fetch(
        migrated, "SELECT enrich_state, enrich_phase FROM seo.crawl_runs WHERE id = $1", newer
    )
    assert (state[0]["enrich_state"], state[0]["enrich_phase"]) == ("done", "done")


async def test_only_the_latest_crawl_raises_an_alert(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await seed_crawl(migrated, workspace, project, [("/", 200)])

    await _enrich(worker_db, workspace.id, newer)

    assert not await fetch(migrated, "SELECT 1 FROM seo.crawl_alerts WHERE run_id = $1", newer)
    assert await fetch(migrated, "SELECT 1 FROM seo.crawl_link_changes WHERE run_id = $1", newer)
