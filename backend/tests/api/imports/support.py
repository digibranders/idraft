"""Helpers for the keyword import route tests."""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from typing import Any

import httpx

from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.entities.support import Caller
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer

COUNT_NAMES = ("new", "duplicate", "variant", "conflict", "invalid")


def imports_url(workspace: Workspace, project_id: uuid.UUID, *parts: object) -> str:
    return project_url(workspace, project_id, "keyword-imports", *parts)


async def create_paste(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    text: str = "crm\nerp\n",
    **body: Any,
) -> httpx.Response:
    return await api.post(
        imports_url(workspace, project_id),
        json={"source": "paste", "paste": text, **body},
        headers=caller.headers,
    )


async def created_import(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    **body: Any,
) -> dict[str, Any]:
    response = await create_paste(api, workspace, project_id, caller, **body)
    assert response.status_code == 202, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def preview(
    pg: PostgresServer,
    workspace: Workspace,
    import_id: str,
    rows: Sequence[dict[str, Any]],
    *,
    status: str = "preview_ready",
) -> None:
    """Rows as the worker leaves them (it parses in its own process), with the counts and the
    status that go with them. Each row says `row_no`, `outcome` and `action`; the rest is
    filled in."""
    counts = {"rows_total": len(rows), "created": 0, "skipped": 0, "merged": 0}
    counts.update({name: sum(1 for row in rows if row["outcome"] == name) for name in COUNT_NAMES})
    for row in rows:
        await execute(
            pg,
            "INSERT INTO seo.keyword_import_rows (import_id, row_no, part, workspace_id, raw, "
            "keyword_text, normalized_text, language_code, device, location_id, outcome, "
            "reason_code, reason, existing_tracked_keyword_id, action, result) VALUES ($1, $2, "
            "$3, $4, $5::jsonb, $6, $7, 'en', $8, 2840, $9, $10, $11, $12, $13, $14)",
            uuid.UUID(import_id),
            row["row_no"],
            row.get("part", 1),
            workspace.id,
            json.dumps(row.get("raw", {"keyword": row.get("keyword", "crm")})),
            row.get("keyword", "crm"),
            row.get("keyword", "crm").lower(),
            row.get("device", "desktop"),
            row["outcome"],
            row.get("reason_code"),
            row.get("reason"),
            row.get("existing"),
            row["action"],
            row.get("result"),
        )
    await execute(
        pg,
        "UPDATE seo.keyword_imports SET status = $2, counts = $3::jsonb WHERE id = $1",
        uuid.UUID(import_id),
        status,
        json.dumps(counts),
    )


async def status_of(pg: PostgresServer, import_id: str) -> str:
    row = await fetchrow(
        pg, "SELECT status FROM seo.keyword_imports WHERE id = $1", uuid.UUID(import_id)
    )
    status: str = row["status"]
    return status
