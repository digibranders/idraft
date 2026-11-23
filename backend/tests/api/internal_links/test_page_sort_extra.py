"""The Pages list sorts by rank, citations and anchor on the server, with stable ties and paging
(plan 06 Task 6, decision D16, point P6)."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import SeedLink, seed_crawl, set_counts
from tests.api.internal_links.support_changes import insert_citation, track_keyword
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
