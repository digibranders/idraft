"""Prove `citing_observations` can use `citations_url_observed` on `ai.citations`."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Dialect
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai.citation_board_repository import citing_observations
from idraft.api.ai.source_repository import EXCLUDED_FLAGS, SourceScope
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import make_workspace
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer


class _EmptyResult:
    def scalars(self) -> list[int]:
        return []


class _CaptureSession:
    """Capture the exact SQLAlchemy statement `citing_observations` builds."""

    def __init__(self) -> None:
        self.statement: Any = None

    async def execute(self, statement: Any) -> _EmptyResult:
        self.statement = statement
        return _EmptyResult()


async def test_citing_observations_uses_citations_url_observed_index(
    app: FastAPI, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    project_id = await make_project(pg=migrated, workspace_id=workspace.id)
    now = datetime.now(UTC)
    scope = SourceScope(
        workspace_id=workspace.id,
        project_id=project_id,
        since=now - timedelta(days=28),
        until=now + timedelta(seconds=1),
        engine_codes=("chatgpt_web", "gemini_web", "google_ai_mode"),
        prompt_ids=(uuid.uuid4(),),
        excluded_flags=EXCLUDED_FLAGS,
    )
    capture = _CaptureSession()
    await citing_observations(cast(AsyncSession, capture), scope, 1)
    assert capture.statement is not None

    dialect: Dialect = postgresql.dialect()  # type: ignore[no-untyped-call]
    sql = str(capture.statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    async with workspace_transaction(app.state.resources.sessions, workspace.id) as db:
        await db.execute(text("SET LOCAL enable_seqscan = off"))
        plan_json: object = (await db.execute(text(f"EXPLAIN (FORMAT JSON) {sql}"))).scalar_one()
        child_indexes: set[str] = set(
            (
                await db.execute(
                    text(
                        "SELECT x.indexname FROM pg_inherits i "
                        "JOIN pg_class c ON c.oid = i.inhrelid "
                        "JOIN pg_indexes x ON x.schemaname = 'ai' AND x.tablename = c.relname "
                        "WHERE i.inhparent = 'ai.citations'::regclass "
                        "AND x.indexdef LIKE '%(url_id, observed_at)%'"
                    )
                )
            ).scalars()
        )

    plan_text = json.dumps(plan_json)
    assert child_indexes, "citations_url_observed partition indexes missing"
    assert any(name in plan_text for name in child_indexes), plan_text
