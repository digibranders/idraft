"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""

from __future__ import annotations

from alembic import op

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | tuple[str, ...] | None = ${repr(branch_labels)}
depends_on: str | tuple[str, ...] | None = ${repr(depends_on)}


def upgrade() -> None:
    op.execute("")


def downgrade() -> None:
    op.execute("")
