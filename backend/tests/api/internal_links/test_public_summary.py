"""The client summary behind a shared link (plan 06 Task 5, decision D15)."""

from __future__ import annotations

import json
import time
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.resources import Resources
from idraft.collectors.crawl_enrich import CrawlEnrichTask, enrich_run
from idraft.collectors.crawl_store import recompute_tier_flow
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support_changes import two_crawls
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]
PUBLIC = "/api/v1/public/internal-links/summary"
FORBIDDEN_KEYS = {
    "run_id",
    "url_id",
    "tier_id",
    "workspace_id",
    "project_id",
    "email",
    "created_by",
    "id",
    "url",
}


async def _shared(
    migrated: PostgresServer, resources: Resources, worker_db: Sessions, api: httpx.AsyncClient
) -> tuple[Workspace, uuid.UUID, str, str]:
    """A project with two enriched crawls, and a link to it. (workspace, project, token, base)"""
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    _, newer, _, _ = await two_crawls(migrated, workspace, project)
    await enrich_run(
        worker_db,
        None,
        CrawlEnrichTask(workspace_id=workspace.id, run_id=newer),
        deadline=time.monotonic() + 120,
    )
    async with workspace_transaction(resources.sessions, workspace.id) as db:
        await recompute_tier_flow(db, workspace_id=workspace.id, run_id=newer)
    editor = await member(resources, migrated, workspace, "editor")
    base = project_url(workspace, project, "internal-links", "shares")
    made = await api.post(base, json={}, headers=editor.headers)
    return workspace, project, made.json()["data"]["token"], base


def _keys(node: object) -> set[str]:
    if isinstance(node, dict):
        return set(node) | {key for value in node.values() for key in _keys(value)}
    if isinstance(node, list):
        return {key for item in node for key in _keys(item)}
    return set()


async def test_anyone_with_the_link_reads_the_summary_and_nothing_else(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, project, token, _ = await _shared(migrated, resources, worker_db, api)

    response = await api.get(f"{PUBLIC}/{token}")  # no cookie, no header

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "noindex" in response.headers["x-robots-tag"]
    data = response.json()["data"]
    assert data["pages"] == sum(tier["pages"] for tier in data["tiers"]) > 0
    assert data["lost"]["state"] == "available"
    assert [(link["from_path"], link["to_path"]) for link in data["lost"]["links"]] == [
        ("/blog", "/pricing"),
        ("/blog/a", "/pricing"),
    ]
    assert data["lost"]["total"] == 2
    assert len(data["worklists"]) == 7
    assert {"T1", "T3"} <= {tier["code"] for tier in data["tiers"]}
    # Nothing internal: no ids or emails by name, and none of this tenant's ids by value.
    assert not _keys(data) & FORBIDDEN_KEYS
    text = json.dumps(data)
    assert str(workspace.id) not in text
    assert str(project) not in text


async def test_an_unknown_expired_revoked_or_malformed_link_all_answer_the_same(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Sessions
) -> None:
    workspace, _, _, base = await _shared(migrated, resources, worker_db, api)
    owner = await member(resources, migrated, workspace, "owner")
    expired = (await api.post(base, json={}, headers=owner.headers)).json()["data"]
    revoked = (await api.post(base, json={}, headers=owner.headers)).json()["data"]
    await execute(
        migrated,
        "UPDATE core.client_summary_shares SET created_at = now() - interval '40 days', "
        "expires_at = now() - interval '10 days' WHERE id = $1::uuid",
        expired["id"],
    )
    await api.delete(f"{base}/{revoked['id']}", headers=owner.headers)

    answers = [
        await api.get(f"{PUBLIC}/{token}")
        for token in (
            expired["token"],
            revoked["token"],
            "A" * 43,
            "short",
            "..%2F..%2Fetc%2Fpasswd",
            "A" * 150,
        )
    ]

    assert {problem(answer) for answer in answers} == {(404, "not_found")}


async def test_a_project_without_a_finished_crawl_has_no_summary_to_show(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    owner = await member(resources, migrated, workspace, "owner")
    base = project_url(workspace, project, "internal-links", "shares")
    token = (await api.post(base, json={}, headers=owner.headers)).json()["data"]["token"]

    assert problem(await api.get(f"{PUBLIC}/{token}")) == (404, "not_found")


async def test_the_address_is_limited_to_30_requests_a_minute(
    api: httpx.AsyncClient, migrated: PostgresServer
) -> None:
    # Other tests may have used some of this address's minute: 30 requests are the most it holds.
    answers = [await api.get(f"{PUBLIC}/{'B' * 43}") for _ in range(31)]

    codes = [answer.status_code for answer in answers]
    assert codes[-1] == 429
    assert set(codes[: codes.index(429)]) <= {404}
    refused = answers[-1]
    assert problem(refused) == (429, "rate_limited")
    assert refused.headers["retry-after"] == "60"
