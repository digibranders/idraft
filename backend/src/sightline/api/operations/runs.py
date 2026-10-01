"""Rules for collection runs the API asks for (docs/19-api-specification.md section 3.11.4;
plan decision D9).

A manual run is recorded as `planned` with its selector; the worker's planner plans it, judges
it against the budget and starts it. A project has `MANUAL_RUNS_PER_DAY` runs people ask for
each day (UTC); runs the system starts for new keywords do not count.
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.keywords import repository as keywords
from sightline.api.operations import runs_repository as runs
from sightline.api.operations.runs_repository import RunRecord
from sightline.api.problems import ManualRunLimitError, NotFoundError, invalid_field
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.keywords import MetricsRefresh
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction

# docs/24 section 8.
MANUAL_RUNS_PER_DAY: Final = 20
# How long a manual run has to send its tasks.
MANUAL_WINDOW: Final = timedelta(hours=1)
KEYWORD_METRICS: Final = "keyword_metrics"


class RunService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def refresh_metrics(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: MetricsRefresh,
        info: RequestInfo,
    ) -> RunRecord:
        """A manual keyword metrics run: the given keywords (tracked by the project), else
        the project's keywords whose metrics are older than `stale_days`."""
        async with self._transaction(access) as db:
            if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
                raise NotFoundError
            selector: dict[str, object] = {}
            if body.keyword_ids is not None:
                tracked = await runs.tracked_keyword_ids(
                    db, access.workspace_id, project_id, body.keyword_ids
                )
                if any(keyword_id not in tracked for keyword_id in body.keyword_ids):
                    raise invalid_field(
                        "keyword_ids",
                        code="keyword_unknown",
                        message="A keyword the project does not track, or has archived.",
                    )
                selector["keyword_ids"] = sorted(
                    str(keyword_id) for keyword_id in set(body.keyword_ids)
                )
            if body.stale_days is not None:
                selector["stale_days"] = body.stale_days
            await runs.lock_manual_runs(db, project_id)
            now: datetime = (await db.execute(select(func.now()))).scalar_one()
            today = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
            used = await runs.manual_runs_since(db, access.workspace_id, project_id, today)
            if used >= MANUAL_RUNS_PER_DAY:
                raise ManualRunLimitError(
                    f"The project has had its {MANUAL_RUNS_PER_DAY} manual runs today (UTC).",
                    limit=MANUAL_RUNS_PER_DAY,
                )
            run_id = await runs.insert_manual_run(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                workload=KEYWORD_METRICS,
                user_id=access.user_id,
                request_id=info.request_id,
                selector=selector,
                window=MANUAL_WINDOW,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="collection_run.requested",
                target_type="collection_run",
                target_id=run_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "workload": KEYWORD_METRICS,
                    "keyword_count": len(body.keyword_ids or ()),
                    "stale_days": body.stale_days,
                },
            )
            created = await runs.get_run(db, access.workspace_id, project_id, run_id)
        if created is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return created
