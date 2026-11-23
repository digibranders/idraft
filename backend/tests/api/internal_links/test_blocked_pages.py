"""Pages that refused the crawler are blocked, not broken (plan 08 task 3)."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member
from tests.api.internal_links.support import SeedLink, seed_crawl, set_counts
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

PAGES = [("/", 200), ("/gone", 404), ("/walled", 403), ("/limited", 429), ("/boom", 500)]
LINKS = [
    SeedLink("/", "/gone", "content", "Gone"),
    SeedLink("/", "/walled", "content", "Walled"),
    SeedLink("/", "/limited", "content", "Limited"),
    SeedLink("/", "/boom", "content", "Boom"),
]


async def _site(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> tuple[str, dict[str, str]]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, PAGES, LINKS)
    await set_counts(migrated, run)
    await execute(migrated, "UPDATE seo.crawl_runs SET pages_blocked = 2 WHERE id = $1", run)
    return project_url(workspace, project, "internal-links"), viewer.headers


async def test_a_refusal_has_its_own_flag_and_status_class_and_is_not_a_4xx(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, headers = await _site(api, resources, migrated)

    everything = await api.get(f"{base}/pages", params={"limit": "50"}, headers=headers)
    blocked = await api.get(f"{base}/pages", params={"filter[status]": "blocked"}, headers=headers)
    client_errors = await api.get(
        f"{base}/pages", params={"filter[status]": "4xx"}, headers=headers
    )
    both = await api.get(f"{base}/pages", params={"filter[status]": "blocked,5xx"}, headers=headers)

    flags = {row["path"]: row["flags"] for row in everything.json()["data"]}
    assert "blocked" in flags["/walled"]
    assert "blocked" in flags["/limited"]
    assert "broken" not in flags["/walled"] + flags["/limited"]
    assert "broken" in flags["/gone"]
    assert "broken" in flags["/boom"]
    assert {row["path"] for row in blocked.json()["data"]} == {"/walled", "/limited"}
    assert {row["path"] for row in client_errors.json()["data"]} == {"/gone"}
    assert {row["path"] for row in both.json()["data"]} == {"/walled", "/limited", "/boom"}


async def test_the_broken_worklist_and_target_filter_leave_refusals_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, headers = await _site(api, resources, migrated)

    worklist = await api.get(
        f"{base}/edges",
        params={"scope": "all", "filter[worklist]": "broken_and_redirected"},
        headers=headers,
    )
    walled = await api.get(
        f"{base}/edges",
        params={"scope": "all", "filter[target_status]": "blocked"},
        headers=headers,
    )
    counts = await api.get(f"{base}/worklists", headers=headers)

    assert {row["target"]["path"] for row in worklist.json()["data"]} == {"/gone", "/boom"}
    assert {row["target"]["path"] for row in walled.json()["data"]} == {"/walled", "/limited"}
    assert counts.json()["data"]["broken_and_redirected"] == 2
    assert counts.json()["data"]["may_be_incomplete"] is True


async def test_a_crawl_says_how_many_pages_refused_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    base, headers = await _site(api, resources, migrated)

    crawls = await api.get(base.replace("internal-links", "link-crawls"), headers=headers)

    assert crawls.status_code == 200, crawls.text
    assert [row["pages_blocked"] for row in crawls.json()["data"]] == [2]
