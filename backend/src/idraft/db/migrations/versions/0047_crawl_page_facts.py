"""Issues: what a crawled page's HTML says, and how long the page took to answer.

`seo.crawl_pages` gets the facts the HTML checks of the Issues page read: the meta description,
the number of H1 headings, the words and a hash of the text, images without `alt`, Open Graph
completeness, broken JSON-LD blocks, language link problems and resources loaded over http, and
the provider's response time. All are null until the page's HTML is read; `facts_read` says it was.
The worker may update each column, as it already writes the rest of the crawl. Nothing is
backfilled here: the `crawl_facts` worker command fills a crawl that is already stored.

Rechain to the head of the integration branch (0046) when merged; two heads until then.

Revision ID: 0047
Revises: 0041
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0047"
down_revision: str | None = "0041"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_COLUMNS = (
    ("facts_read", "boolean NOT NULL DEFAULT false"),
    ("meta_description", "text"),
    ("h1_count", "smallint"),
    ("word_count", "integer"),
    ("text_hash", "bigint"),
    ("images_without_alt", "smallint"),
    ("og_complete", "boolean"),
    ("jsonld_errors", "smallint"),
    ("hreflang_errors", "smallint"),
    ("http_resources", "smallint"),
    ("response_ms", "integer"),
)


def upgrade() -> None:
    adds = ", ".join(f"ADD COLUMN {name} {kind}" for name, kind in _COLUMNS)
    op.execute(f"ALTER TABLE seo.crawl_pages {adds}")
    op.execute(
        column_grant(
            "seo.crawl_pages",
            role="app_worker",
            privilege="UPDATE",
            columns=tuple(name for name, _ in _COLUMNS),
        )
    )


def downgrade() -> None:
    # Local development only: the columns and their grants go together.
    drops = ", ".join(f"DROP COLUMN {name}" for name, _ in _COLUMNS)
    op.execute(f"ALTER TABLE seo.crawl_pages {drops}")
