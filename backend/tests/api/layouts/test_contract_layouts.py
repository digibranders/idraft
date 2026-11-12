"""The published contract of layouts (WP-03 T3b; BE-LAYOUTS-02, 03, 04, 06, 07, CF-29): every
route answers `501 not_implemented` after its access checks and a body check. WP-11 deletes this
file when it writes the real tests."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.conftest import PostgresServer

NOT_BUILT = (501, "not_implemented")
FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")

WORKSPACE = "/api/v1/workspaces/{workspace_id}"
CARD = {"id": "c1", "type": "ai.by_engine", "width": "half"}
DOCUMENT: dict[str, Any] = {"schema": 1, "cards": [CARD]}
SCREENS = [
    "overview",
    "ai_overview",
    "rankings",
    "prompts",
    "citations",
    "sources",
    "pages",
    "inspector.keyword",
    "inspector.prompt",
    "inspector.page",
    "inspector.citation",
    "inspector.topic",
]


def layout_url(workspace_id: object, *parts: str) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace_id}", *parts])


@pytest.mark.parametrize("role", ["viewer", "billing", "editor"])
async def test_any_member_reaches_the_personal_routes(
    role: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)

    got = await api.get(layout_url(workspace.id, "layouts", "ai_overview"), headers=caller.headers)
    put = await api.put(
        layout_url(workspace.id, "me", "layouts", "ai_overview"),
        json={"schema": 1},
        headers=caller.headers,
    )
    deleted = await api.delete(
        layout_url(workspace.id, "me", "layouts", "ai_overview"), headers=caller.headers
    )

    assert [problem(got), problem(put), problem(deleted)] == [NOT_BUILT] * 3


async def test_the_team_default_needs_layouts_manage(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    admin = await member(resources, migrated, workspace, "admin")
    url = layout_url(workspace.id, "layouts", "ai_overview", "default")

    assert problem(await api.put(url, json=DOCUMENT, headers=editor.headers)) == FORBIDDEN
    assert problem(await api.delete(url, headers=editor.headers)) == FORBIDDEN
    assert problem(await api.put(url, json=DOCUMENT, headers=admin.headers)) == NOT_BUILT
    assert problem(await api.delete(url, headers=admin.headers)) == NOT_BUILT


@pytest.mark.parametrize(
    ("method", "tail"),
    [
        ("GET", ("layouts", "ai_overview")),
        ("PUT", ("me", "layouts", "ai_overview")),
        ("DELETE", ("me", "layouts", "ai_overview")),
        ("PUT", ("layouts", "ai_overview", "default")),
        ("DELETE", ("layouts", "ai_overview", "default")),
    ],
)
async def test_layouts_refuse_another_workspace(
    method: str,
    tail: tuple[str, ...],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await api.request(
        method,
        layout_url(workspace.id, *tail),
        json=DOCUMENT if method == "PUT" else None,
        headers=outsider.headers,
    )

    assert problem(response) == NOT_FOUND


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
    ],
)
async def test_a_document_out_of_bounds_is_refused_before_501(
    document: dict[str, Any],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.put(
        layout_url(workspace.id, "me", "layouts", "ai_overview"),
        json=document,
        headers=viewer.headers,
    )

    assert problem(response) == INVALID


@pytest.mark.parametrize("screen", ["AI-Overview", "a" * 65])
async def test_a_screen_that_is_not_a_key_is_refused(
    screen: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")

    response = await api.get(layout_url(workspace.id, "layouts", screen), headers=viewer.headers)

    assert problem(response) == INVALID


def test_the_api_document_has_the_layout_routes() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    assert set(paths[f"{WORKSPACE}/layouts/{{screen}}"]) == {"get"}
    assert set(paths[f"{WORKSPACE}/me/layouts/{{screen}}"]) == {"put", "delete"}
    assert set(paths[f"{WORKSPACE}/layouts/{{screen}}/default"]) == {"put", "delete"}
    for name in (
        "LayoutDocument",
        "NumberItem",
        "CardItem",
        "ResolvedLayout",
        "ResolvedLayoutResponse",
        "LayoutEditor",
    ):
        assert name in schemas
    assert "schema" in schemas["LayoutDocument"]["properties"]
    assert "schema" in schemas["LayoutDocument"]["required"]
    for path in (f"{WORKSPACE}/me/layouts/{{screen}}", f"{WORKSPACE}/layouts/{{screen}}/default"):
        headers = [
            parameter
            for parameter in paths[path]["put"]["parameters"]
            if parameter["in"] == "header" and parameter["name"] == "If-Match"
        ]
        assert len(headers) == 1
        assert not headers[0].get("required", False)
    assert schemas["ResolvedLayout"]["properties"]["screen"]["enum"] == SCREENS
