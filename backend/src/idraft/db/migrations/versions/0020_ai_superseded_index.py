"""AI answers: a partial index for the superseded ones.

The prompts summary leaves out the answers a newer one has replaced (`superseded_by` is set), as
an anti join against the superseded answers of the window. Few answers are ever superseded, but
without an index the planner reads every answer of the project in the window's partitions to
find them, and reads it as a nested loop over every fact while the partitions have no
statistics yet (the first days of a month). This index holds only the superseded answers, so
that lookup is a small range scan.

It is created on the partitioned parent: every partition has one, and a partition made later
(`CREATE TABLE ... PARTITION OF`, as `ops.ensure_monthly_partitions` does) inherits it.

Revision ID: 0020
Revises: 0019
"""

from __future__ import annotations

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX observations_superseded_idx ON ai.observations (project_id, observed_date) "
        "WHERE superseded_by IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX ai.observations_superseded_idx")
