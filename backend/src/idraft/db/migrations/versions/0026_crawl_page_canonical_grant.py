"""Internal links: the worker may set the canonical of a crawled page.

Migration 0025 let the worker insert a page with the canonical the provider gave and update the
columns ingest computes. A real crawl showed the provider's page payload carries no canonical,
while the page's own HTML does: ingest now reads it when it reads the HTML, which is after the
page row is written, so the worker needs UPDATE on `canonical_url_id` of `seo.crawl_pages`. The
grant is the whole change: one column, one role, no data change. Row-level security is untouched.

The downgrade revokes the column grant (local development only, as for 0023).

Revision ID: 0026
Revises: 0025
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        column_grant(
            "seo.crawl_pages", role="app_worker", privilege="UPDATE", columns=("canonical_url_id",)
        )
    )


def downgrade() -> None:
    op.execute("REVOKE UPDATE (canonical_url_id) ON seo.crawl_pages FROM app_worker")
