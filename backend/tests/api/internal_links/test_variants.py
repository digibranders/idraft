"""A page that names another crawled page as its canonical is a variant: left out of the
counts and the lists unless asked for (plan 09)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import SeedLink, seed_crawl, set_counts
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/demo", 200), ("/demo-tracked", 200), ("/blog", 200)]
LINKS = [
    SeedLink("/", "/demo", "content", "Demo"),
    SeedLink("/", "/blog", "content", "Blog"),
]


async def _site(resources: Resources, migrated: PostgresServer) -> tuple[str, dict[str, str], str]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(migrated, workspace, project, PAGES, LINKS)
    await set_counts(migrated, run)
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET canonical_url_id = $2, variant_of_url_id = $2, "
        "is_indexable = false, non_indexable_reason = 'canonical', is_editorial_orphan = true "
        "WHERE run_id = $1 AND url_id = $3",
        run,
        ids["/demo"],
        ids["/demo-tracked"],
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET pages_crawled = 10, pages_variant = 1 WHERE id = $1",
        run,
    )
    return (
        project_url(workspace, project, "internal-links"),
        viewer.headers,
        str(ids["/demo-tracked"]),
    )


async def test_the_pages_list_leaves_variants_out_unless_asked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, headers, _ = await _site(resources, migrated)

    default = await api.get(f"{base}/pages", params={"limit": "50"}, headers=headers)
    included = await api.get(
        f"{base}/pages", params={"filter[include_variants]": "true", "limit": "50"}, headers=headers
    )
    only = await api.get(f"{base}/pages", params={"filter[flags]": "variant"}, headers=headers)

    assert {row["path"] for row in default.json()["data"]} == {"/", "/demo", "/blog"}
    assert default.json()["meta"]["total"] == 3
    assert included.json()["meta"]["total"] == 4
    assert {row["path"]: row["flags"] for row in included.json()["data"]}["/demo-tracked"].count(
        "variant"
    ) == 1
    assert [row["path"] for row in only.json()["data"]] == ["/demo-tracked"]


async def test_a_worklist_does_not_count_a_variant(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, headers, _ = await _site(resources, migrated)

    counts = await api.get(f"{base}/worklists", headers=headers)

    assert counts.json()["data"]["editorial_orphans"] == 0


async def test_a_crawl_says_how_many_variants_it_has_and_how_many_pages_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, headers, _ = await _site(resources, migrated)

    crawls = await api.get(base.replace("internal-links", "link-crawls"), headers=headers)

    row = crawls.json()["data"][0]
    # The provider counted more pages than the crawl stored: `pages` is what is stored.
    assert (row["pages_crawled"], row["pages_variant"], row["pages"]) == (10, 1, 3)
