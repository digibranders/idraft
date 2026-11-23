"""The API records the cost of a screenshot it captured.

A person asks for the screenshot of an AI answer in the API, which makes the provider call and
pays for it, so the API (and not only the worker) writes the cost event. It may add events and
read them, as the worker does, and never change or delete one.

Revision ID: 0032
Revises: 0031
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import grants

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    for statement in grants("ops.provider_cost_events", api="INSERT"):
        op.execute(statement)


def downgrade() -> None:
    op.execute("REVOKE INSERT ON ops.provider_cost_events FROM app_api")
