"""Internal links: a page that names another crawled page as its canonical is a variant.

`crawl_pages.variant_of_url_id` holds the canonical page a variant folds into (null for a page
that counts); `crawl_runs.pages_variant` is how many a crawl has. A link to a variant is
re-pointed at the canonical page and remembers its first target in `crawl_links.folded_from_url_id`;
a link from a variant, or one that the fold turned into a link from a page to itself, is
`ignored`. All of it is set when the crawl's metrics are computed, and can be undone and done
again. Null `pages_variant` means "not counted": crawls finished before this revision, until
their counters are recomputed (operator step, see plan 09). The worker may update these columns
and a link's target, as it already writes the rest of the crawl. Nothing is backfilled here.

Revision ID: 0037
Revises: 0036
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE seo.crawl_pages ADD COLUMN variant_of_url_id bigint REFERENCES core.urls(id)"
    )
    op.execute("ALTER TABLE seo.crawl_runs ADD COLUMN pages_variant integer")
    op.execute(
        "ALTER TABLE seo.crawl_links ADD COLUMN folded_from_url_id bigint, "
        "ADD COLUMN ignored boolean NOT NULL DEFAULT false"
    )
    op.execute(
        column_grant(
            "seo.crawl_pages",
            role="app_worker",
            privilege="UPDATE",
            columns=("variant_of_url_id",),
        )
    )
    op.execute(
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=("pages_variant",)
        )
    )
    op.execute(
        column_grant(
            "seo.crawl_links",
            role="app_worker",
            privilege="UPDATE",
            columns=("target_url_id", "folded_from_url_id", "ignored"),
        )
    )


def downgrade() -> None:
    # Local development only: the columns and their grants go together.
    op.execute("ALTER TABLE seo.crawl_pages DROP COLUMN variant_of_url_id")
    op.execute("ALTER TABLE seo.crawl_runs DROP COLUMN pages_variant")
    op.execute("ALTER TABLE seo.crawl_links DROP COLUMN folded_from_url_id, DROP COLUMN ignored")
