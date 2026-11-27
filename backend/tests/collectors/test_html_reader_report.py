"""The read-only list of crawls read by an older HTML reader (plan 12)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.crawl.integrity import HTML_READER_VERSION
from idraft.worker.html_reader_report import reader_report
from tests.api.auth.support import execute, make_workspace
from tests.api.internal_links.support import seed_crawl
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]
PAGES = [("/", 200), ("/a", 200), ("/b", 200)]


async def _crawl(
    pg: PostgresServer, *, version: int | None, state: str, suspect: int | None = None
) -> str:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    run, _ = await seed_crawl(pg, workspace, project, PAGES)
    await execute(pg, "UPDATE seo.crawl_pages SET links_state = $2 WHERE run_id = $1", run, state)
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET html_reader_version = $2, pages_links_suspect = $3 "
        "WHERE id = $1",
        run,
        version,
        suspect,
    )
    return str(run)


async def test_the_report_lists_the_latest_crawls_and_marks_those_read_by_an_older_reader(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    old = await _crawl(migrated, version=None, state="from_html", suspect=263)
    older = await _crawl(migrated, version=1, state="from_html")
    current = await _crawl(migrated, version=HTML_READER_VERSION, state="from_html", suspect=0)
    provider = await _crawl(migrated, version=None, state="from_provider")

    rows = {str(row.run_id): row for row in await reader_report(worker_db)}

    assert (rows[old].version, rows[old].stale, rows[old].pages_links_suspect) == (1, True, 263)
    assert rows[older].stale is True
    assert (rows[current].stale, rows[current].pages_links_suspect) == (False, 0)
    # Nothing was read from HTML: nothing to read again.
    assert rows[provider].stale is False
    assert rows[old].pages_by_state == {"from_html": 3}


async def test_an_older_crawl_of_a_project_is_not_listed_when_a_newer_one_is_finished(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    first, _ = await seed_crawl(migrated, workspace, project, PAGES)
    second, _ = await seed_crawl(migrated, workspace, project, PAGES)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET created_at = now() - interval '1 day' WHERE id = $1",
        first,
    )

    ids = {row.run_id for row in await reader_report(worker_db)}

    assert second in ids
    assert first not in ids
