"""The Pages list sorts by rank, citations and anchor on the server, with stable ties and paging
(plan 06 Task 6, decision D16, point P6)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers, set_counts
from tests.api.internal_links.support_changes import (
    gsc_property,
    insert_citation,
    track_keyword,
)
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/a", 200), ("/b", 200), ("/c", 200), ("/d", 200), ("/e", 200)]
LINKS = [
    SeedLink("/", "/a", "content", "Zebra"),
    SeedLink("/b", "/a", "content", "zebra"),  # same text in another case counts for the same one
    SeedLink("/", "/b", "content", "Alpha"),
    SeedLink("/", "/c", "navigation", "Menu only"),  # not editorial: no anchor for /c
]


async def _site(
    migrated: PostgresServer, resources: Resources
) -> tuple[Workspace, uuid.UUID, dict[str, int], dict[str, str]]:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    run, ids = await seed_crawl(migrated, workspace, project, PAGES, LINKS)
    await set_counts(migrated, run)
    await track_keyword(migrated, workspace, project, "kw a", ids["/a"], rank=7, change=0, volume=1)
    await track_keyword(
        migrated, workspace, project, "kw a2", ids["/a"], rank=3, change=0, volume=1
    )
    await track_keyword(migrated, workspace, project, "kw b", ids["/b"], rank=5, change=0, volume=1)
    await track_keyword(
        migrated, workspace, project, "kw c", ids["/c"], rank=None, change=None, volume=1
    )
    for engine, days in (("chatgpt_web", 1), ("gemini_web", 2)):
        await insert_citation(migrated, workspace, project, ids["/b"], engine, days)
    await insert_citation(migrated, workspace, project, ids["/a"], "chatgpt_web", 3)
    viewer = await member(resources, migrated, workspace, "viewer")
    return workspace, project, ids, viewer.headers


async def _walk(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    headers: dict[str, str],
    sort: str,
) -> list[str]:
    url = project_url(workspace, project, "internal-links", "pages")
    paths: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"sort": sort, "limit": 2, "scope": "all"}
        if cursor is not None:
            params["cursor"] = cursor
        response = await api.get(url, params=params, headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        paths += [row["path"] for row in body["data"]]
        cursor = body["page"]["next_cursor"]
        if cursor is None:
            return paths


async def test_rank_sorts_by_the_best_rank_with_unranked_pages_last_both_ways(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, headers = await _site(migrated, resources)

    up = await _walk(api, workspace, project, headers, "rank")
    down = await _walk(api, workspace, project, headers, "-rank")

    # /a ranks 3 (its best of 3 and 7), /b 5; the rest have none, in page id order either way.
    assert up[:2] == ["/a", "/b"]
    assert down[:2] == ["/b", "/a"]
    assert set(up[2:]) == set(down[2:]) == {"/", "/c", "/d", "/e"}
    assert up[2:] == sorted(up[2:], key=PAGES_ORDER.index)
    assert down[2:] == sorted(down[2:], key=PAGES_ORDER.index, reverse=True)


PAGES_ORDER = [path for path, _ in PAGES]


async def test_citations_sort_by_the_answers_of_28_days_and_ties_break_by_page(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, headers = await _site(migrated, resources)

    down = await _walk(api, workspace, project, headers, "-citations")
    up = await _walk(api, workspace, project, headers, "citations")

    assert down[:2] == ["/b", "/a"]  # two answers, then one
    assert up[-2:] == ["/a", "/b"]
    assert len(set(down)) == len(down) == len(PAGES)


async def test_anchor_sorts_by_the_top_editorial_text_in_lower_case_unanchored_last(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, _, headers = await _site(migrated, resources)

    up = await _walk(api, workspace, project, headers, "anchor")
    down = await _walk(api, workspace, project, headers, "-anchor")

    # /b is "alpha" and /a is "zebra" (two links, one in another case); /c has only a menu link.
    assert up[:2] == ["/b", "/a"]
    assert down[:2] == ["/a", "/b"]
    assert set(up[2:]) == set(down[2:]) == {"/", "/c", "/d", "/e"}


@pytest.mark.parametrize("sort", ["rank", "-rank", "citations", "-citations", "anchor", "-anchor"])
async def test_a_cursor_of_one_sort_is_refused_by_another(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str
) -> None:
    workspace, project, _, headers = await _site(migrated, resources)
    url = project_url(workspace, project, "internal-links", "pages")
    first = await api.get(url, params={"sort": sort, "limit": 1}, headers=headers)
    cursor = first.json()["page"]["next_cursor"]

    other = "path" if sort.lstrip("-") != "path" else "rank"
    refused = await api.get(
        url, params={"sort": other, "limit": 1, "cursor": cursor}, headers=headers
    )

    assert refused.status_code == 400


async def test_tier_sorts_by_position_with_untiered_pages_last_both_ways(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, headers = await _site(migrated, resources)
    tiers = await seed_tiers(migrated, workspace)
    for path, tier in (("/b", tiers[0]), ("/a", tiers[2])):
        await execute(
            migrated,
            "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, "
            "tier_source) VALUES ($1, $2, $3, $4, 'manual')",
            project,
            ids[path],
            workspace.id,
            tier,
        )

    up = await _walk(api, workspace, project, headers, "tier")
    down = await _walk(api, workspace, project, headers, "-tier")

    assert up[:2] == ["/b", "/a"]  # T1, then T3
    assert down[:2] == ["/a", "/b"]
    assert set(up[2:]) == set(down[2:]) == {"/", "/c", "/d", "/e"}


async def test_clicks_sort_by_google_clicks_and_are_all_equal_without_a_property(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, headers = await _site(migrated, resources)

    plain = await _walk(api, workspace, project, headers, "-clicks")
    integration = await gsc_property(migrated, workspace, project)
    for path, clicks in (("/c", 9), ("/e", 4)):
        await execute(
            migrated,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
            "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, 90)",
            integration,
            date.today() - timedelta(days=3),
            ids[path],
            workspace.id,
            project,
            clicks,
        )
    down = await _walk(api, workspace, project, headers, "-clicks")
    up = await _walk(api, workspace, project, headers, "clicks")

    assert plain == sorted(PAGES_ORDER, reverse=True)  # all 0: the page id breaks every tie
    assert down[:2] == ["/c", "/e"]
    assert up[-2:] == ["/e", "/c"]
    assert len(set(down)) == len(PAGES)


async def test_impressions_sort_by_google_impressions_and_are_all_equal_without_a_property(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, headers = await _site(migrated, resources)

    plain = await _walk(api, workspace, project, headers, "-impressions")
    integration = await gsc_property(migrated, workspace, project)
    # The clicks run the other way, so the order can only come from the impressions.
    for path, impressions, clicks in (("/c", 900, 1), ("/e", 400, 5)):
        await execute(
            migrated,
            "INSERT INTO fp.gsc_page_daily (integration_id, metric_date, url_id, workspace_id, "
            "project_id, clicks, impressions) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            integration,
            date.today() - timedelta(days=3),
            ids[path],
            workspace.id,
            project,
            clicks,
            impressions,
        )
    down = await _walk(api, workspace, project, headers, "-impressions")
    up = await _walk(api, workspace, project, headers, "impressions")

    assert plain == sorted(PAGES_ORDER, reverse=True)  # all 0: the page id breaks every tie
    assert down[:2] == ["/c", "/e"]
    assert up[-2:] == ["/e", "/c"]
    assert len(set(down)) == len(PAGES)


async def test_title_sorts_in_lower_case_with_untitled_pages_last_both_ways(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, headers = await _site(migrated, resources)
    for path, title in (("/d", "beta page"), ("/e", "Alpha page")):
        await execute(
            migrated,
            "UPDATE seo.crawl_pages SET title = $1 WHERE url_id = $2 AND project_id = $3",
            title,
            ids[path],
            project,
        )

    up = await _walk(api, workspace, project, headers, "title")
    down = await _walk(api, workspace, project, headers, "-title")

    assert up[:2] == ["/e", "/d"]
    assert down[:2] == ["/d", "/e"]
    assert set(up[2:]) == set(down[2:]) == {"/", "/a", "/b", "/c"}


async def test_indexable_and_sitemap_sort_with_the_page_as_the_last_tie_break(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, ids, headers = await _site(migrated, resources)
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET in_sitemap = true WHERE url_id = $1 AND project_id = $2",
        ids["/b"],
        project,
    )

    in_sitemap = await _walk(api, workspace, project, headers, "-in_sitemap")
    indexable = await _walk(api, workspace, project, headers, "indexable")

    assert in_sitemap[0] == "/b"
    assert len(set(in_sitemap)) == len(set(indexable)) == len(PAGES)
