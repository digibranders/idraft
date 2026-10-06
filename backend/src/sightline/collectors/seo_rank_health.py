"""Which tracked keywords have stopped being checked (docs/21-scheduler-workers.md section 9;
rank collection plan, whole-branch review).

A check that fails ends its task as `failed` or `dead`, and the ingest writes nothing for it, so
the state of the keyword does not hear of it. This pass reads the ledger and tells the state:

- `consecutive_failures`: the rank tasks of the keyword that ended failed since its last
  successful check (all of them while it has had none). A keyword with failures and no check has
  no state row yet, so the pass makes one: the API shows it as `failed`, not as `not_checked`. A
  successful check sets the count to zero when the ingest writes the state.
- `is_stale`: no successful check for 36 hours (a daily profile) or 9 days (a weekly one). A
  keyword that was never checked counts from the day it was tracked. A successful check clears it
  when the ingest writes the state.

Only active, live keywords are judged. Each statement names the workspace, and running the pass
twice changes nothing. The worker bypasses row-level security; the pass covers every workspace
on purpose.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final, cast

from sqlalchemy import CursorResult, Result, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

DAILY_STALE_AFTER: Final = timedelta(hours=36)
WEEKLY_STALE_AFTER: Final = timedelta(days=9)
# Failures older than this are not looked for: the ledger's partitions are monthly, so the scan
# stays on the last two.
FAILURE_LOOKBACK: Final = timedelta(days=35)
_WEEKLY_PROFILES: Final = ("weekly", "weekly_light")

_FAILURES = text(
    """
    WITH failed AS (
        SELECT task.workspace_id,
               task.project_id,
               keyword.id AS tracked_keyword_id,
               count(*) AS failures
        FROM ops.collection_tasks task
        JOIN seo.tracked_keywords keyword
          ON keyword.id::text = split_part(task.subject_id, ':', 1)
         AND keyword.workspace_id = task.workspace_id
         AND keyword.project_id = task.project_id
        LEFT JOIN seo.tracked_keyword_state state
          ON state.tracked_keyword_id = keyword.id
         AND state.workspace_id = keyword.workspace_id
        WHERE task.workload = 'seo_rank'
          AND task.subject_type = 'tracked_keyword'
          AND task.status IN ('failed', 'dead')
          AND task.created_at >= date_trunc('month', cast(:since AS timestamptz))
          AND task.completed_at >= :since
          AND (state.last_observed_at IS NULL OR task.completed_at > state.last_observed_at)
          AND keyword.deleted_at IS NULL
          AND keyword.is_active
        GROUP BY 1, 2, 3
    )
    INSERT INTO seo.tracked_keyword_state
        (tracked_keyword_id, workspace_id, project_id, consecutive_failures)
    SELECT tracked_keyword_id, workspace_id, project_id, least(failures, 32000) FROM failed
    ON CONFLICT (tracked_keyword_id) DO UPDATE
        SET consecutive_failures = EXCLUDED.consecutive_failures, updated_at = now()
        WHERE seo.tracked_keyword_state.consecutive_failures
              IS DISTINCT FROM EXCLUDED.consecutive_failures
    """
)

_STALENESS = text(
    """
    UPDATE seo.tracked_keyword_state state
    SET is_stale = judged.stale, updated_at = now()
    FROM (
        SELECT keyword.id AS tracked_keyword_id,
               keyword.workspace_id,
               coalesce(checked.last_observed_at, keyword.created_at)
                   < cast(:now AS timestamptz)
                     - CASE WHEN keyword.depth_profile = ANY(cast(:weekly AS text[]))
                            THEN cast(:weekly_after AS interval)
                            ELSE cast(:daily_after AS interval) END
                   AS stale
        FROM seo.tracked_keywords keyword
        JOIN seo.tracked_keyword_state checked
          ON checked.tracked_keyword_id = keyword.id AND checked.workspace_id = keyword.workspace_id
        WHERE keyword.deleted_at IS NULL AND keyword.is_active
    ) judged
    WHERE state.tracked_keyword_id = judged.tracked_keyword_id
      AND state.workspace_id = judged.workspace_id
      AND state.is_stale IS DISTINCT FROM judged.stale
    """
)

# A keyword that stopped being collected (archived or deleted) is not stale: nobody expects a
# check of it, and the flag would stay on for ever.
_CLEARED = text(
    """
    UPDATE seo.tracked_keyword_state state
    SET is_stale = false, updated_at = now()
    FROM seo.tracked_keywords keyword
    WHERE keyword.id = state.tracked_keyword_id
      AND keyword.workspace_id = state.workspace_id
      AND state.is_stale
      AND (keyword.deleted_at IS NOT NULL OR NOT keyword.is_active)
    """
)


@dataclass(frozen=True, slots=True)
class HealthReport:
    failures_changed: int
    staleness_changed: int

    @property
    def quiet(self) -> bool:
        return not (self.failures_changed or self.staleness_changed)


async def refresh_health(
    sessions: async_sessionmaker[AsyncSession], *, now: datetime
) -> HealthReport:
    """Bring the failure counts and the stale flags up to date as of `now`."""
    if now.tzinfo is None:
        raise ValueError("`now` must be an aware datetime")
    async with sessions() as db, db.begin():
        failures = await db.execute(_FAILURES, {"since": now - FAILURE_LOOKBACK})
        stale = await db.execute(
            _STALENESS,
            {
                "now": now,
                "weekly": list(_WEEKLY_PROFILES),
                "weekly_after": WEEKLY_STALE_AFTER,
                "daily_after": DAILY_STALE_AFTER,
            },
        )
        cleared = await db.execute(_CLEARED)
    return HealthReport(
        failures_changed=_changed(failures), staleness_changed=_changed(stale) + _changed(cleared)
    )


def _changed(result: Result[Any]) -> int:
    """The rows a data statement changed."""
    return cast("CursorResult[Any]", result).rowcount
