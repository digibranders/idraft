"""Reads of a large crawl: a bounded number of statements however many rows the page holds, and
the CSV cap (decision D20). The crawls are written with `generate_series`, as ingest's own
statements would leave them."""

from __future__ import annotations

import csv
import io
import time
import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.ai.sources_support import statements
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import seed_crawl, seed_tiers, set_counts, url_id
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

# The statements of one request: the transaction's scope, the caller's membership, the crawl,
# the tiers, and the reads of the page (the inspector, the largest, asks 18). A request that
# asked one question for each row would pass this at 21 rows, and these pages hold 200.
STATEMENTS_MAX = 20
# The API's statement timeout is 15 s; a list on a crawl with no statistics must answer far
# inside it, with room for a busy machine.
# Alone the requests take under a second; four test workers on a busy machine tripped a 3 s
# bound, and a machine under a load average of 70 took 6.9 s. This bound sits under the API's
# statement timeout and still catches the plans that took minutes without statistics.
SLOW_SECONDS = 12.0

_URLS = """
INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version)
SELECT sha256(convert_to('example.com' || p, 'UTF8')), 'https://example.com' || p, d.id, p, 1
FROM (SELECT '/big-' || $1::text || '/' || g AS p FROM generate_series(1, $2::int) g) s
CROSS JOIN (SELECT id FROM core.domains WHERE host = 'example.com') d
"""
_PAGES = """
INSERT INTO seo.crawl_pages (run_id, url_id, workspace_id, project_id, crawled_url, status_code,
    resource_type, links_state, click_depth, equity_share, is_indexable)
SELECT $1, u.id, $2, $3, u.canonical_url, s.status,
       CASE WHEN s.status >= 400 THEN 'broken' WHEN s.status >= 300 THEN 'redirect'
            ELSE 'html' END,
       'from_html', (u.id % 9)::int, random(), u.id % 31 <> 0
FROM core.urls u
CROSS JOIN LATERAL (SELECT CASE WHEN u.id % 50 = 0 THEN 404 WHEN u.id % 40 = 0 THEN 301
                                ELSE 200 END AS status) s
WHERE u.path LIKE $4
"""
# Placements and scopes as `scope_of` pairs them.
_LINKS = """
WITH ids AS (SELECT array_agg(url_id ORDER BY url_id) AS a, count(*)::int AS n
             FROM seo.crawl_pages WHERE run_id = $1)
INSERT INTO seo.crawl_links (run_id, workspace_id, source_url_id, target_url_id, anchor, kind,
    placement, scope, is_followed)
SELECT $1, $2, a[1 + (i % n)], a[1 + ((i * 7919 + 1 + i / n) % n)], 'anchor ' || (i % 100),
       'text', (ARRAY['content', 'navigation', 'auto_generated'])[1 + i % 3],
       (ARRAY['editorial', 'template', 'auto_generated'])[1 + i % 3], true
FROM ids, generate_series(1, $3::int) i
"""


async def bulk_site(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    pages: int,
    links: int,
    *,
    analyze: bool = True,
) -> tuple[uuid.UUID, int]:
    """A finished crawl of `pages` pages and `links` links, a twentieth of the pages on T1.
    Returns the run and the id of one page that has links both ways. `analyze=False` leaves the
    tables as a fresh partition is, with no statistics."""
    tiers = await seed_tiers(pg, workspace)
    run, _ = await seed_crawl(pg, workspace, project, [], [])
    await url_id(pg, "https://example.com/")
    tag = uuid.uuid4().hex[:10]
    await execute(pg, _URLS, tag, pages)
    await execute(pg, _PAGES, run, workspace.id, project, f"/big-{tag}/%")
    await execute(pg, _LINKS, run, workspace.id, links)
    await execute(
        pg,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "SELECT $1, url_id, $2, $3, 'manual' FROM seo.crawl_pages "
        "WHERE run_id = $4 AND url_id % 20 = 0",
        project,
        workspace.id,
        tiers[0],
        run,
    )
    await set_counts(pg, run)
    # The size cases run as autovacuum would have left the tables, with statistics. The Links list
    # does not depend on them: see the case that skips this.
    if analyze:
        await execute(pg, "ANALYZE seo.crawl_pages, seo.crawl_links, core.urls, core.project_pages")
    hub = await fetchrow(
        pg,
        "SELECT url_id FROM seo.crawl_pages WHERE run_id = $1 "
        "ORDER BY linking_pages_all + outlinks_all DESC, url_id LIMIT 1",
        run,
    )
    return run, hub["url_id"]


