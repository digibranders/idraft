"""GET .../internal-links/pages/{url_id}/ai (spec sections 4, 5, 8)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import seed_crawl
from tests.api.internal_links.support_page_ai import (
    CITED_PATH,
    EXPECTED,
    OWN_UNCRAWLED_URL,
    UNCITED_PATH,
    page_ai_site,
)
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.ai_support import add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer


async def _read(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    url_id: object,
    headers: dict[str, str],
    **params: object,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project_id, "internal-links", "pages", url_id, "ai"),
        headers=headers,
        params={k: str(v) for k, v in params.items() if v is not None},
    )


def _assert_invariants(data: dict[str, Any], target_url_id: int) -> None:
    assert data["answers_citing"] <= data["answers"]
    assert sum(d["answers_citing"] for d in data["trend"]) == data["answers_citing"]
    assert sum(d["answers"] for d in data["trend"]) == data["answers"]
    assert sum(p["answers_citing"] for p in data["platforms"]) == data["answers_citing"]
    assert len(data["trend"]) == data["days"]
    assert all(p["answers_citing"] > 0 for p in data["prompts"])
    for row in data["prompts"]:
        assert sum(p["answers"] for p in row["platforms"]) == row["answers"]
        assert sum(p["answers_citing"] for p in row["platforms"]) == row["answers_citing"]
    assert all(row["answers_shared"] <= data["answers_citing"] for row in data["alongside"])
    assert target_url_id not in {row["url_id"] for row in data["alongside"]}


async def test_cited_page_returns_every_field_and_invariant(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    site = await page_ai_site(migrated, workspace, project)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _read(
        api,
        workspace,
        project,
        site.url_ids[CITED_PATH],
        viewer.headers,
        compare="previous_period",
    )

    assert response.status_code == 200
    data = response.json()["data"]
    _assert_invariants(data, site.url_ids[CITED_PATH])

    assert data["state"] == EXPECTED["state"]
    assert data["days"] == EXPECTED["days"]
    assert data["window"]["timezone"] == "UTC"
    assert data["compare_window"] is not None
    assert (data["answers"], data["answers_citing"]) == (
        EXPECTED["answers"],
        EXPECTED["answers_citing"],
    )
    assert (data["previous_answers"], data["previous_answers_citing"]) == (
        EXPECTED["previous_answers"],
        EXPECTED["previous_answers_citing"],
    )
    assert [
        (
            p["engine_code"],
            p["label"],
            p["answers"],
            p["answers_citing"],
            p["previous_answers_citing"],
        )
        for p in data["platforms"]
    ] == EXPECTED["platforms"]

    assert data["prompts_total"] == EXPECTED["prompts_total"]
    assert len(data["prompts"]) == len(EXPECTED["prompts"])
    for got, want in zip(data["prompts"], EXPECTED["prompts"], strict=True):
        assert got["prompt_id"] == str(site.prompt_ids[want["key"]])
        assert got["text"] == want["text"]
        assert (got["answers"], got["answers_citing"]) == (want["answers"], want["answers_citing"])
        assert [
            (p["engine_code"], p["answers"], p["answers_citing"]) for p in got["platforms"]
        ] == want["platforms"]
        assert got["last_cited_at"]

    assert data["alongside_total"] == EXPECTED["alongside_total"]
    assert [
        (
            row["url"],
            row["domain_role"],
            row["in_crawl"],
            row["answers_shared"],
            row["registrable_domain"],
            row["title"],
        )
        for row in data["alongside"]
    ] == EXPECTED["alongside"]


async def test_uncited_page_is_ready_with_zeros(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    site = await page_ai_site(migrated, workspace, project)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await _read(api, workspace, project, site.url_ids[UNCITED_PATH], viewer.headers)

    assert response.status_code == 200
    data = response.json()["data"]
    _assert_invariants(data, site.url_ids[UNCITED_PATH])
    assert data["state"] == "ready"
    assert (data["answers"], data["answers_citing"]) == (8, 0)
    assert len(data["trend"]) == 28
    assert data["prompts"] == []
    assert data["prompts_total"] == 0
    assert data["alongside"] == []
    assert data["alongside_total"] == 0


async def test_excluded_cases_do_not_change_any_number(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    ws_with = await make_workspace(migrated)
    p_with = await keyword_project(migrated, ws_with)
    site_with = await page_ai_site(migrated, ws_with, p_with, include_excluded=True)
    caller_with = await member(resources, migrated, ws_with, "viewer")

    ws_clean = await make_workspace(migrated)
    p_clean = await keyword_project(migrated, ws_clean)
    site_clean = await page_ai_site(migrated, ws_clean, p_clean, include_excluded=False)
    caller_clean = await member(resources, migrated, ws_clean, "viewer")

    r_with = await _read(
        api,
        ws_with,
        p_with,
        site_with.url_ids[CITED_PATH],
        caller_with.headers,
        compare="previous_period",
    )
    r_clean = await _read(
        api,
        ws_clean,
        p_clean,
        site_clean.url_ids[CITED_PATH],
        caller_clean.headers,
        compare="previous_period",
    )
    assert r_with.status_code == 200
    assert r_clean.status_code == 200
    d_with = r_with.json()["data"]
    d_clean = r_clean.json()["data"]

    def _strip_ids(body: dict[str, Any]) -> dict[str, Any]:
        prompts = [
            {k: v for k, v in p.items() if k not in ("prompt_id", "last_cited_at")}
            for p in body["prompts"]
        ]
        alongside = [{k: v for k, v in a.items() if k != "url_id"} for a in body["alongside"]]
        return {**body, "prompts": prompts, "alongside": alongside}

    assert _strip_ids(d_with) == _strip_ids(d_clean)


async def test_compare_none_and_previous_period(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    site = await page_ai_site(migrated, workspace, project)
    viewer = await member(resources, migrated, workspace, "viewer")

    none_resp = await _read(
        api, workspace, project, site.url_ids[CITED_PATH], viewer.headers, compare="none"
    )
    prev_resp = await _read(
        api,
        workspace,
        project,
        site.url_ids[CITED_PATH],
        viewer.headers,
        compare="previous_period",
    )
    none_data = none_resp.json()["data"]
    prev_data = prev_resp.json()["data"]

    assert none_data["compare_window"] is None
    assert none_data["previous_answers"] is None
    assert none_data["previous_answers_citing"] is None
    assert all(p["previous_answers_citing"] is None for p in none_data["platforms"])

    assert prev_data["compare_window"] is not None
    assert prev_data["previous_answers"] == 2
    assert prev_data["previous_answers_citing"] == 2


async def test_date_range_parameters_and_validation(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    site = await page_ai_site(migrated, workspace, project)
    viewer = await member(resources, migrated, workspace, "viewer")
    today = datetime.now(UTC).date()
    uid = site.url_ids[CITED_PATH]

    # Narrow to the last 7 days: answers on days -2, -4, -6 are included (3 citing answers).
    narrow = await _read(
        api,
        workspace,
        project,
        uid,
        viewer.headers,
        **{"from": (today - timedelta(days=6)).isoformat(), "to": today.isoformat()},
    )
    assert narrow.status_code == 200
    narrow_data = narrow.json()["data"]
    assert narrow_data["days"] == 7
    assert narrow_data["answers_citing"] == 3

    # Only `from` or only `to` is accepted.
    only_from = await _read(
        api,
        workspace,
        project,
        uid,
        viewer.headers,
        **{"from": (today - timedelta(days=6)).isoformat()},
    )
    only_to = await _read(
        api,
        workspace,
        project,
        uid,
        viewer.headers,
        to=(today - timedelta(days=1)).isoformat(),
    )
    assert only_from.status_code == 200
    assert only_from.json()["data"]["days"] == 7
    assert only_to.status_code == 200
    assert only_to.json()["data"]["days"] == 28

    inverted = await _read(
        api,
        workspace,
        project,
        uid,
        viewer.headers,
        **{"from": today.isoformat(), "to": (today - timedelta(days=1)).isoformat()},
    )
    too_wide = await _read(
        api,
        workspace,
        project,
        uid,
        viewer.headers,
        **{"from": (today - timedelta(days=92)).isoformat(), "to": today.isoformat()},
    )
    assert inverted.status_code == 422
    assert problem(too_wide) == (422, "window_too_large")


async def test_no_prompts_and_no_answers_states(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/home", 200)])
    viewer = await member(resources, migrated, workspace, "viewer")

    empty = await _read(api, workspace, project, ids["/home"], viewer.headers)
    assert empty.status_code == 200
    empty_data = empty.json()["data"]
    assert empty_data["state"] == "no_prompts"
    assert len(empty_data["trend"]) == 28
    assert empty_data["answers"] == 0

    await add_prompt(migrated, Project(workspace.id, project), "Tracked prompt with no answer")
    waiting = await _read(api, workspace, project, ids["/home"], viewer.headers)
    assert waiting.status_code == 200
    waiting_data = waiting.json()["data"]
    assert waiting_data["state"] == "no_answers"
    assert len(waiting_data["trend"]) == 28


async def test_crawl_membership_run_switch_and_permissions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    viewer = await member(resources, migrated, workspace, "viewer")
    no_crawl = await _read(api, workspace, project, 1, viewer.headers)
    assert problem(no_crawl) == (404, "no_crawl")

    # Seed an older crawl that includes `/old-never-crawled`, then a newer crawl via `page_ai_site`.
    older_run, older_ids = await seed_crawl(
        migrated, workspace, project, [("/blog/a", 200), ("/old-never-crawled", 200)]
    )
    site = await page_ai_site(migrated, workspace, project)
    assert older_ids["/old-never-crawled"] == site.url_ids["/old-never-crawled"]

    outside = await _read(api, workspace, project, 999_999_999, viewer.headers)
    assert problem(outside) == (404, "not_found")

    on_older = await _read(
        api, workspace, project, site.url_ids[CITED_PATH], viewer.headers, run=older_run
    )
    assert on_older.status_code == 200
    rows_by_url = {row["url"]: row for row in on_older.json()["data"]["alongside"]}
    assert rows_by_url[OWN_UNCRAWLED_URL]["url_id"] == older_ids["/old-never-crawled"]
    by_url = {url: row["in_crawl"] for url, row in rows_by_url.items()}
    assert by_url == {
        OWN_UNCRAWLED_URL: True,
        "https://example.com/pricing": False,
        "https://cybernx.com/soc": False,
        "https://guide.example.org/soc": False,
    }

    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")
    foreign = await _read(api, workspace, project, site.url_ids[CITED_PATH], stranger.headers)
    assert foreign.status_code == 404

    no_perm = await member(resources, migrated, workspace, "billing")
    denied = await _read(api, workspace, project, site.url_ids[CITED_PATH], no_perm.headers)
    assert denied.status_code == 403
