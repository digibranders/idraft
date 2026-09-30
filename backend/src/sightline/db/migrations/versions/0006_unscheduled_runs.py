"""The window guard is for runs a schedule triggered.

`UNIQUE NULLS NOT DISTINCT (schedule_id, window_start)` was meant to make planning a schedule's
window twice plan it once. With NULLS NOT DISTINCT it also treated every run that has no schedule
(manual, backfill, retry) as one schedule, so two such runs with the same window start could not
both exist, whichever workspaces they belonged to. A backfill of the same day for two projects
would have recorded one run.

The guard is now a unique index over the runs whose trigger is `schedule`, and such a run must
name its schedule. Any other run is outside it. A guard for those (one run per request that asks
for one, by `origin_request_id`) comes with the route that starts them.

Revision ID: 0006
Revises: 0005
"""

from __future__ import annotations

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_OLD = "collection_runs_schedule_id_window_start_key"
_INDEX = "collection_runs_scheduled_window"
_CHECK = "collection_runs_scheduled_names_its_schedule"


def upgrade() -> None:
    op.execute(f"ALTER TABLE ops.collection_runs DROP CONSTRAINT {_OLD}")
    op.execute(
        f"CREATE UNIQUE INDEX {_INDEX} ON ops.collection_runs (schedule_id, window_start) "
        "WHERE trigger = 'schedule'"
    )
    op.execute(
        f"ALTER TABLE ops.collection_runs ADD CONSTRAINT {_CHECK} "
        "CHECK (trigger <> 'schedule' OR schedule_id IS NOT NULL)"
    )


def downgrade() -> None:
    # Local development only. It fails, as it should, once two runs without a schedule share a
    # window start: the old constraint cannot hold them.
    op.execute(f"ALTER TABLE ops.collection_runs DROP CONSTRAINT {_CHECK}")
    op.execute(f"DROP INDEX ops.{_INDEX}")
    op.execute(
        f"ALTER TABLE ops.collection_runs ADD CONSTRAINT {_OLD} "
        "UNIQUE NULLS NOT DISTINCT (schedule_id, window_start)"
    )