async def test_a_large_crawl_reads_with_a_bounded_number_of_statements(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    _, hub = await bulk_site(migrated, workspace, project, pages=20_000, links=200_000)

    def at(*parts: object) -> str:
        return project_url(workspace, project, "internal-links", *parts)

    requests: list[tuple[str, dict[str, str | int]]] = [
        (at("pages"), {"limit": 1}),
        (at("pages"), {"limit": 200}),
        (at("pages"), {"limit": 200, "scope": "all", "sort": "-linking_pages"}),
        (at("pages"), {"limit": 200, "filter[tier]": "none", "filter[status]": "2xx"}),
        (at("pages", hub), {"scope": "all"}),
        (at("edges"), {"limit": 1, "scope": "all"}),
        (at("edges"), {"limit": 200, "scope": "all"}),
        (at("edges"), {"limit": 200, "scope": "all", "filter[worklist]": "broken_and_redirected"}),
        (at("neighbors"), {"url_id": hub, "direction": "in", "scope": "all", "limit": 1}),
        (at("neighbors"), {"url_id": hub, "direction": "out", "scope": "all", "limit": 50}),
        (at("tier-flow"), {"scope": "all"}),
        (at("worklists"), {}),
    ]
    # The first request of a session also loads the session; count from the second.
    await api.get(at("worklists"), headers=viewer.headers)
    counts: list[int] = []
    for url, params in requests:
        with statements(resources) as seen:
            response = await api.get(url, params=params, headers=viewer.headers)
        assert response.status_code == 200, (url, params, response.text)
        assert len(seen) <= STATEMENTS_MAX, (url, params, len(seen))
        counts.append(len(seen))

    # The same statements for one row and for 200: nothing is asked per row.
    assert counts[0] == counts[1]
    assert counts[5] == counts[6]
    assert counts[8] == counts[9]
    page = await api.get(at("pages"), params={"limit": 200}, headers=viewer.headers)
    assert len(page.json()["data"]) == 200
    assert page.json()["meta"]["total"] == 20_000
    edges = await api.get(
        at("edges"), params={"limit": 200, "scope": "all"}, headers=viewer.headers
    )
    assert edges.json()["meta"]["total"] == 200_000


async def test_the_links_list_does_not_need_statistics_on_a_fresh_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A crawl just written has no statistics until autovacuum comes. The list joined the tiers
    twice and took 4.6 s then (0.1 s analysed); it reads them for the rows it returns instead."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await bulk_site(migrated, workspace, project, pages=20_000, links=200_000, analyze=False)
    url = project_url(workspace, project, "internal-links", "edges")
    # The first request of a session also loads the session; time the ones after it.
    await api.get(
        project_url(workspace, project, "internal-links", "worklists"), headers=viewer.headers
    )
    tier = str(
        (
            await fetchrow(
                migrated,
                "SELECT tier_id FROM core.project_pages WHERE project_id = $1 LIMIT 1",
                project,
            )
        )["tier_id"]
    )

    cases: list[tuple[dict[str, str | int], str | None, str | None]] = [
        ({"limit": 200, "scope": "all"}, None, None),
        ({"limit": 200, "scope": "all", "filter[source_tier]": tier}, "source", "T1"),
        ({"limit": 200, "scope": "all", "filter[target_tier]": "none"}, "target", None),
    ]
    for params, side, wanted in cases:
        # A slow plan is slow every time; a busy machine is slow now and then. The best of three
        # tells them apart.
        times: list[float] = []
        for _ in range(3):
            with statements(resources) as seen:
                started = time.perf_counter()
                response = await api.get(url, params=params, headers=viewer.headers)
                times.append(time.perf_counter() - started)
            assert response.status_code == 200, (params, response.text)
            if times[-1] < SLOW_SECONDS:
                break
        rows = response.json()["data"]
        assert len(rows) == 200, params
        assert len(seen) <= STATEMENTS_MAX, (params, len(seen))
        assert min(times) < SLOW_SECONDS, (params, times)
        if side is not None:
            codes = {(row[side]["tier"] or {}).get("code") for row in rows}
            assert codes == {wanted}, (params, codes)


async def test_the_csv_holds_100_000_rows_and_no_more(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    await bulk_site(migrated, workspace, project, pages=100_050, links=100_050)

    pages = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"format": "csv", "sort": "path"},
        headers=viewer.headers,
    )
    edges = await api.get(
        project_url(workspace, project, "internal-links", "edges"),
        params={"format": "csv", "scope": "all"},
        headers=viewer.headers,
    )

    for response in (pages, edges):
        assert response.status_code == 200, (response.url, response.text[:300])
        assert response.headers["content-type"].startswith("text/csv")
        assert len(list(csv.reader(io.StringIO(response.text)))) == 100_001
    # The JSON list says how many there are, which is more than the file holds.
    total = await api.get(
        project_url(workspace, project, "internal-links", "pages"),
        params={"limit": 1},
        headers=viewer.headers,
    )
    assert total.json()["meta"]["total"] == 100_050
