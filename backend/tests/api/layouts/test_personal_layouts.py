"""PUT and DELETE {W}/me/layouts/{screen}: a member's own layout, If-Match, 412, the lock
(WP-11 T3; BE-LAYOUTS-03). The personal routes rest on the session cookie alone: no other
principal exists in the API yet (T6 proves an `Authorization` header alone is 401)."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.layouts.support import (
    DOCUMENT,
    INVALID,
    NOT_FOUND,
    OTHER,
    STALE,
    insert_layout,
    layout_url,
)
from tests.api.layouts.test_catalog import document_of_size
from tests.conftest import PostgresServer

CARD = {"id": "c1", "type": "ai.by_engine", "width": "half"}
STORED = {
    "schema": 1,
    "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "chatgpt_web"}],
    "cards": [{"id": "c1", "type": "ai.by_engine", "width": "half"}],
}
OLD_ETAG = '"' + "0" * 32 + '"'


def personal_url(workspace_id: object, screen: str = "overview") -> str:
    return layout_url(workspace_id, "me", "layouts", screen)


async def rows(pg: PostgresServer, workspace_id: uuid.UUID, screen: str = "overview") -> list[Any]:
    return await fetch(
        pg,
        "SELECT owner_user_id, updated_by, schema_version, document, updated_at "
        "FROM core.layouts WHERE workspace_id = $1 AND screen = $2 ORDER BY created_at",
        workspace_id,
        screen,
    )


async def personal_row(pg: PostgresServer, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    found = [row for row in await rows(pg, workspace_id) if row["owner_user_id"] == user_id]
    assert len(found) == 1
    return found[0]


@asynccontextmanager
async def screen_lock_held(
    pg: PostgresServer, workspace_id: uuid.UUID, screen: str
) -> AsyncIterator[None]:
    """Another transaction holds the advisory lock the writers of the screen take, so a request
    that takes it queues up behind this block."""
    db = await asyncpg.connect(pg.url())
    transaction = db.transaction()
    await transaction.start()
    try:
        await db.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            f"layouts:{workspace_id}:{screen}",
        )
        yield
    finally:
        await transaction.rollback()
        await db.close()


async def writers_queued(pg: PostgresServer, workspace_id: uuid.UUID, screen: str) -> int:
    row = await fetchrow(
        pg,
        "SELECT count(*) AS queued FROM pg_locks WHERE locktype = 'advisory' AND NOT granted "
        "AND ((classid::bigint << 32) | objid::bigint) = hashtextextended($1, 0)",
        f"layouts:{workspace_id}:{screen}",
    )
    queued: int = row["queued"]
    return queued


async def wait_until_queued(pg: PostgresServer, workspace_id: uuid.UUID, count: int) -> None:
    deadline = time.monotonic() + 10
    while await writers_queued(pg, workspace_id, "overview") < count:
        assert time.monotonic() < deadline, f"fewer than {count} writers reached the lock"
        await asyncio.sleep(0.05)


async def test_a_first_save_needs_no_if_match_and_reads_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    saved = await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
    read = await api.get(layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers)

    data = saved.json()["data"]
    assert saved.status_code == 200
    assert data["source"] == "personal"
    assert data["updated_by"]["user_id"] == str(viewer.user_id)
    assert saved.headers["etag"] == read.headers["etag"]
    assert read.json()["data"] == data
    row = await personal_row(migrated, workspace.id, viewer.user_id)
    assert row["updated_by"] == viewer.user_id
    assert row["schema_version"] == 1
    # Absent members are not stored as null.
    assert json.loads(row["document"]) == STORED


async def test_saving_over_an_existing_layout_without_if_match_is_412(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)

    response = await api.put(personal_url(workspace.id), json=OTHER, headers=viewer.headers)

    assert problem(response) == STALE
    row = await personal_row(migrated, workspace.id, viewer.user_id)
    assert json.loads(row["document"]) == STORED


async def test_saving_with_the_etag_read_succeeds(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
    read = await api.get(layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers)

    response = await api.put(
        personal_url(workspace.id),
        json=OTHER,
        headers={**viewer.headers, "If-Match": read.headers["etag"]},
    )

    assert response.status_code == 200
    assert response.headers["etag"] != read.headers["etag"]
    row = await personal_row(migrated, workspace.id, viewer.user_id)
    assert json.loads(row["document"]) == OTHER


async def test_a_stale_if_match_is_412_and_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    first = await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
    await api.put(
        personal_url(workspace.id),
        json=OTHER,
        headers={**viewer.headers, "If-Match": first.headers["etag"]},
    )
    before = await personal_row(migrated, workspace.id, viewer.user_id)

    invented = await api.put(
        personal_url(workspace.id), json=DOCUMENT, headers={**viewer.headers, "If-Match": OLD_ETAG}
    )
    # The ETag from before a successful save is stale too.
    replayed = await api.put(
        personal_url(workspace.id),
        json=DOCUMENT,
        headers={**viewer.headers, "If-Match": first.headers["etag"]},
    )

    assert [problem(invented), problem(replayed)] == [STALE, STALE]
    after = await personal_row(migrated, workspace.id, viewer.user_id)
    assert (after["document"], after["updated_at"]) == (before["document"], before["updated_at"])
    assert json.loads(after["document"]) == OTHER


async def test_a_team_default_saved_meanwhile_makes_the_etag_stale(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    read = await api.get(layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers)
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)

    response = await api.put(
        personal_url(workspace.id),
        json=OTHER,
        headers={**viewer.headers, "If-Match": read.headers["etag"]},
    )

    assert problem(response) == STALE
    assert [row["owner_user_id"] for row in await rows(migrated, workspace.id)] == [None]


async def test_the_same_document_again_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    first = await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
    before = await personal_row(migrated, workspace.id, viewer.user_id)

    again = await api.put(
        personal_url(workspace.id),
        json=DOCUMENT,
        headers={**viewer.headers, "If-Match": first.headers["etag"]},
    )

    assert again.status_code == 200
    assert again.headers["etag"] == first.headers["etag"]
    after = await personal_row(migrated, workspace.id, viewer.user_id)
    assert after["updated_at"] == before["updated_at"]


async def test_delete_goes_back_to_the_team_default(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", OTHER, admin.user_id)
    await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)

    response = await api.delete(personal_url(workspace.id), headers=viewer.headers)
    read = await api.get(layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers)

    assert response.status_code == 204
    assert response.content == b""
    assert read.json()["data"]["source"] == "team"
    assert [row["owner_user_id"] for row in await rows(migrated, workspace.id)] == [None]


async def test_delete_without_a_layout_is_204(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.delete(personal_url(workspace.id), headers=viewer.headers)

    assert response.status_code == 204


async def test_the_etag_after_a_delete_cannot_save_over_a_new_row(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A row created again after a delete has a new id, so the old ETag is stale."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    first = await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
    await api.delete(personal_url(workspace.id), headers=viewer.headers)
    await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)

    response = await api.put(
        personal_url(workspace.id),
        json=OTHER,
        headers={**viewer.headers, "If-Match": first.headers["etag"]},
    )

    assert problem(response) == STALE


@pytest.mark.parametrize("role", ["viewer", "billing", "analyst", "editor", "admin", "owner"])
async def test_any_member_may_arrange_their_own_view(
    role: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)

    saved = await api.put(
        personal_url(workspace.id, "ai_overview"), json={"schema": 1}, headers=caller.headers
    )
    deleted = await api.delete(personal_url(workspace.id, "ai_overview"), headers=caller.headers)

    assert (saved.status_code, deleted.status_code) == (200, 204)


async def test_a_member_never_changes_another_members_layout(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    await insert_layout(
        migrated, workspace.id, editor.user_id, "overview", DOCUMENT, editor.user_id
    )
    before = await personal_row(migrated, workspace.id, editor.user_id)

    saved = await api.put(personal_url(workspace.id), json=OTHER, headers=viewer.headers)
    mine = await personal_row(migrated, workspace.id, viewer.user_id)
    deleted = await api.delete(personal_url(workspace.id), headers=viewer.headers)

    assert (saved.status_code, deleted.status_code) == (200, 204)
    assert json.loads(mine["document"]) == OTHER
    after = await personal_row(migrated, workspace.id, editor.user_id)
    assert (after["document"], after["updated_at"]) == (before["document"], before["updated_at"])
    assert len(await rows(migrated, workspace.id)) == 1


async def test_a_personal_layout_is_per_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    here = await make_workspace(migrated)
    there = await make_workspace(migrated)
    viewer = await member(resources, migrated, here, "viewer")
    await api.put(personal_url(here.id), json=DOCUMENT, headers=viewer.headers)

    refused = await api.delete(personal_url(there.id), headers=viewer.headers)

    assert problem(refused) == NOT_FOUND
    assert len(await rows(migrated, here.id)) == 1
    assert await rows(migrated, there.id) == []


@pytest.mark.parametrize(
    "document",
    [
        {"schema": 2},
        {},
        {"schema": 1, "cards": [{**CARD, "id": f"c{n}"} for n in range(13)]},
        {"schema": 1, "numbers": [{"id": f"n{n}", "metric": "ai.mentions"} for n in range(7)]},
        {"schema": 1, "cards": [{**CARD, "width": "wide"}]},
        {"schema": 1, "cards": [{**CARD, "id": "has space"}]},
        {"schema": 1, "cards": [{**CARD, "id": "a" * 65}]},
        {"schema": 1, "cards": [{**CARD, "type": "AI By Engine"}]},
        {"schema": 1, "cards": [{**CARD, "options": {"rows": 5}}]},
        {"schema": 1, "cards": [{**CARD, "options": {"Rows": "5"}}]},
        {"schema": 1, "cards": [{**CARD, "options": {"a" * 65: "x"}}]},
        {"schema": 1, "cards": [{**CARD, "options": {"rows": "x" * 257}}]},
        {"schema": 1, "cards": [{**CARD, "options": {"rows": "a\u0000b"}}]},
        {"schema": 1, "numbers": [{"id": "n1", "metric": "AI Mentions"}]},
        {"schema": 1, "extra": 1},
        {
            "schema": 1,
            "numbers": [{"id": "n1", "metric": "ai.mentions", "engine": "perplexity_web"}],
        },
        # Owner decision Q8: this engine is not accepted until slice 2.
        {
            "schema": 1,
            "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "google_ai_overview"}],
        },
    ],
)
async def test_a_document_out_of_bounds_is_422(
    document: dict[str, Any],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.put(personal_url(workspace.id), json=document, headers=viewer.headers)

    assert problem(response) == INVALID
    assert await rows(migrated, workspace.id) == []


async def test_a_catalog_miss_is_422_with_its_path(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.put(
        personal_url(workspace.id, "inspector.keyword"),
        json={"schema": 1, "cards": [{"id": "c1", "type": "ai.by_engine"}]},
        headers=viewer.headers,
    )

    assert problem(response) == INVALID
    errors = [(item["path"], item["code"]) for item in response.json()["errors"]]
    assert errors == [("cards.0.type", "not_in_catalog")]
    assert await rows(migrated, workspace.id, "inspector.keyword") == []


async def test_a_document_over_16_kb_is_422(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    options: dict[str, Any] = {"exclude_none": True, "mode": "json", "by_alias": True}
    too_big = document_of_size(16385).model_dump(**options)
    at_most = document_of_size(16384).model_dump(**options)

    refused = await api.put(personal_url(workspace.id), json=too_big, headers=viewer.headers)
    accepted = await api.put(personal_url(workspace.id), json=at_most, headers=viewer.headers)

    assert problem(refused) == INVALID
    assert [(item["path"], item["code"]) for item in refused.json()["errors"]] == [
        ("", "too_large")
    ]
    assert accepted.status_code == 200


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
async def test_an_unknown_screen_is_404_on_writes(
    method: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.request(
        method,
        personal_url(workspace.id, "dashboard"),
        json=DOCUMENT if method == "PUT" else None,
        headers=viewer.headers,
    )

    assert problem(response) == NOT_FOUND


async def test_a_write_in_a_suspended_workspace_is_403(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1", workspace.id
    )

    response = await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)

    assert problem(response) == (403, "workspace_suspended")
    assert await rows(migrated, workspace.id) == []


async def test_two_first_saves_at_the_same_moment_one_wins(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Both requests are queued on the screen's advisory lock before either may run, so the
    outcome does not depend on timing: the second one reads the first one's row."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    async with screen_lock_held(migrated, workspace.id, "overview"):
        first = asyncio.create_task(
            api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
        )
        second = asyncio.create_task(
            api.put(personal_url(workspace.id), json=OTHER, headers=viewer.headers)
        )
        await wait_until_queued(migrated, workspace.id, 2)
    responses = await asyncio.gather(first, second)

    assert sorted(response.status_code for response in responses) == [200, 412]
    assert len(await rows(migrated, workspace.id)) == 1


async def test_two_saves_with_the_same_etag_at_the_same_moment_one_wins(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    third = {"schema": 1, "cards": [{"id": "c1", "type": "seo.top_movers"}]}
    first_save = await api.put(personal_url(workspace.id), json=DOCUMENT, headers=viewer.headers)
    headers = {**viewer.headers, "If-Match": first_save.headers["etag"]}

    async with screen_lock_held(migrated, workspace.id, "overview"):
        one = asyncio.create_task(api.put(personal_url(workspace.id), json=OTHER, headers=headers))
        two = asyncio.create_task(api.put(personal_url(workspace.id), json=third, headers=headers))
        await wait_until_queued(migrated, workspace.id, 2)
    responses = await asyncio.gather(one, two)

    assert sorted(response.status_code for response in responses) == [200, 412]
    winner = OTHER if responses[0].status_code == 200 else third
    row = await personal_row(migrated, workspace.id, viewer.user_id)
    assert json.loads(row["document"]) == winner
