"""The worker may take a term from a tracked keyword it brings back.

An import that brings back a deleted tracked keyword files its terms as the API does: where a
vocabulary became single-valued while the keyword was deleted, the keyword keeps its first term
in path order and the others are taken away. Migration 0011 gave the worker only SELECT and
INSERT on the links, so that DELETE was refused and the import could not go on.

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("GRANT DELETE ON seo.tracked_keyword_terms TO app_worker")


def downgrade() -> None:
    op.execute("REVOKE DELETE ON seo.tracked_keyword_terms FROM app_worker")
