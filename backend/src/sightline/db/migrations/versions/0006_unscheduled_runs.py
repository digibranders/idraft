"""Runs without a schedule do not share a window guard.

`UNIQUE NULLS NOT DISTINCT (schedule_id, window_start)` was meant to make planning a schedule's
window twice plan it once. With NULLS NOT DISTINCT it also treated every run that has no schedule
(manual, backfill, retry) as one schedule, so two such runs with the same window start could not
both exist, whichever workspaces they belonged to. A backfill of the same day for two projects
would have recorded one run.

The guard now covers scheduled runs only, which is what it is for. A run without a schedule is
made once because the request that asks for it is idempotent, not because of its window.

Revision ID: 0006
Revises: 0005
"""

from __future__ import annotations

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_CONSTRAINT = "collection_runs_schedule_id_window_start_key"


def upgrade() -> None:
    op.execute(f"ALTER TABLE ops.collection_runs DROP CONSTRAINT {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE ops.collection_runs ADD CONSTRAINT {_CONSTRAINT} "
        "UNIQUE (schedule_id, window_start)"
    )


def downgrade() -> None:
    # Local development only.
    op.execute(f"ALTER TABLE ops.collection_runs DROP CONSTRAINT {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE ops.collection_runs ADD CONSTRAINT {_CONSTRAINT} "
        "UNIQUE NULLS NOT DISTINCT (schedule_id, window_start)"
    )
