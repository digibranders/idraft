"""AI entity mentions: the order may be empty.

`ai.entity_mentions.mention_order` numbers the accepted mentions of the project's own and
competitor entities in the order the answer names them. Uncertain mentions, watch entities and
products counted as their brand have no place in that order, and extraction keeps them as
evidence (doc 13 principle 4; the answer viewer shows them), so the column stops being
NOT NULL. The partitions follow the parent.

The downgrade deletes the mentions without an order, then restores NOT NULL (local development
only, as for 0018).

Revision ID: 0019
Revises: 0018
"""

from __future__ import annotations

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE ai.entity_mentions ALTER COLUMN mention_order DROP NOT NULL")


def downgrade() -> None:
    op.execute("DELETE FROM ai.entity_mentions WHERE mention_order IS NULL")
    op.execute("ALTER TABLE ai.entity_mentions ALTER COLUMN mention_order SET NOT NULL")
