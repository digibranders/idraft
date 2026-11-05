"""An index to read one query's Search Console days.

The Rankings columns sum a tracked keyword's clicks over 28 days (docs/18 section 4.9): the
keyword's text names its queries, and those queries name rows. The primary key of
`fp.gsc_search_analytics` starts with the integration and the date, so a lookup by query would
read every row of the 28 days. This index goes straight to one query's rows by date. A partitioned
table passes it to every month, including the ones made later.

Revision ID: 0016
Revises: 0015
"""

from __future__ import annotations

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX gsc_search_analytics_query "
        "ON fp.gsc_search_analytics (query_hash, metric_date)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX fp.gsc_search_analytics_query")
