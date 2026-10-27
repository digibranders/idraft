"""An index for the dispatcher, and a budget that blocked a run can be deleted.

The dispatcher asks every 15 seconds for the oldest due tasks of each project. The only index
that served it was `(status, next_attempt_at)`, which made every such query read all pending
tasks and sort them. The new index holds exactly the tasks waiting to be sent, in the order
they are taken.

`ops.collection_runs.blocked_by_budget_id` referred to the budget with no action on delete, so
a budget that had ever blocked or held a run could not be deleted. The run now forgets the
budget instead; its status and reason still say what happened.

Revision ID: 0008
Revises: 0007
"""

from __future__ import annotations

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_FOREIGN_KEY = "collection_runs_blocked_by_budget_id_fkey"
_REFERENCE = "FOREIGN KEY (blocked_by_budget_id) REFERENCES ops.budgets(id)"


def upgrade() -> None:
    op.execute(
        "CREATE INDEX collection_tasks_waiting ON ops.collection_tasks "
        "(project_id, scheduled_for, id) WHERE status = 'pending' AND dispatched_at IS NULL"
    )
    op.execute(f"ALTER TABLE ops.collection_runs DROP CONSTRAINT {_FOREIGN_KEY}")
    op.execute(
        f"ALTER TABLE ops.collection_runs ADD CONSTRAINT {_FOREIGN_KEY} "
        f"{_REFERENCE} ON DELETE SET NULL"
    )


def downgrade() -> None:
    # Local development only.
    op.execute(f"ALTER TABLE ops.collection_runs DROP CONSTRAINT {_FOREIGN_KEY}")
    op.execute(f"ALTER TABLE ops.collection_runs ADD CONSTRAINT {_FOREIGN_KEY} {_REFERENCE}")
    op.execute("DROP INDEX ops.collection_tasks_waiting")
