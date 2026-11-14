"""`team_document` of the resolved layout: the team default of the screen, answered beside the
document the caller sees, so the web can reset to it and compare a draft with it (F-10).

It is the team row only. A personal row never reaches it, and every member of the workspace gets
the same value (the team default is workspace visible)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member
from tests.api.layouts.support import DOCUMENT, OTHER, insert_layout, layout_url
from tests.api.layouts.test_get_layout import stored_form
from tests.api.layouts.test_team_layouts import team_url
from tests.conftest import PostgresServer

MARKER = "zz_personal_marker_91"
# A personal document with a value no team document holds; stored directly, so the catalog never
# sees it.
PERSONAL: dict[str, Any] = {
    "schema": 1,
    "cards": [{"id": "p1", "type": "ai.by_engine", "options": {"metric": MARKER}}],
}


def read_url(workspace_id: object) -> str:
    return layout_url(workspace_id, "layouts", "overview")


async def test_without_a_team_default_team_document_is_null(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(read_url(workspace.id), headers=viewer.headers)

    data = response.json()["data"]
    assert response.status_code == 200
    assert "team_document" in data
    assert data["team_document"] is None


async def test_a_personal_layout_alone_never_fills_team_document(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", PERSONAL, viewer.user_id
    )

    response = await api.get(read_url(workspace.id), headers=viewer.headers)

    data = response.json()["data"]
    assert (data["source"], data["team_default_exists"]) == ("personal", False)
    assert data["document"] == stored_form(PERSONAL)
    assert data["team_document"] is None


async def test_with_only_a_team_default_it_is_the_resolved_document(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)

    response = await api.get(read_url(workspace.id), headers=viewer.headers)

    data = response.json()["data"]
    assert data["source"] == "team"
    assert data["team_document"] == stored_form(DOCUMENT)
    assert data["team_document"] == data["document"]


async def test_a_personal_layout_that_wins_does_not_hide_the_team_document(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    await insert_layout(
        migrated, workspace.id, viewer.user_id, "overview", PERSONAL, viewer.user_id
    )

    response = await api.get(read_url(workspace.id), headers=viewer.headers)

    data = response.json()["data"]
    assert data["source"] == "personal"
    assert data["document"] == stored_form(PERSONAL)
    assert data["team_document"] == stored_form(DOCUMENT)
    assert data["team_document"] != data["document"]
    assert MARKER not in json.dumps(data["team_document"])


async def test_every_member_gets_the_same_team_document_and_no_personal_row(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    editor = await member(resources, migrated, workspace, "editor")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, admin.user_id)
    await insert_layout(
        migrated, workspace.id, editor.user_id, "overview", PERSONAL, editor.user_id
    )
    await insert_layout(migrated, workspace.id, viewer.user_id, "overview", OTHER, viewer.user_id)

    as_viewer = await api.get(read_url(workspace.id), headers=viewer.headers)
    as_admin = await api.get(read_url(workspace.id), headers=admin.headers)
    as_editor = await api.get(read_url(workspace.id), headers=editor.headers)

    assert as_viewer.json()["data"]["document"] == stored_form(OTHER)
    assert as_editor.json()["data"]["document"] == stored_form(PERSONAL)
    team = [r.json()["data"]["team_document"] for r in (as_viewer, as_admin, as_editor)]
    assert team == [stored_form(DOCUMENT)] * 3
    # The editor's distinctive value is in the editor's own body only.
    assert MARKER in as_editor.text
    assert MARKER not in as_viewer.text
    assert MARKER not in as_admin.text


async def test_a_damaged_team_default_leaves_team_document_null(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(
        migrated, workspace.id, None, "overview", {"schema": 1, "cards": "x"}, admin.user_id
    )
    await insert_layout(migrated, workspace.id, viewer.user_id, "overview", OTHER, viewer.user_id)

    alone = await api.get(read_url(workspace.id), headers=admin.headers)
    with_personal = await api.get(read_url(workspace.id), headers=viewer.headers)

    assert alone.json()["data"]["team_document"] is None
    assert alone.json()["data"]["team_default_exists"] is False
    assert with_personal.json()["data"]["team_document"] is None
    assert with_personal.json()["data"]["source"] == "personal"


async def test_the_personal_put_answers_with_the_team_document(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    viewer = await member(resources, migrated, workspace, "viewer")
    await insert_layout(migrated, workspace.id, None, "overview", OTHER, admin.user_id)

    response = await api.put(
        layout_url(workspace.id, "me", "layouts", "overview"),
        json=DOCUMENT,
        headers=viewer.headers,
    )

    data = response.json()["data"]
    assert response.status_code == 200
    assert data["source"] == "personal"
    assert data["document"] == stored_form(DOCUMENT)
    assert data["team_document"] == stored_form(OTHER)


async def test_the_personal_put_without_a_team_default_answers_null(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.put(
        layout_url(workspace.id, "me", "layouts", "overview"),
        json=DOCUMENT,
        headers=viewer.headers,
    )

    assert response.status_code == 200
    assert response.json()["data"]["team_document"] is None


async def test_the_team_put_answers_with_the_team_document(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await insert_layout(migrated, workspace.id, admin.user_id, "overview", PERSONAL, admin.user_id)

    response = await api.put(team_url(workspace.id), json=OTHER, headers=admin.headers)

    data = response.json()["data"]
    assert response.status_code == 200
    # The answer is the layout as it now resolves: the admin's own layout still wins, and the
    # team document is the one just saved.
    assert data["source"] == "personal"
    assert data["document"] == stored_form(PERSONAL)
    assert data["team_document"] == stored_form(OTHER)


async def test_the_team_put_is_the_team_document_when_it_resolves(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")

    response = await api.put(team_url(workspace.id), json=DOCUMENT, headers=admin.headers)

    data = response.json()["data"]
    assert (response.status_code, data["source"]) == (200, "team")
    assert data["team_document"] == data["document"] == stored_form(DOCUMENT)
