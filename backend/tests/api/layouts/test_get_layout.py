"""GET {W}/layouts/{screen}: what a member sees, its ETag, and the damaged document rule
(WP-11 T2; BE-LAYOUTS-02, 09 and 14)."""

from __future__ import annotations

import re
import uuid
from typing import Any, get_args

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.api.schemas.ai_layouts import LayoutDocument, LayoutScreen
from tests.api.ai.sources_support import statements
from tests.api.auth.support import execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.layouts.support import (
    DOCUMENT,
    ETAG,
    NOT_FOUND,
    insert_layout,
    layout_url,
)
from tests.conftest import PostgresServer

BUILTIN = {
    "screen": "overview",
    "source": "builtin",
    "document": None,
    "team_default_exists": False,
    "updated_at": None,
    "updated_by": None,
}


def stored_form(document: dict[str, Any]) -> dict[str, Any]:
    """A document as the response writes it: absent members come back as null."""
    return LayoutDocument.model_validate(document).model_dump(mode="json", by_alias=True)


async def user_name(pg: PostgresServer, user_id: uuid.UUID) -> str:
    row = await fetchrow(pg, "SELECT name FROM auth.users WHERE id = $1", user_id)
    name: str = row["name"]
    return name


async def test_nothing_saved_reads_as_builtin_with_an_etag(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    url = layout_url(workspace.id, "layouts", "overview")

    first = await api.get(url, headers=viewer.headers)
    second = await api.get(url, headers=viewer.headers)

    assert first.status_code == 200
    assert first.json() == {"data": BUILTIN}
    assert re.fullmatch(ETAG, first.headers["etag"])
    assert first.headers["etag"] == second.headers["etag"]


async def test_the_personal_layout_comes_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", DOCUMENT, viewer.user_id
    )

    response = await api.get(
        layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers
    )

    data = response.json()["data"]
    assert response.status_code == 200
    assert data["source"] == "personal"
    assert data["team_default_exists"] is True
    assert data["updated_by"] == {
        "user_id": str(viewer.user_id),
        "name": await user_name(migrated, viewer.user_id),
    }
    assert data["updated_at"] is not None
    assert data["document"] == stored_form(DOCUMENT)


async def test_the_team_default_when_there_is_no_personal_layout(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)

    response = await api.get(
        layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers
    )

    data = response.json()["data"]
    assert data["source"] == "team"
    assert data["team_default_exists"] is True
    assert data["updated_by"] == {
        "user_id": str(admin.user_id),
        "name": await user_name(migrated, admin.user_id),
    }
    assert data["updated_at"] is not None
    assert data["document"] == stored_form(DOCUMENT)


async def test_a_layout_of_another_screen_is_never_read(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", DOCUMENT, viewer.user_id
    )

    response = await api.get(
        layout_url(workspace.id, "layouts", "rankings"), headers=viewer.headers
    )

    assert response.status_code == 200
    assert response.json() == {"data": {**BUILTIN, "screen": "rankings"}}


