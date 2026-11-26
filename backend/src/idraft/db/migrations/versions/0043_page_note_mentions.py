"""Mentions on a page note (Pages spec 9.8.1, decision D17).

A note's mentions are a small list that is only read with the note, so they are one column and not
a table. Each entry is `{type, label, target}`; the API checks the targets before it writes the
list and the table only caps its size. The API role may update the column, as it may `body`.

Revision ID: 0043
Revises: 0042
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.page_notes
            ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'
            CHECK (jsonb_typeof(mentions) = 'array' AND jsonb_array_length(mentions) <= 20)
        """
    )
    op.execute(
        column_grant("core.page_notes", role="app_api", privilege="UPDATE", columns=("mentions",))
    )


def downgrade() -> None:
    # Local development only: the mentions are lost.
    op.execute("ALTER TABLE core.page_notes DROP COLUMN mentions")
