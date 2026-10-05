"""Confirming a keyword import (the imports sub-plan, rules I7 and I8): the API checks the
quota and hands the import to the worker, which writes it (tests/collectors/test_import_writer.py).
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.imports.support import created_import, imports_url, preview, status_of
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


def _rows() -> list[dict[str, Any]]:
    return [
        {"row_no": 1, "keyword": "crm", "outcome": "new", "action": "create"},
        {"row_no": 2, "keyword": "erp", "outcome": "new", "action": "skip"},
        {
            "row_no": 3,
            "keyword": "seo",
            "outcome": "duplicate",
            "reason_code": "tracked",
            "action": "skip",
        },
        {
            "row_no": 4,
            "keyword": "seo",
            "outcome": "duplicate",
            "reason_code": "repeated_in_file",
            "action": "skip",
        },
        {
            "row_no": 5,
            "keyword": "old",
            "outcome": "conflict",
            "reason_code": "archived",
            "action": "skip",
        },
    ]


async def _ready(
    api: httpx.AsyncClient,
    resources: Resources,
    pg: PostgresServer,
    rows: list[dict[str, Any]] | None = None,
) -> tuple[Workspace, uuid.UUID, Caller, str]:
    workspace, project, owner = await _owner(resources, pg)
    data = await created_import(api, workspace, project, owner)
    await preview(pg, workspace, data["import_id"], _rows() if rows is None else rows)
    return workspace, project, owner, data["import_id"]


async def _actions(pg: PostgresServer, import_id: str) -> list[str]:
    rows = await fetch(
        pg,
        "SELECT action FROM seo.keyword_import_rows WHERE import_id = $1 ORDER BY row_no, part",
        uuid.UUID(import_id),
    )
    return [row["action"] for row in rows]


async def test_confirming_hands_the_import_to_the_worker(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, import_id = await _ready(api, resources, migrated)

    response = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "skip"},
        headers=owner.headers,
    )

    assert response.status_code == 202, response.text
    view = response.json()["data"]
    assert view["status"] == "writing"
    assert view["operation"]["status"] == "running"
    assert view["operation"]["links"]["cancel"] is None
    assert view["operation"]["links"]["result"].endswith("/report")
    assert view["quota"] is None
    row = await fetchrow(
        migrated,
        "SELECT status, duplicate_action FROM seo.keyword_imports WHERE id = $1",
        uuid.UUID(import_id),
    )
    assert (row["status"], row["duplicate_action"]) == ("writing", "skip")
    assert await _actions(migrated, import_id) == ["create", "skip", "skip", "skip", "skip"]
    audit = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 AND action = $2",
        workspace.id,
        "keyword_import.confirmed",
    )
    assert len(audit) == 1
    assert json.loads(audit[0]["after"]) == {
        "duplicate_action": "skip",
        "status": "writing",
        "planned_writes": 1,
    }


async def test_merge_terms_merges_the_tracked_duplicates_and_nothing_else(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, import_id = await _ready(api, resources, migrated)

    response = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "merge_terms"},
        headers=owner.headers,
    )

    assert response.status_code == 202, response.text
    # The tracked duplicate (row 3) merges; the repeat in the file, the archived keyword and the
    # row the person chose to skip stay as they were.
    assert await _actions(migrated, import_id) == ["create", "skip", "merge", "skip", "skip"]


async def test_a_row_the_person_chose_is_kept_when_duplicates_are_merged(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    rows = [
        {
            "row_no": 1,
            "outcome": "duplicate",
            "reason_code": "tracked",
            "action": "merge",
        },
        {
            "row_no": 2,
            "keyword": "erp",
            "outcome": "duplicate",
            "reason_code": "tracked",
            "action": "skip",
        },
    ]
    workspace, project, owner, import_id = await _ready(api, resources, migrated, rows)

    await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "merge_terms"},
        headers=owner.headers,
    )

    assert await _actions(migrated, import_id) == ["merge", "merge"]


async def test_the_body_is_required_and_its_action_is_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, import_id = await _ready(api, resources, migrated)
    url = imports_url(workspace, project, import_id, "confirm")

    missing = await api.post(url, headers=owner.headers)
    unknown = await api.post(url, json={"duplicate_action": "replace"}, headers=owner.headers)
    default = await api.post(url, json={}, headers=owner.headers)

    # No body at all is no JSON body, as everywhere in the API.
    assert problem(missing) == (415, "unsupported_media_type")
    assert problem(unknown) == (422, "validation_failed")
    assert default.status_code == 202, default.text


@pytest.mark.parametrize(
    "status",
    [
        "uploaded",
        "needs_mapping",
        "writing",
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
        "expired",
    ],
)
async def test_only_a_ready_preview_can_be_confirmed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, status: str
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    data = await created_import(api, workspace, project, owner)
    await preview(migrated, workspace, data["import_id"], _rows(), status=status)

    response = await api.post(
        imports_url(workspace, project, data["import_id"], "confirm"),
        json={"duplicate_action": "merge_terms"},
        headers=owner.headers,
    )

    assert problem(response) == (409, "invalid_state_transition")
    assert await status_of(migrated, data["import_id"]) == status
    assert await _actions(migrated, data["import_id"]) == ["create", "skip", "skip", "skip", "skip"]


async def test_a_preview_past_its_time_cannot_be_confirmed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, import_id = await _ready(api, resources, migrated)
    await execute(
        migrated,
        "UPDATE seo.keyword_imports SET expires_at = now() - interval '1 minute' WHERE id = $1",
        uuid.UUID(import_id),
    )

    response = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "skip"},
        headers=owner.headers,
    )

    assert problem(response) == (409, "invalid_state_transition")
    assert await status_of(migrated, import_id) == "preview_ready"


async def test_an_import_that_does_not_fit_the_quota_is_refused_and_nothing_changes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    rows = [
        {"row_no": 1, "keyword": "a", "outcome": "new", "action": "create"},
        {"row_no": 2, "keyword": "b", "outcome": "new", "action": "create"},
        {"row_no": 3, "keyword": "c", "outcome": "new", "action": "create"},
        {
            "row_no": 4,
            "keyword": "d",
            "outcome": "duplicate",
            "reason_code": "tracked",
            "action": "skip",
        },
    ]
    workspace, project, owner, import_id = await _ready(api, resources, migrated, rows)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 2)",
        workspace.id,
    )

    response = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "merge_terms"},
        headers=owner.headers,
    )

    assert problem(response) == (422, "quota_exceeded")
    body = response.json()
    assert (body["limit"], body["used"], body["requested"]) == (2, 0, 3)
    assert await status_of(migrated, import_id) == "preview_ready"
    # The merge of duplicates asked for in the same request did not stick either.
    assert await _actions(migrated, import_id) == ["create", "create", "create", "skip"]
    assert (
        await fetch(
            migrated,
            "SELECT id FROM ops.audit_logs WHERE workspace_id = $1 AND action = $2",
            workspace.id,
            "keyword_import.confirmed",
        )
        == []
    )


async def test_bringing_back_an_archived_keyword_counts_against_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    rows = [
        {"row_no": 1, "keyword": "a", "outcome": "new", "action": "create"},
        {
            "row_no": 2,
            "keyword": "b",
            "outcome": "conflict",
            "reason_code": "archived",
            "action": "merge",
        },
    ]
    workspace, project, owner, import_id = await _ready(api, resources, migrated, rows)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 1)",
        workspace.id,
    )

    response = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "skip"},
        headers=owner.headers,
    )

    assert problem(response) == (422, "quota_exceeded")
    assert response.json()["requested"] == 2


async def test_an_import_that_fits_exactly_is_confirmed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, import_id = await _ready(api, resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 1)",
        workspace.id,
    )

    response = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "skip"},
        headers=owner.headers,
    )

    assert response.status_code == 202, response.text


async def test_a_viewer_cannot_confirm_and_another_project_cannot_reach_the_import(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, import_id = await _ready(api, resources, migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    other = await keyword_project(migrated, workspace)

    refused = await api.post(
        imports_url(workspace, project, import_id, "confirm"),
        json={"duplicate_action": "skip"},
        headers=viewer.headers,
    )
    elsewhere = await api.post(
        imports_url(workspace, other, import_id, "confirm"),
        json={"duplicate_action": "skip"},
        headers=owner.headers,
    )

    assert problem(refused) == (403, "forbidden")
    assert problem(elsewhere) == (404, "not_found")
    assert await status_of(migrated, import_id) == "preview_ready"