async def test_another_members_personal_layout_is_never_read(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    url = layout_url(workspace.id, "layouts", "overview")

    before = await api.get(url, headers=viewer.headers)
    await insert_layout(
        migrated, workspace.id, editor.user_id, "overview", DOCUMENT, editor.user_id
    )
    after = await api.get(url, headers=viewer.headers)

    assert after.json() == {"data": BUILTIN}
    assert after.headers["etag"] == before.headers["etag"]
    assert str(editor.user_id) not in after.text


async def test_a_damaged_personal_layout_falls_back_to_the_team_default(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    await insert_layout(
        migrated,
        workspace.id,
        viewer.user_id,
        "overview",
        {"schema": 2},
        viewer.user_id,
        schema_version=2,
    )

    response = await api.get(
        layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers
    )

    assert response.status_code == 200
    assert response.json()["data"]["source"] == "team"


async def test_a_damaged_team_default_counts_as_absent(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(
        migrated, workspace.id, None, "overview", {"schema": 1, "cards": "x"}, admin.user_id
    )

    response = await api.get(
        layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers
    )

    data = response.json()["data"]
    assert response.status_code == 200
    assert (data["source"], data["team_default_exists"]) == ("builtin", False)


async def test_the_etag_changes_when_a_row_changes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    url = layout_url(workspace.id, "layouts", "overview")
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", DOCUMENT, viewer.user_id
    )

    before = await api.get(url, headers=viewer.headers)
    await execute(
        migrated,
        "UPDATE core.layouts SET updated_at = updated_at + interval '1 second' "
        "WHERE workspace_id = $1",
        workspace.id,
    )
    after = await api.get(url, headers=viewer.headers)

    assert before.headers["etag"] != after.headers["etag"]


async def test_the_etag_changes_when_the_team_default_changes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    url = layout_url(workspace.id, "layouts", "overview")
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", DOCUMENT, viewer.user_id
    )

    before = await api.get(url, headers=viewer.headers)
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    created = await api.get(url, headers=viewer.headers)
    await execute(
        migrated,
        "UPDATE core.layouts SET updated_at = updated_at + interval '1 second' "
        "WHERE workspace_id = $1 AND owner_user_id IS NULL",
        workspace.id,
    )
    bumped = await api.get(url, headers=viewer.headers)

    assert len({before.headers["etag"], created.headers["etag"], bumped.headers["etag"]}) == 3


async def test_the_etag_changes_when_a_team_default_appears_over_the_builtin(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    url = layout_url(workspace.id, "layouts", "overview")

    before = await api.get(url, headers=viewer.headers)
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    created = await api.get(url, headers=viewer.headers)
    await execute(
        migrated,
        "UPDATE core.layouts SET updated_at = updated_at + interval '1 second' "
        "WHERE workspace_id = $1",
        workspace.id,
    )
    bumped = await api.get(url, headers=viewer.headers)

    assert len({before.headers["etag"], created.headers["etag"], bumped.headers["etag"]}) == 3


async def test_the_stored_document_is_answered_as_stored(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """BE-LAYOUTS-14: the web sanitizes a card the catalog no longer knows; the API does not."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    document = {"schema": 1, "cards": [{"id": "c1", "type": "retired.card", "width": "full"}]}
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "inspector.keyword", document, viewer.user_id
    )

    response = await api.get(
        layout_url(workspace.id, "layouts", "inspector.keyword"), headers=viewer.headers
    )

    assert response.status_code == 200
    assert response.json()["data"]["document"] == stored_form(document)


@pytest.mark.parametrize("screen", ["dashboard", "inspector.topics", "ai.overview"])
async def test_an_unknown_screen_is_404(
    screen: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(layout_url(workspace.id, "layouts", screen), headers=viewer.headers)

    assert problem(response) == NOT_FOUND


@pytest.mark.parametrize("screen", get_args(LayoutScreen))
async def test_every_screen_of_the_contract_can_be_read(
    screen: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(layout_url(workspace.id, "layouts", screen), headers=viewer.headers)

    assert response.status_code == 200
    assert response.json()["data"] == {**BUILTIN, "screen": screen}


async def test_reading_is_one_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    with statements(resources) as seen:
        response = await api.get(
            layout_url(workspace.id, "layouts", "overview"), headers=viewer.headers
        )

    assert response.status_code == 200
    assert len([sql for sql in seen if "core.layouts" in sql]) == 1


async def test_the_api_never_stores_the_builtin_default(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """BE-LAYOUTS-09: reading every screen writes nothing."""
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    for screen in get_args(LayoutScreen):
        await api.get(layout_url(workspace.id, "layouts", screen), headers=viewer.headers)

    rows = await fetch(
        migrated, "SELECT id FROM core.layouts WHERE workspace_id = $1", workspace.id
    )
    assert rows == []
