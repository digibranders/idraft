"""Internal links: a crawl records when it last read a new page (plan 08, the stall rule).

The worker stops a crawl that read no new page for a while (or ran too long) and ingests the
pages it has. It needs the time of the last progress; null means no progress was seen yet, and
the crawl's start stands in. The worker may update the column, as for the other crawl counts.

Revision ID: 0032
Revises: 0031
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE seo.crawl_runs ADD COLUMN progress_at timestamptz")
    op.execute(
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=("progress_at",)
        )
    )


def downgrade() -> None:
    # Local development only: the column and its grant go together.
    op.execute("ALTER TABLE seo.crawl_runs DROP COLUMN progress_at")
