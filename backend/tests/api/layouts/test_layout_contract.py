"""The published contract of layouts that every route keeps (contract C12a; BE-LAYOUTS-02, 03,
04, 06, 07): another workspace is 404, a screen that is not a key is 422, the API document lists
the routes and no operation says it is not built. The behaviour of each route has its own file:
test_get_layout.py, test_personal_layouts.py and test_team_layouts.py."""

from __future__ import annotations

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.layouts.support import DOCUMENT, INVALID, NOT_FOUND, layout_url
from tests.conftest import PostgresServer

WORKSPACE = "/api/v1/workspaces/{workspace_id}"
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
    for path in (
        f"{WORKSPACE}/layouts/{{screen}}",
        f"{WORKSPACE}/me/layouts/{{screen}}",
        f"{WORKSPACE}/layouts/{{screen}}/default",
    ):
        for operation in paths[path].values():
            assert "Not built yet" not in operation["description"]
