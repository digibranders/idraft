"""Internal links: a crawl records how many pages refused the crawler (plan 08 task 2).

Pages that answered 401, 403 or 429 are unknown, not broken, and the screens say how much of the
site the crawl could read. The number is stored when the crawl is finished, so a list of crawls
does not count pages. Null means "not counted": crawls finished before this migration, until
their counters are recomputed. The worker may update the column, as for the other counts.

Revision ID: 0030
Revises: 0029
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE seo.crawl_runs ADD COLUMN pages_blocked integer")
    op.execute(
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=("pages_blocked",)
        )
    )


def downgrade() -> None:
    # Local development only: the column and its grant go together.
    op.execute("ALTER TABLE seo.crawl_runs DROP COLUMN pages_blocked")
