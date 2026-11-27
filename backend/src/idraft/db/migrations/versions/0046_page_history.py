"""Page history: what a page said in each crawl, and when Google last read it.

docs/superpowers/specs/2026-11-27-page-history-design.md sections 3 and 6.

- `seo.page_checks` is one light row per page and crawl: content hashes, the declared date and the
  snapshot that holds this crawl's content. It goes with its crawl run.
- `seo.page_snapshots` is kept only when a page's main content changed. It has no key to the crawl
  run, so a snapshot outlives the run that first saw it (it is removed with the project).
- `seo.page_history_runs` is the per-crawl summary (site-wide change, unreliable declared dates).
- `seo.page_google_crawl` is Google's last crawl time of a page, from URL inspection.
- `seo.crawl_pages.sitemap_lastmod` is the provider's sitemap `lastmod` of the page.

Revision ID: 0046
Revises: 0045
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import grants, statements, tenant_isolation

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
ALTER TABLE seo.crawl_pages ADD COLUMN sitemap_lastmod timestamptz;

CREATE TABLE seo.page_snapshots (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    url_id          bigint NOT NULL REFERENCES core.urls(id),
    -- The crawl that first saw this content. No key: the snapshot outlives the run.
    run_id          uuid NOT NULL,
    taken_at        timestamptz NOT NULL,
    title           text,
    description     text,
    headings        jsonb NOT NULL DEFAULT '[]',
    words           integer NOT NULL,
    links_all       integer NOT NULL,
    links_editorial integer NOT NULL,
    canonical       text,
    main_hash       bytea NOT NULL,
    full_hash       bytea NOT NULL,
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX page_snapshots_page_taken ON seo.page_snapshots (project_id, url_id, taken_at DESC);

CREATE TABLE seo.page_checks (
    run_id          uuid NOT NULL,
    url_id          bigint NOT NULL REFERENCES core.urls(id),
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    main_hash       bytea NOT NULL,
    full_hash       bytea NOT NULL,
    declared_at     timestamptz,
    declared_source text CHECK (declared_source IN
                    ('json_ld','meta_modified','og_updated','sitemap')),
    snapshot_id     bigint,
    PRIMARY KEY (run_id, url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, workspace_id) REFERENCES seo.page_snapshots(id, workspace_id)
);

-- The previous check of a page (ingest) and its history (endpoint); run ids are UUIDv7.
CREATE INDEX page_checks_page ON seo.page_checks (project_id, url_id, run_id DESC);

CREATE INDEX page_checks_snapshot ON seo.page_checks (snapshot_id, workspace_id)
    WHERE snapshot_id IS NOT NULL;

-- The oldest crawl that held a page (history endpoint, first_seen).
CREATE INDEX crawl_pages_url ON seo.crawl_pages (project_id, url_id);

CREATE TABLE seo.page_history_runs (
    run_id              uuid PRIMARY KEY,
    workspace_id        uuid NOT NULL,
    pages_checked       integer NOT NULL,
    pages_main_changed  integer NOT NULL,
    pages_site_wide     integer NOT NULL,
    site_wide           boolean NOT NULL,
    declared_unreliable boolean NOT NULL,
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.page_google_crawl (
    project_id      uuid NOT NULL,
    url_id          bigint NOT NULL REFERENCES core.urls(id),
    workspace_id    uuid NOT NULL,
    last_crawl_time timestamptz,
    coverage_state  text,
    inspected_at    timestamptz NOT NULL,
    PRIMARY KEY (project_id, url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);
"""

_TENANT_TABLES = (
    "seo.page_snapshots",
    "seo.page_checks",
    "seo.page_history_runs",
    "seo.page_google_crawl",
)


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("seo.page_snapshots", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.page_checks", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.page_history_runs", api="SELECT", worker="SELECT, INSERT, UPDATE"),
        *grants("seo.page_google_crawl", api="SELECT", worker="SELECT, INSERT, UPDATE"),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DROP TABLE seo.page_google_crawl, seo.page_history_runs, seo.page_checks, "
        "seo.page_snapshots"
    )
    op.execute("ALTER TABLE seo.crawl_pages DROP COLUMN sitemap_lastmod")
