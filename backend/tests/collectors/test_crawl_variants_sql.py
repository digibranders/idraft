"""Which pages are variants, on crawls seeded page by page (plan 09)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors import crawl_ingest
from idraft.collectors.crawl_variants_sql import apply_variants
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.internal_links.support import SeedLink, seed_crawl, url_id
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


async def _seed(
    pg: PostgresServer,
    paths: Sequence[str],
    canonicals: dict[str, str],
    links: Sequence[SeedLink] = (),
) -> tuple[uuid.UUID, uuid.UUID, dict[str, int]]:
    """A crawl of `paths` where `canonicals` says what each page names; a name that is not a
    crawled path is a URL the crawl did not reach."""
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    run, ids = await seed_crawl(pg, workspace, project, [(path, 200) for path in paths], links)
    for page, named in canonicals.items():
        target = ids.get(named) or await url_id(pg, f"https://example.com{named}")
        await execute(
            pg,
            "UPDATE seo.crawl_pages SET canonical_url_id = $3 WHERE run_id = $1 AND url_id = $2",
            run,
            ids[page],
            target,
        )
    return workspace.id, run, ids


async def _variants(pg: PostgresServer, sessions: Sessions, run: uuid.UUID) -> dict[str, str]:
    async with sessions() as db, db.begin():
        await apply_variants(db, run)
    rows = await fetch(
        pg,
        "SELECT u.path, t.path AS named FROM seo.crawl_pages p "
        "JOIN core.urls u ON u.id = p.url_id JOIN core.urls t ON t.id = p.variant_of_url_id "
        "WHERE p.run_id = $1",
        run,
    )
    return {row["path"]: row["named"] for row in rows}


async def test_a_page_folds_into_a_canonical_page_that_names_a_url_the_crawl_did_not_reach(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, run, _ = await _seed(
        migrated, ["/demo", "/demo-x"], {"/demo": "/elsewhere", "/demo-x": "/demo"}
    )

    assert await _variants(migrated, worker_db, run) == {"/demo-x": "/demo"}


async def test_a_cycle_of_canonicals_leaves_both_pages_counting(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, run, _ = await _seed(migrated, ["/a", "/b"], {"/a": "/b", "/b": "/a"})

    assert await _variants(migrated, worker_db, run) == {}


async def test_a_chain_of_canonicals_folds_only_the_page_that_names_the_end(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, run, _ = await _seed(migrated, ["/a", "/b", "/c"], {"/a": "/b", "/b": "/c"})

    assert await _variants(migrated, worker_db, run) == {"/b": "/c"}


async def test_the_answer_is_the_same_when_it_is_asked_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    links = [SeedLink("/", "/demo-x", "content", "Demo"), SeedLink("/demo-x", "/blog")]
    _, run, _ = await _seed(
        migrated, ["/", "/demo", "/demo-x", "/blog"], {"/demo-x": "/demo"}, links
    )

    first = await _variants(migrated, worker_db, run)
    second = await _variants(migrated, worker_db, run)

    assert first == second == {"/demo-x": "/demo"}
    rows = await fetch(
        migrated,
        "SELECT t.path AS target, l.ignored, f.path AS first FROM seo.crawl_links l "
        "JOIN core.urls t ON t.id = l.target_url_id "
        "LEFT JOIN core.urls f ON f.id = l.folded_from_url_id WHERE l.run_id = $1 ORDER BY l.id",
        run,
    )
    assert [(row["target"], row["ignored"], row["first"]) for row in rows] == [
        ("/demo", False, "/demo-x"),
        ("/blog", True, None),
    ]


async def test_a_start_page_that_is_a_variant_stands_for_its_canonical_page(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    _, run, ids = await _seed(
        migrated,
        ["/", "/index", "/a"],
        {"/index": "/"},
        [SeedLink("/", "/a"), SeedLink("/index", "/")],
    )
    await execute(migrated, "UPDATE seo.crawl_pages SET in_sitemap = true WHERE run_id = $1", run)
    async with worker_db() as db, db.begin():
        nodes, links, variant_of = await crawl_ingest._count_and_read(db, run, ids["/index"])

    values, _ = crawl_ingest._page_values(nodes, links, variant_of, ids["/index"], run)

    depth = {value["b_url"]: value["b_depth"] for value in values}
    assert depth == {ids["/"]: 0, ids["/a"]: 1}
    orphans = await fetch(
        migrated, "SELECT url_id FROM seo.crawl_pages WHERE run_id = $1 AND is_orphan", run
    )
    assert [row["url_id"] for row in orphans] == []


async def test_a_crawl_whose_links_were_dropped_is_not_recounted(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace_id, run, _ = await _seed(migrated, ["/", "/a"], {})
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET enrich_state = 'done', links_dropped_at = now() WHERE id = $1",
        run,
    )

    outcome = await crawl_ingest.recount_variants(worker_db, workspace_id=workspace_id, run_id=run)

    assert outcome is None
