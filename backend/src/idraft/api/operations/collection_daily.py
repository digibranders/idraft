"""Daily AI collection (contract N5, WP-30): per project day and engine what the schedules
planned, what was stored by status, the runs a budget blocked and the runs behind the day."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator, Sequence
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai.sources import local_instants
from idraft.api.ai.summary import summary_dates
from idraft.api.ai.summary_repository import enabled_engine_codes
from idraft.api.operations import collection_daily_repository as repository
from idraft.api.problems import NotFoundError
from idraft.api.ranks.repository import project_zone
from idraft.api.schemas.ai_collection import (
    AnswerStatusCounts,
    CollectionDailyMeta,
    CollectionDailyResponse,
    CollectionDay,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import EngineCode

type Key = tuple[date, str]


def _days(first: date, last: date) -> Iterator[date]:
    for offset in range((last - first).days + 1):
        yield first + timedelta(days=offset)


class CollectionDailyService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def daily(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        start: date | None,
        end: date | None,
        engine_codes: Sequence[EngineCode] | None,
    ) -> CollectionDailyResponse:
        """A row per project day and engine, zero filled. `404` for a project that is not there,
        `422` for a window that is backwards or longer than 92 days. One snapshot for the three
        reads, so a run that ends meanwhile is on one side of every count."""
        workspace_id = access.workspace_id
        asked = sorted({str(code) for code in engine_codes}) if engine_codes else None
        async with workspace_transaction(
            self._sessions, workspace_id, user_id=access.user_id, isolation_level="REPEATABLE READ"
        ) as db:
            found = await project_zone(db, workspace_id, project_id)
            if found is None:
                raise NotFoundError
            zone = ZoneInfo(found.timezone)
            first, last = summary_dates(start, end, datetime.now(zone).date())
            since, until = local_instants(first, last, zone)
            enabled = (
                []
                if asked is not None
                else await enabled_engine_codes(db, workspace_id, project_id)
            )
            planned = await repository.planned_by_day(
                db, workspace_id, project_id, found.timezone, since, until, asked
            )
            answered = await repository.answered_by_day(
                db, workspace_id, project_id, found.timezone, since, until, asked
            )
            blocked = await repository.blocked_by_day(
                db, workspace_id, project_id, found.timezone, since, until
            )

        engines = (
            asked
            if asked is not None
            else sorted(
                {*enabled, *(p.engine_code for p in planned), *(a.engine_code for a in answered)}
            )
        )
        scheduled: dict[Key, int] = {(p.day, p.engine_code): p.tasks for p in planned}
        stored = {(a.day, a.engine_code): a for a in answered}
        runs: dict[Key, set[UUID]] = defaultdict(set)
        for a in answered:
            runs[(a.day, a.engine_code)].update(a.runs)
        blocked_runs: dict[Key, set[UUID]] = defaultdict(set)
        for b in blocked:
            for engine in engines:
                if b.engine_codes is None or engine in b.engine_codes:
                    blocked_runs[(b.day, engine)].update(b.runs)

        rows: list[CollectionDay] = []
        for day in _days(first, last):
            for engine in engines:
                key = (day, engine)
                answers = stored.get(key)
                by_status = AnswerStatusCounts(
                    complete=answers.complete if answers else 0,
                    partial=answers.partial if answers else 0,
                    empty=answers.empty if answers else 0,
                    refused=answers.refused if answers else 0,
                    error=answers.error if answers else 0,
                )
                rows.append(
                    CollectionDay(
                        date_=day,
                        engine_code=EngineCode(engine),
                        scheduled=scheduled.get(key),
                        answers=answers.answers if answers else 0,
                        by_status=by_status,
                        valid=by_status.complete + by_status.partial,
                        budget_blocked=len(blocked_runs[key]),
                        # Run ids are time ordered (uuid v7): id order is oldest first.
                        runs=sorted(runs[key] | blocked_runs[key]),
                    )
                )
        return CollectionDailyResponse(
            data=rows,
            meta=CollectionDailyMeta(
                window=MetricWindow(
                    from_=first.isoformat(), to=last.isoformat(), timezone=found.timezone
                ),
                engine_codes=[EngineCode(engine) for engine in engines],
            ),
        )
