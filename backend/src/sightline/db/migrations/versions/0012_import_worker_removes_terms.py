"""What the import worker needs beyond migration 0011.

The worker may take a term from a tracked keyword it brings back. An import that brings back a
deleted tracked keyword files its terms as the API does: where a vocabulary became
single-valued while the keyword was deleted, the keyword keeps its first term in path order and
the others are taken away. Migration 0011 gave the worker only SELECT and INSERT on the links,
so that DELETE was refused and the import could not go on.

Two partial indexes serve the worker's claims on `seo.keyword_imports`, which is never purged:
the next import to read or to write (oldest first among those waiting), and the sweep that
ends previews nobody confirmed. Without them each tick, every 5 seconds, reads the whole table.

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
    op.execute(
        "CREATE INDEX keyword_imports_to_work ON seo.keyword_imports (created_at, id) "
        "WHERE status IN ('uploaded', 'writing')"
    )
    op.execute(
        "CREATE INDEX keyword_imports_to_expire ON seo.keyword_imports (expires_at) "
        "WHERE status IN ('uploaded', 'needs_mapping', 'preview_ready')"
    )


def downgrade() -> None:
    op.execute("DROP INDEX seo.keyword_imports_to_expire, seo.keyword_imports_to_work")
    op.execute("REVOKE DELETE ON seo.tracked_keyword_terms FROM app_worker")
