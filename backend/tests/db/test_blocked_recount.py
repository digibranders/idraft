"""The recount of plan 08 (migration 0031): old crawls stop counting refusals as broken."""

from __future__ import annotations

from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.blocked_recount import BROKEN_OUTLINKS, RUN_COUNT
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.internal_links.support import SeedLink, seed_crawl
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


def test_the_statements_name_the_statuses_the_code_treats_as_blocked() -> None:
    listed = {int(code) for code in ["401", "403", "429"]}
    assert listed == set(BLOCKED_STATUSES)
    assert "(401, 403, 429)" in RUN_COUNT
    assert "(401, 403, 429)" in BROKEN_OUTLINKS


async def test_a_recount_fixes_the_counters_of_a_crawl_that_has_refusals_and_only_that(
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    pages = [("/", 200), ("/gone", 404), ("/walled", 403), ("/limited", 429)]
    links = [
        SeedLink("/", "/gone", "content", "Gone"),
        SeedLink("/", "/walled", "content", "Walled"),
        SeedLink("/", "/limited", "content", "Limited"),
    ]
    run, ids = await seed_crawl(migrated, workspace, project, pages, links)
    clean, clean_ids = await seed_crawl(
        migrated, workspace, project, [("/", 200), ("/gone", 404)], links[:1]
    )
    # What the old ingest wrote: every status of 400 or more as broken.
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET broken_outlinks = 3 WHERE run_id = $1 AND url_id = $2",
        run,
        ids["/"],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET broken_outlinks = 1 WHERE run_id = $1 AND url_id = $2",
        clean,
        clean_ids["/"],
    )

    await execute(migrated, RUN_COUNT)
    await execute(migrated, BROKEN_OUTLINKS)

    runs = {
        row["id"]: row["pages_blocked"]
        for row in await fetch(migrated, "SELECT id, pages_blocked FROM seo.crawl_runs")
    }
    assert runs[run] == 2
    assert runs[clean] is None
    broken = {
        (row["run_id"], row["url_id"]): row["broken_outlinks"]
        for row in await fetch(
            migrated, "SELECT run_id, url_id, broken_outlinks FROM seo.crawl_pages"
        )
    }
    assert broken[(run, ids["/"])] == 1
    assert broken[(clean, clean_ids["/"])] == 1
