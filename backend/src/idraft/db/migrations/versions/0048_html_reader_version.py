"""Internal links: which reader read a crawl's HTML, and a check of each page's links.

`seo.crawl_runs.html_reader_version` is the oldest version of the code that reads HTML
(`crawl.integrity.HTML_READER_VERSION`) that read a page of the crawl; null means it was read
before the version existed (version 1). `pages_links_suspect` counts the pages whose HTML holds
many more links than were read from it. On `seo.crawl_pages`, `html_anchors` and `links_read` are
the two numbers compared and `links_suspect` the verdict; all three are null until the page is
checked, and null never means fine. The worker may update each column. Nothing is backfilled.

Revision ID: 0048
Revises: 0047
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_RUN_COLUMNS = (("html_reader_version", "smallint"), ("pages_links_suspect", "integer"))
_PAGE_COLUMNS = (
    ("html_anchors", "smallint"),
    ("links_read", "smallint"),
    ("links_suspect", "boolean"),
)


def _add(table: str, columns: tuple[tuple[str, str], ...]) -> None:
    adds = ", ".join(f"ADD COLUMN {name} {kind}" for name, kind in columns)
    op.execute(f"ALTER TABLE {table} {adds}")
    op.execute(
        column_grant(
            table, role="app_worker", privilege="UPDATE", columns=tuple(n for n, _ in columns)
        )
    )


def upgrade() -> None:
    _add("seo.crawl_runs", _RUN_COLUMNS)
    _add("seo.crawl_pages", _PAGE_COLUMNS)


def downgrade() -> None:
    # Local development only: the columns and their grants go together.
    for table, columns in (("seo.crawl_runs", _RUN_COLUMNS), ("seo.crawl_pages", _PAGE_COLUMNS)):
        drops = ", ".join(f"DROP COLUMN {name}" for name, _ in columns)
        op.execute(f"ALTER TABLE {table} {drops}")
