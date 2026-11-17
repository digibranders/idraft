"""Crawl now, progress, cancel and the website-added crawl (spec 6.2 and 9; decisions D14, D15)."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from uuid import UUID

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links import crawls
from idraft.api.pagination import encode_cursor
from idraft.api.resources import Resources
from idraft.collectors.crawl_runs import queue_run
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.conftest import AppFactory
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import audit_rows, seed_crawl, set_website
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.support import Project, make_budget
from tests.conftest import PostgresServer


async def test_an_analyst_starts_a_crawl_and_a_second_one_waits(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    analyst = await member(resources, migrated, workspace, "analyst")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")

    started = await api.post(url, json={}, headers=analyst.headers)
    again = await api.post(url, json={}, headers=analyst.headers)
    listed = await api.get(url, headers=analyst.headers)

    assert started.status_code == 202, started.text
    run = started.json()["data"]
    assert (run["state"], run["trigger"], run["ceiling"], run["estimated_cost_usd"]) == (
        "queued",
        "manual",
        2000,
        "0.300000",
    )
    assert run["requested_by"]["user_id"] == str(analyst.user_id)
    assert problem(again) == (409, "crawl_in_progress")
    assert again.json()["run_id"] == run["run_id"]
    assert [row["run_id"] for row in listed.json()["data"]] == [run["run_id"]]
    assert len(await audit_rows(migrated, workspace, "link_crawl.requested")) == 1


async def test_two_crawls_started_at_once_make_one_run_and_one_clean_refusal(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")

    answers = await asyncio.gather(
        *(api.post(url, json={}, headers=owner.headers) for _ in range(4))
    )

    assert sorted(answer.status_code for answer in answers) == [202, 409, 409, 409]
    runs = await fetch(migrated, "SELECT id FROM seo.crawl_runs WHERE project_id = $1", project)
    assert len(runs) == 1
    assert {a.json()["run_id"] for a in answers if a.status_code == 409} == {str(runs[0]["id"])}


async def test_a_project_without_a_website_cannot_be_crawled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "link-crawls"), json={}, headers=owner.headers
    )

    assert problem(response) == (422, "no_website")


async def test_a_crawl_a_budget_would_stop_is_not_queued(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    budget_id = await make_budget(
        migrated, Project(workspace.id, project), "0.10", workload="site_crawl"
    )

    response = await api.post(
        project_url(workspace, project, "link-crawls"), json={}, headers=owner.headers
    )

    assert problem(response) == (422, "budget_exceeded")
    assert response.json()["budget_id"] == str(budget_id)
    assert (
        await fetch(migrated, "SELECT 1 FROM seo.crawl_runs WHERE project_id = $1", project) == []
    )


async def test_a_higher_limit_needs_a_crawl_that_stopped_at_its_ceiling(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")

    refused = await api.post(url, json={"higher_limit": True}, headers=owner.headers)
    stopped, _ = await seed_crawl(
        migrated, workspace, project, [("/", 200)], state="stopped_at_ceiling"
    )
    retried = await api.post(url, json={"higher_limit": True}, headers=owner.headers)

    assert problem(refused) == (422, "validation_failed")
    assert retried.json()["data"]["trigger"] == "ceiling_retry"
    assert retried.json()["data"]["ceiling"] == 4000
    assert stopped is not None


async def test_cancel_ends_a_queued_crawl_and_asks_the_worker_to_stop_a_running_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")
    queued = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]

    cancelled = await api.post(f"{url}/{queued}/cancel", headers=owner.headers)
    again = await api.post(f"{url}/{queued}/cancel", headers=owner.headers)
    running = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]
    await execute(migrated, "UPDATE seo.crawl_runs SET state = 'crawling' WHERE id = $1", running)
    asked = await api.post(f"{url}/{running}/cancel", headers=owner.headers)

    assert cancelled.json()["data"]["state"] == "cancelled"
    assert cancelled.json()["data"]["finished_at"] is not None
    assert problem(again) == (409, "invalid_state_transition")
    assert asked.json()["data"]["state"] == "crawling"
    row = await fetchrow(
        migrated, "SELECT cancel_requested FROM seo.crawl_runs WHERE id = $1", running
    )
    assert row["cancel_requested"] is True
    assert len(await audit_rows(migrated, workspace, "link_crawl.cancelled")) == 2


async def test_a_queued_crawl_the_worker_has_begun_to_post_is_ended_at_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The worker guards its update after the post with `state = 'queued'` and stops a run that was
    cancelled meanwhile, so a queued run ends whatever `submitted_at` says."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")
    run = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]
    await execute(migrated, "UPDATE seo.crawl_runs SET submitted_at = now() WHERE id = $1", run)

    cancelled = await api.post(f"{url}/{run}/cancel", headers=owner.headers)

    assert cancelled.json()["data"]["state"] == "cancelled"
    assert cancelled.json()["data"]["finished_at"] is not None
    row = await fetchrow(
        migrated, "SELECT state, cancel_requested FROM seo.crawl_runs WHERE id = $1", run
    )
    assert (row["state"], row["cancel_requested"]) == ("cancelled", False)


async def test_the_cancel_audit_tells_ending_from_asking_to_stop(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")
    running = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]
    await execute(migrated, "UPDATE seo.crawl_runs SET state = 'crawling' WHERE id = $1", running)

    await api.post(f"{url}/{running}/cancel", headers=owner.headers)

    (entry,) = await audit_rows(migrated, workspace, "link_crawl.cancelled")
    assert entry["before"] == {"state": "crawling", "cancel_requested": False}
    assert entry["after"] == {"state": "crawling", "cancel_requested": True}


async def test_a_crawl_that_ends_while_crawl_now_is_refused_never_makes_a_500(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cancel takes no project lock: the crawl that made the insert conflict can end before the
    busy path reads it. Crawl now then queues a new one (202); it is never a 500."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")
    first = (await api.post(url, json={}, headers=owner.headers)).json()["data"]["run_id"]
    real = queue_run

    async def queue_then_end_the_first(db: AsyncSession, **kwargs: Any) -> UUID:
        execute_real = db.execute
        ended = False

        async def execute_then_end(statement: Any, *args: Any, **options: Any) -> Any:
            nonlocal ended
            result = await execute_real(statement, *args, **options)
            if not ended and getattr(statement, "is_insert", False):
                ended = True
                await execute(
                    migrated, "UPDATE seo.crawl_runs SET state = 'cancelled' WHERE id = $1", first
                )
            return result

        monkeypatch.setattr(db, "execute", execute_then_end)
        return await real(db, **kwargs)

    monkeypatch.setattr(crawls, "queue_run", queue_then_end_the_first)

    again = await api.post(url, json={}, headers=owner.headers)

    assert again.status_code == 202, again.text
    assert again.json()["data"]["run_id"] != first
    row = await fetchrow(migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", first)
    assert row["state"] == "cancelled"


async def test_a_budget_that_only_alerts_does_not_stop_a_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    await make_budget(
        migrated, Project(workspace.id, project), "0.10", workload="site_crawl", action="alert_only"
    )

    response = await api.post(
        project_url(workspace, project, "link-crawls"), json={}, headers=owner.headers
    )

    assert response.status_code == 202, response.text


async def test_a_member_limited_to_some_projects_runs_crawls_inside_that_scope_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    inside = await keyword_project(migrated, workspace)
    outside = await keyword_project(migrated, workspace)
    await set_website(migrated, inside)
    await set_website(migrated, outside)
    outside_run, _ = await seed_crawl(migrated, workspace, outside, [("/", 200)], state="queued")
    limited = await member(resources, migrated, workspace, "editor", project_ids=[inside])
    url = project_url(workspace, inside, "link-crawls")

    started = await api.post(url, json={}, headers=limited.headers)
    listed = await api.get(url, headers=limited.headers)
    cancelled = await api.post(
        f"{url}/{started.json()['data']['run_id']}/cancel", headers=limited.headers
    )
    refused = [
        await api.post(
            project_url(workspace, outside, "link-crawls"), json={}, headers=limited.headers
        ),
        await api.get(project_url(workspace, outside, "link-crawls"), headers=limited.headers),
        await api.get(
            project_url(workspace, outside, "link-crawls", outside_run), headers=limited.headers
        ),
        await api.post(
            project_url(workspace, outside, "link-crawls", outside_run, "cancel"),
            headers=limited.headers,
        ),
    ]

    assert (started.status_code, listed.status_code, cancelled.status_code) == (202, 200, 200)
    assert [response.status_code for response in refused] == [404, 404, 404, 404]
    row = await fetchrow(migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", outside_run)
    assert row["state"] == "queued"


async def test_a_deleted_project_has_no_crawls_to_list_read_start_or_cancel(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)], state="queued")
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)
    url = project_url(workspace, project, "link-crawls")

    answers = [
        await api.get(url, headers=owner.headers),
        await api.get(f"{url}/{run}", headers=owner.headers),
        await api.post(url, json={}, headers=owner.headers),
        await api.post(f"{url}/{run}/cancel", headers=owner.headers),
    ]

    assert [answer.status_code for answer in answers] == [404, 404, 404, 404]
    row = await fetchrow(migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", run)
    assert row["state"] == "queued"


async def test_a_cursor_this_list_did_not_make_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    scope = {"list": "link-crawls", "project_id": str(project)}
    forged = [
        "not-a-cursor",
        encode_cursor(["not-a-time", str(uuid.uuid4())], scope=scope),
        encode_cursor(["2026-11-17T10:00:00+00:00", "not-a-uuid"], scope=scope),
        encode_cursor(["2026-11-17T10:00:00", str(uuid.uuid4())], scope=scope),
        encode_cursor(["2026-11-17T10:00:00+00:00"], scope=scope),
        encode_cursor(["2026-11-17T10:00:00+00:00", str(uuid.uuid4())], scope={"list": "other"}),
    ]

    answers = [
        await api.get(
            project_url(workspace, project, "link-crawls"),
            params={"cursor": cursor},
            headers=owner.headers,
        )
        for cursor in forged
    ]

    assert [problem(answer) for answer in answers] == [(400, "invalid_cursor")] * len(forged)


@pytest.mark.parametrize("state", ["processing", "ready", "failed"])
async def test_a_crawl_past_the_crawling_state_cannot_be_cancelled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, state: str
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)], state=state)

    response = await api.post(
        project_url(workspace, project, "link-crawls", run, "cancel"), headers=owner.headers
    )

    assert problem(response) == (409, "invalid_state_transition")
    row = await fetchrow(migrated, "SELECT state FROM seo.crawl_runs WHERE id = $1", run)
    assert row["state"] == state


async def test_a_crawl_of_another_project_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    other = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])

    read = await api.get(project_url(workspace, other, "link-crawls", run), headers=owner.headers)
    cancelled = await api.post(
        project_url(workspace, other, "link-crawls", run, "cancel"), headers=owner.headers
    )

    assert (read.status_code, cancelled.status_code) == (404, 404)


async def test_the_list_pages_newest_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    first, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    second, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "link-crawls")

    one = await api.get(url, params={"limit": 1}, headers=owner.headers)
    two = await api.get(
        url, params={"limit": 1, "cursor": one.json()["page"]["next_cursor"]}, headers=owner.headers
    )

    assert [row["run_id"] for row in one.json()["data"]] == [str(second)]
    assert one.json()["page"]["has_more"] is True
    assert [row["run_id"] for row in two.json()["data"]] == [str(first)]
    assert two.json()["page"]["next_cursor"] is None
    assert [row["is_latest"] for row in one.json()["data"] + two.json()["data"]] == [True, False]


@pytest.mark.parametrize("role", ["viewer"])
async def test_viewers_read_crawls_and_cannot_start_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    url = project_url(workspace, project, "link-crawls")

    read = await api.get(f"{url}/{run}", headers=caller.headers)
    started = await api.post(url, json={}, headers=caller.headers)
    cancelled = await api.post(f"{url}/{run}/cancel", headers=caller.headers)

    assert read.json()["data"]["is_latest"] is True
    assert (started.status_code, cancelled.status_code) == (403, 403)


async def test_another_workspace_cannot_read_or_start_these_crawls(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    run, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    stranger = await member(resources, migrated, await make_workspace(migrated), "owner")
    url = project_url(workspace, project, "link-crawls")

    read = await api.get(f"{url}/{run}", headers=stranger.headers)
    started = await api.post(url, json={}, headers=stranger.headers)

    assert (read.status_code, started.status_code) == (404, 404)


async def test_a_new_project_with_the_box_ticked_queues_its_first_crawl(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    body = {"name": "Site", "slug": "site-crawled", "primary_domain": "example.com"}

    ticked = await api.post(
        f"/api/v1/workspaces/{workspace.id}/projects",
        json={**body, "map_internal_links": True},
        headers=owner.headers,
    )
    plain = await api.post(
        f"/api/v1/workspaces/{workspace.id}/projects",
        json={**body, "slug": "site-plain"},
        headers=owner.headers,
    )

    assert ticked.status_code == 201, ticked.text
    runs = await fetch(
        migrated,
        "SELECT project_id, trigger FROM seo.crawl_runs WHERE workspace_id = $1",
        workspace.id,
    )
    assert [(str(row["project_id"]), row["trigger"]) for row in runs] == [
        (ticked.json()["data"]["project_id"], "website_added")
    ]
    assert plain.status_code == 201


async def test_the_box_ticked_without_a_website_queues_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    response = await api.post(
        f"/api/v1/workspaces/{workspace.id}/projects",
        json={"name": "Site", "slug": "no-site", "map_internal_links": True},
        headers=owner.headers,
    )

    assert response.status_code == 201, response.text
    assert (
        await fetch(migrated, "SELECT 1 FROM seo.crawl_runs WHERE workspace_id = $1", workspace.id)
        == []
    )


async def test_crawl_now_is_refused_while_site_crawls_are_off(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "link-crawls")
    async with client_for(crawls_enabled=False) as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        owner = await member(resources, migrated, workspace, "owner")
        viewer = await member(resources, migrated, workspace, "viewer")
        stranger = await member(resources, migrated, await make_workspace(migrated), "owner")

        refused = await api.post(url, json={}, headers=owner.headers)
        retried = await api.post(url, json={"higher_limit": True}, headers=owner.headers)
        listed = await api.get(url, headers=owner.headers)
        viewed = await api.post(url, json={}, headers=viewer.headers)
        strange = await api.post(url, json={}, headers=stranger.headers)

    assert problem(refused) == (503, "crawls_disabled")
    assert problem(retried) == (503, "crawls_disabled")
    assert (listed.status_code, listed.json()["data"]) == (200, [])
    assert (viewed.status_code, strange.status_code) == (403, 404)
    assert (
        await fetch(migrated, "SELECT 1 FROM seo.crawl_runs WHERE project_id = $1", project) == []
    )
    assert await audit_rows(migrated, workspace, "link_crawl.requested") == []


async def test_a_new_project_with_the_box_ticked_queues_no_crawl_while_site_crawls_are_off(
    client_for: AppFactory, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    async with client_for(crawls_enabled=False) as api:
        resources = api._transport.app.state.resources  # type: ignore[attr-defined]
        owner = await member(resources, migrated, workspace, "owner")

        response = await api.post(
            f"/api/v1/workspaces/{workspace.id}/projects",
            json={
                "name": "Site",
                "slug": "site-off",
                "primary_domain": "example.com",
                "map_internal_links": True,
            },
            headers=owner.headers,
        )

    assert response.status_code == 201, response.text
    assert (
        await fetch(migrated, "SELECT 1 FROM seo.crawl_runs WHERE workspace_id = $1", workspace.id)
        == []
    )
