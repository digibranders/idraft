"""What the layout routes refuse and what they do not have (WP-11 T6; BE-LAYOUTS-10, 11, 13 and
CF-29).

Closed in other files and not repeated here:

- A member never reads or writes another member's personal layout, in both layers (BE-LAYOUTS-13):
  `test_get_layout.py::test_another_members_personal_layout_is_never_read` and
  `test_personal_layouts.py::test_a_member_never_changes_another_members_layout` through the API,
  `test_repository.py` for the application filters with row security off, and
  `test_layouts_schema.py` for the policy with the application filters out of the way. The team
  routes leave personal rows alone in
  `test_team_layouts.py::test_the_team_default_leaves_personal_layouts_alone`.
- The 412 race: `test_personal_layouts.py` and `test_team_layouts.py` queue the writers on the
  screen's advisory lock, so the outcome does not depend on timing.
- Another workspace and the scan for another tenant's ids: `tests/security/test_cross_tenant.py`
  (the five routes are taken from the application; `core.layouts` is in its checksum).
"""

from __future__ import annotations

import json
import secrets

import httpx
import pytest
from fastapi.routing import iter_route_contexts

from idraft.api.main import create_app
from idraft.api.openapi import placeholder_settings
from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.layouts.support import DOCUMENT, OTHER, insert_layout, layout_url
from tests.api.layouts.test_personal_layouts import rows
from tests.conftest import PostgresServer

UNAUTHENTICATED = (401, "unauthenticated")
WORKSPACE = "/api/v1/workspaces/{workspace_id}"
ROUTES = [
    ("GET", ("layouts", "overview")),
    ("PUT", ("me", "layouts", "overview")),
    ("DELETE", ("me", "layouts", "overview")),
    ("PUT", ("layouts", "overview", "default")),
    ("DELETE", ("layouts", "overview", "default")),
]


@pytest.mark.parametrize(("method", "tail"), ROUTES)
async def test_an_api_key_is_not_a_session(
    method: str,
    tail: tuple[str, ...],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """The API has no API key principal yet: the session cookie is the only way in, so a request
    with an `Authorization` header and no cookie is a request from nobody. The first package that
    adds API key authentication must keep these routes session only (doc 19 section 2.1)."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await insert_layout(migrated, workspace.id, None, "overview", DOCUMENT, owner.user_id)
    before = await rows(migrated, workspace.id)

    response = await api.request(
        method,
        layout_url(workspace.id, *tail),
        json=OTHER if method == "PUT" else None,
        headers={"Authorization": "Bearer idr_" + secrets.token_urlsafe(32)},
    )

    assert problem(response) == UNAUTHENTICATED
    after = await rows(migrated, workspace.id)
    assert [(row["document"], row["updated_at"]) for row in after] == [
        (row["document"], row["updated_at"]) for row in before
    ]
    assert json.loads(after[0]["document"]) == DOCUMENT


def test_there_is_no_preset_or_sharing_route() -> None:
    """Decision rows. BE-LAYOUTS-10 (D-01): presets are code, so no route lists or picks one.
    BE-LAYOUTS-11 (D-12): sharing is the team default only, so no route shares a layout with one
    person. CF-29: the routes of the contract are the five and no others; a sixth route under a
    layouts path fails here until the contract note and this list say so."""
    found: set[tuple[str, str]] = set()
    paths: set[str] = set()
    for route in iter_route_contexts(create_app(placeholder_settings()).routes):
        assert route.path is not None
        assert route.methods
        paths.add(route.path)
        if "layouts" in route.path:
            found.update((method, route.path) for method in route.methods)

    assert [path for path in paths if "preset" in path or "share" in path] == []
    assert found == {
        ("GET", f"{WORKSPACE}/layouts/{{screen}}"),
        ("PUT", f"{WORKSPACE}/me/layouts/{{screen}}"),
        ("DELETE", f"{WORKSPACE}/me/layouts/{{screen}}"),
        ("PUT", f"{WORKSPACE}/layouts/{{screen}}/default"),
        ("DELETE", f"{WORKSPACE}/layouts/{{screen}}/default"),
    }
