"""The AI coverage of a run (contract C3, WP-30): per engine what the run planned, what came
back, what was valid, and every planned task that has no answer."""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.operations import ai_coverage_repository as repository
from idraft.api.operations.ai_coverage_repository import EngineCounts
from idraft.api.operations.collection_errors import NotAnAiRunError
from idraft.api.problems import NotFoundError
from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.ai_collection import (
    AiCoverage,
    AiCoverageEngine,
    AiCoverageMissing,
    InvalidByStatus,
    TaskStatus,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import EngineCode

AI_WORKLOAD = "ai_prompt"


def valid_rate(valid: int, planned: int, observed: int) -> MetricCell:
    """`valid` of `planned`; no value (never 0) when nothing was planned."""
    return MetricCell(
        value=None if planned == 0 else valid / planned,
        numerator=valid,
        denominator=planned,
        n_observations=observed,
    )


def engine_coverage(counts: EngineCounts) -> AiCoverageEngine:
    # A partial answer counts as valid (doc 07 section 5.5); `partial` says how many of them.
    valid = counts.complete + counts.partial
    return AiCoverageEngine(
        engine_code=EngineCode(counts.engine_code),
        planned=counts.planned,
        observed=counts.observed,
        valid=valid,
        partial=counts.partial,
        invalid_by_status=InvalidByStatus(
            empty=counts.empty, refused=counts.refused, error=counts.error
        ),
        valid_rate=valid_rate(valid, counts.planned, counts.observed),
    )


class AiCoverageService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def coverage(self, access: WorkspaceAccess, project_id: UUID, run_id: UUID) -> AiCoverage:
        """`404` for a run that is not in the project, `422 not_an_ai_run` for one of another
        workload. One snapshot for the counts and the list, so they agree on a run in progress."""
        workspace_id = access.workspace_id
        async with workspace_transaction(
            self._sessions, workspace_id, user_id=access.user_id, isolation_level="REPEATABLE READ"
        ) as db:
            head = await repository.run_head(db, workspace_id, project_id, run_id)
            if head is None:
                raise NotFoundError
            if head.workload != AI_WORKLOAD:
                raise NotAnAiRunError(f"The run's workload is `{head.workload}`, not `ai_prompt`.")
            counts = await repository.engine_counts(
                db, workspace_id, project_id, run_id, head.created_at
            )
            missing = await repository.missing_tasks(
                db, workspace_id, project_id, run_id, head.created_at
            )
        return AiCoverage(
            by_engine=[engine_coverage(found) for found in counts],
            missing=[
                AiCoverageMissing(
                    prompt_id=task.prompt_id,
                    engine_code=EngineCode(task.engine_code),
                    location_id=task.location_id,
                    replicate_index=task.replicate_index,
                    # A check constraint on the column keeps the value inside `TaskStatus`.
                    task_status=cast(TaskStatus, task.task_status),
                )
                for task in missing
            ],
        )
