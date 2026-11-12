"""Helpers of the layouts tests."""

from __future__ import annotations

import json
import uuid
from typing import Any

from tests.api.auth.support import fetchrow
from tests.conftest import PostgresServer

FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")
STALE = (412, "precondition_failed")
ETAG = r'^"[0-9a-f]{32}"$'
# Valid on `overview` against the web catalog of 2026-11-13 (catalog.json).
DOCUMENT: dict[str, Any] = {
    "schema": 1,
    "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "chatgpt_web"}],
    "cards": [{"id": "c1", "type": "ai.by_engine", "width": "half"}],
}
OTHER: dict[str, Any] = {"schema": 1, "cards": [{"id": "c1", "type": "seo.rank_distribution"}]}


def layout_url(workspace_id: object, *parts: str) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace_id}", *parts])


async def insert_layout(
    pg: PostgresServer,
    workspace_id: uuid.UUID,
    owner_user_id: uuid.UUID | None,
    screen: str,
    document: object,
    updated_by: uuid.UUID,
    *,
    schema_version: int = 1,
) -> uuid.UUID:
    """A row written straight into the table by the superuser (no API, no row security)."""
    row = await fetchrow(
        pg,
        "INSERT INTO core.layouts (workspace_id, owner_user_id, screen, document, "
        "schema_version, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id",
        workspace_id,
        owner_user_id,
        screen,
        json.dumps(document),
        schema_version,
        updated_by,
    )
    return uuid.UUID(str(row["id"]))
