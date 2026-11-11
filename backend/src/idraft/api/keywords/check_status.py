"""Where a keyword's latest rank check stands: queued, being answered, done, inconclusive or
failed (docs/19 section 3.6.4). Read from the task ledger and the snapshot a task made, so a
manual check and a scheduled one are told the same way, and so Check now can refuse a second
paid request for a reading that is already under way.

A task is counted once it is due: a scheduled task waiting for its place in a window hours from
now is not "queued" in any sense a person asked for, and must not stop them asking.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal
from uuid import UUID

from sqlalchemy import and_, func, literal_column, not_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import collection_runs, collection_tasks, serp_snapshots

CheckStatus = Literal["idle", "queued", "processing", "completed", "inconclusive", "failed"]

PENDING: Final = frozenset({"queued", "processing"})
# Task statuses by what a person would call them. `ingested` is settled by the snapshot.
_QUEUED: Final = frozenset({"pending", "submit_unknown"})
_PROCESSING: Final = frozenset({"submitted", "ready", "fetched"})
_FAILED: Final = frozenset({"failed", "dead"})
# How far back the ledger is read: it is partitioned by month, so this stays on the last two.
_LOOKBACK: Final = "interval '40 days'"
# A manual run that was never planned (the worker is down) stops counting as queued after this.
_PLANNED_RUN_MAX_AGE: Final = "interval '1 day'"


@dataclass(frozen=True, slots=True)
class CheckProgress:
    status: CheckStatus
    requested_at: datetime | None = None
    finished_at: datetime | None = None
    # The ledger's error code of a failed task, or why a check was inconclusive.
    reason: str | None = None


IDLE: Final = CheckProgress("idle")


def settle(
    status: str,
    *,
    extras: dict[str, Any] | None,
    error_code: str | None,
    requested_at: datetime,
    completed_at: datetime | None,
) -> CheckProgress:
    """The progress a task of this ledger status stands for. `extras` is its snapshot's."""
    if status in _QUEUED:
        return CheckProgress("queued", requested_at)
    if status in _PROCESSING:
        return CheckProgress("processing", requested_at)
    if status in _FAILED:
        return CheckProgress("failed", requested_at, completed_at, error_code)
    if status == "ingested":
        why = (extras or {}).get("inconclusive")
        if isinstance(why, dict):
            reason = why.get("reason") or (
                "unattributed_results" if "unattributed" in why else None
            )
            return CheckProgress("inconclusive", requested_at, completed_at, reason)
        return CheckProgress("completed", requested_at, completed_at)
    return IDLE  # cancelled, skipped: nothing was asked of the provider


async def progress_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, CheckProgress]:
    """The progress of each of these tracked keywords; one with no check in the ledger's reach
    is absent. A manual run not yet planned into tasks counts as queued."""
    if not tracked_ids:
        return {}
    wanted = {str(tracked): tracked for tracked in tracked_ids}
    t, r, s = collection_tasks.c, collection_runs.c, serp_snapshots.c
    # Literals, not bound values: DISTINCT ON and ORDER BY must be the same expression, and two
    # bound values are two different parameters to the database.
    keyword = func.split_part(t.subject_id, literal_column("':'"), literal_column("1"))
    latest = (
        select(
            keyword.label("keyword"),
            t.status,
            t.last_error_code,
            t.completed_at,
            r.created_at.label("requested_at"),
            s.extras,
        )
        .select_from(
            collection_tasks.join(
                collection_runs, and_(r.id == t.run_id, r.workspace_id == t.workspace_id)
            ).outerjoin(
                serp_snapshots,
                and_(s.collection_task_id == t.id, s.workspace_id == t.workspace_id),
            )
        )
        .where(
            t.workspace_id == workspace_id,
            t.workload == "seo_rank",
            t.subject_type == "tracked_keyword",
            keyword.in_(sorted(wanted)),
            t.created_at >= func.date_trunc("month", func.now() - literal_column(_LOOKBACK)),
            not_(and_(t.status == "pending", t.scheduled_for > func.now())),
        )
        .ext(distinct_on(keyword))
        .order_by(keyword, r.created_at.desc(), t.id.desc())
    )
    found: dict[UUID, CheckProgress] = {}
    for row in await db.execute(latest):
        found[wanted[row.keyword]] = settle(
            row.status,
            extras=row.extras,
            error_code=row.last_error_code,
            requested_at=row.requested_at,
            completed_at=row.completed_at,
        )
    planned = await db.execute(
        select(r.created_at, r.config_snapshot).where(
            r.workspace_id == workspace_id,
            r.workload == "seo_rank",
            r.status == "planned",
            r.created_at >= func.now() - literal_column(_PLANNED_RUN_MAX_AGE),
        )
    )
    for row in planned:
        asked = (row.config_snapshot or {}).get("selector", {}).get("tracked_keyword_ids") or []
        for keyword_id in asked:
            if keyword_id in wanted:
                found[wanted[keyword_id]] = CheckProgress("queued", row.created_at)
    return found
