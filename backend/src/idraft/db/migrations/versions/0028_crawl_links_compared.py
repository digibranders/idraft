"""Internal links: a crawl records whether its link diff ran.

`crawl_enrich` skips the link diff when either crawl's links were dropped by retention, so a
change summary with no lost links could mean "nothing was lost" or "nothing was compared". The
flag says which. Existing crawls get `false`: their rows are not re-derived, and a reader that
sees `false` with zero counts shows the comparison as unavailable. The worker may update the
column, as for the other enrichment columns of 0027.

Revision ID: 0028
Revises: 0027
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE seo.crawl_runs ADD COLUMN links_compared boolean NOT NULL DEFAULT false"
    )
    op.execute(
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=("links_compared",)
        )
    )


def downgrade() -> None:
    # Local development only: the column and its grant go together.
    op.execute("ALTER TABLE seo.crawl_runs DROP COLUMN links_compared")
