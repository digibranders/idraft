"""Client report guest links: made and revoked by people, read by anyone who holds one."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.summary_support import CHATGPT, GEMINI, Summary, answer_in_another_project
from tests.api.auth.support import execute, fetchrow
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import OWN_NAME, RIVAL_NAME
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded
PUBLIC = "/api/v1/public/reports"
FORBIDDEN_KEYS = {
    "id",
    "workspace_id",
    "project_id",
    "entity_id",
    "prompt_id",
    "answer_id",
    "run_id",
    "created_by",
    "text",
    "cost",
    "cost_usd",
    "url",
}


def _keys(node: object) -> set[str]:
    if isinstance(node, dict):
        return set(node) | {key for value in node.values() for key in _keys(value)}
    if isinstance(node, list):
        return {key for item in node for key in _keys(item)}
    return set()


def _base(world: Summary) -> str:
    return project_url(world.workspace, world.project.id, "reports", "shares")


async def _link(api: httpx.AsyncClient, world: Summary) -> tuple[str, dict[str, Any]]:
    made = await api.post(_base(world), json={}, headers=world.owner.headers)
    assert made.status_code == 201, made.text
    data: dict[str, Any] = made.json()["data"]
    return str(data["token"]), data


async def test_a_link_is_made_once_with_its_token_and_only_the_hash_is_stored(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    token, data = await _link(api, seeded)

    assert len(token) >= 40
    assert (data["state"], data["revoked_at"]) == ("active", None)
    stored = await fetchrow(
        migrated,
        "SELECT token_hash, expires_at - created_at AS span FROM core.ai_report_shares "
        "WHERE id = $1::uuid",
        data["id"],
    )
    assert bytes(stored["token_hash"]) == hashlib.sha256(token.encode()).digest()
    assert stored["span"].days == 30
    listed = await api.get(_base(seeded), headers=seeded.owner.headers)
    assert "token" not in listed.text
    assert [row["id"] for row in listed.json()["data"]] == [data["id"]]


async def test_only_7_30_or_90_days_are_offered(api: httpx.AsyncClient, seeded: Summary) -> None:
    for days in (7, 90):
        made = await api.post(
            _base(seeded), json={"expires_in_days": days}, headers=seeded.owner.headers
        )
        assert made.status_code == 201
    for refused in ({"expires_in_days": 365}, {"expires_in_days": None}, {"expires_in_days": 0}):
        response = await api.post(_base(seeded), json=refused, headers=seeded.owner.headers)
        assert response.status_code == 422, refused


async def test_a_viewer_can_list_but_not_make_or_revoke(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    _, share = await _link(api, seeded)
    viewer = await member(resources, migrated, seeded.workspace, "viewer")

    assert (await api.get(_base(seeded), headers=viewer.headers)).status_code == 200
    assert (await api.post(_base(seeded), json={}, headers=viewer.headers)).status_code == 403
    gone = await api.delete(f"{_base(seeded)}/{share['id']}", headers=viewer.headers)
    assert gone.status_code == 403


async def test_a_link_of_one_project_cannot_be_revoked_through_another_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    from tests.api.auth.support import make_workspace
    from tests.api.keywords.support import keyword_project

    _, share = await _link(api, seeded)
    other = await make_workspace(migrated)
    other_project = await keyword_project(migrated, other)
    outsider = await member(resources, migrated, other, "owner")

    refused = await api.delete(
        f"{project_url(other, other_project, 'reports', 'shares')}/{share['id']}",
        headers=outsider.headers,
    )

    assert problem(refused) == (404, "not_found")
    still = await fetchrow(
        migrated, "SELECT revoked_at FROM core.ai_report_shares WHERE id = $1::uuid", share["id"]
    )
    assert still["revoked_at"] is None


async def test_revoking_twice_is_harmless_and_each_make_and_revoke_is_audited(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    token, share = await _link(api, seeded)
    url = f"{_base(seeded)}/{share['id']}"

    first = await api.delete(url, headers=seeded.owner.headers)
    second = await api.delete(url, headers=seeded.owner.headers)

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["data"]["revoked_at"] == second.json()["data"]["revoked_at"]
    counts = await fetchrow(
        migrated,
        "SELECT count(*) FILTER (WHERE action = 'ai_report_share.created') AS made, "
        "count(*) FILTER (WHERE action = 'ai_report_share.revoked') AS revoked "
        "FROM ops.audit_logs WHERE workspace_id = $1",
        seeded.workspace.id,
    )
    assert (counts["made"], counts["revoked"]) == (1, 1)
    assert (await api.get(f"{PUBLIC}/{token}")).status_code == 404


async def test_anyone_with_the_link_reads_the_report_and_nothing_else(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    token, _ = await _link(api, seeded)

    response = await api.get(f"{PUBLIC}/{token}")  # no cookie, no header

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "noindex" in response.headers["x-robots-tag"]
    data = response.json()["data"]
    assert [engine["engine_code"] for engine in data["engines"]] == [CHATGPT, GEMINI]
    assert [(brand["name"], brand["role"]) for brand in data["brands"]] == [
        (OWN_NAME, "own"),
        (RIVAL_NAME, "competitor"),
    ]
    chatgpt = data["engines"][0]
    assert chatgpt["mentioned"]["denominator"] > 0
    assert chatgpt["weeks"]
    assert data["cited_domains"]
    # Nothing internal: no ids, texts or costs by name, and none of this tenant's ids by value.
    assert not _keys(data) & FORBIDDEN_KEYS
    text = json.dumps(data)
    assert str(seeded.workspace.id) not in text
    assert str(seeded.project.id) not in text


async def test_an_unknown_expired_revoked_or_malformed_link_all_answer_the_same(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    expired, share = await _link(api, seeded)
    await execute(
        migrated,
        "UPDATE core.ai_report_shares SET created_at = now() - interval '40 days', "
        "expires_at = now() - interval '10 days' WHERE id = $1::uuid",
        share["id"],
    )
    revoked, other = await _link(api, seeded)
    await api.delete(f"{_base(seeded)}/{other['id']}", headers=seeded.owner.headers)
    live, _ = await _link(api, seeded)

    answers = [
        await api.get(f"{PUBLIC}/{token}")
        for token in (expired, revoked, "a" * 43, "short", "../etc")
    ]

    assert all(problem(answer) == (404, "not_found") for answer in answers)
    assert (await api.get(f"{PUBLIC}/{live}")).status_code == 200


async def test_a_summary_link_does_not_open_a_report_and_the_other_way_round(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    summary_link = await api.post(
        project_url(seeded.workspace, seeded.project.id, "internal-links", "shares"),
        json={},
        headers=seeded.owner.headers,
    )
    summary_token = summary_link.json()["data"]["token"]
    report_token, _ = await _link(api, seeded)

    assert (await api.get(f"{PUBLIC}/{summary_token}")).status_code == 404
    assert (
        await api.get(f"/api/v1/public/internal-links/summary/{report_token}")
    ).status_code == 404


async def test_another_project_of_the_workspace_never_shows_in_the_report(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    token, _ = await _link(api, seeded)
    before = (await api.get(f"{PUBLIC}/{token}")).json()["data"]
    await answer_in_another_project(
        migrated, worker_db, import_store, seeded.workspace.id, "Zeta" + uuid.uuid4().hex[:4], 1
    )

    after = (await api.get(f"{PUBLIC}/{token}")).json()["data"]

    assert {**after, "generated_at": None} == {**before, "generated_at": None}


async def test_a_link_to_a_project_with_no_answers_yet_opens_an_empty_report(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    from tests.api.auth.support import make_workspace
    from tests.api.keywords.support import keyword_project

    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    owner = await member(resources, migrated, workspace, "owner")
    made = await api.post(
        project_url(workspace, project, "reports", "shares"), json={}, headers=owner.headers
    )

    response = await api.get(f"{PUBLIC}/{made.json()['data']['token']}")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["engines"], data["cited_domains"], data["prompt_count"]) == ([], [], 0)


async def test_a_refused_read_is_as_private_as_a_good_one(
    api: httpx.AsyncClient,
) -> None:
    response = await api.get(f"{PUBLIC}/{'a' * 43}")

    assert problem(response) == (404, "not_found")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
