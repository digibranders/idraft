"""AI citations: the passage the provider quoted from the source.

`ai.citations.quote` holds the text the engine gave with a cited source (Gemini's `snippet`, AI
Mode's reference `text`), whitespace collapsed and at most 1,000 characters. It is null when the
engine gave none and for every row stored before this revision. The column has no default and no
constraint, so this is a catalog change with no table rewrite; the partitioned parent carries it
to every partition. Table-level grants (the worker inserts, the API reads) already cover it.

The downgrade drops the column and what it holds (local development only, as for 0018).

Revision ID: 0024
Revises: 0023
"""

from __future__ import annotations

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE ai.citations ADD COLUMN quote text")


def downgrade() -> None:
    op.execute("ALTER TABLE ai.citations DROP COLUMN quote")
