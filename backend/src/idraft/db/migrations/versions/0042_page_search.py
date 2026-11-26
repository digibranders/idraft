"""Page search detail and Monitoring: position per page and day, address forms, page fetches,
breakdowns and tracked pages.

- `fp.gsc_page_daily` gains `position_sum`, so a page's average position can be read back.
- `fp.gsc_page_forms` keeps the address strings Search Console used for a page, for its page filter.
- `fp.gsc_page_fetches` marks what one page's history and breakdown reads already stored.
- `fp.gsc_page_breakdown` holds a page's top queries, countries and devices for one period.
- `core.tracked_pages` lists the pages a project watches in Monitoring.

Revision ID: 0042
Revises: 0041
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import grants, statements, tenant_isolation

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE fp.gsc_page_forms (
    integration_id uuid NOT NULL,
    url_id         bigint NOT NULL REFERENCES core.urls(id),
    page           text NOT NULL,  -- the address exactly as Search Console returned it
    workspace_id   uuid NOT NULL,
    last_seen      date NOT NULL,
    PRIMARY KEY (integration_id, url_id, page),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE fp.gsc_page_fetches (
    integration_id uuid NOT NULL,
    url_id         bigint NOT NULL REFERENCES core.urls(id),
    kind           text NOT NULL CHECK (kind IN ('history','query','country','device')),
    date_from      date NOT NULL,
    date_to        date NOT NULL,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    row_count      integer NOT NULL,
    truncated      boolean NOT NULL DEFAULT false,  -- the call returned its row limit
    fetched_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, url_id, kind, date_from, date_to),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE fp.gsc_page_breakdown (
    integration_id uuid NOT NULL,
    url_id         bigint NOT NULL REFERENCES core.urls(id),
    date_from      date NOT NULL,
    date_to        date NOT NULL,
    dimension      text NOT NULL CHECK (dimension IN ('query','country','device')),
    key            text NOT NULL,  -- query text, ISO alpha-3 country, or DESKTOP, MOBILE, TABLET
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    clicks         integer NOT NULL,
    impressions    integer NOT NULL,
    position_sum   numeric(14,2) NOT NULL,
    PRIMARY KEY (integration_id, url_id, date_from, date_to, dimension, key),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE core.tracked_pages (
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    workspace_id uuid NOT NULL,
    added_by     uuid REFERENCES auth.users(id),
    added_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX tracked_pages_workspace ON core.tracked_pages (workspace_id, project_id);
"""


def upgrade() -> None:
    # Null on rows stored before this revision: position x impressions of the day.
    op.execute("ALTER TABLE fp.gsc_page_daily ADD COLUMN position_sum numeric(14,2)")
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in (
        "fp.gsc_page_forms",
        "fp.gsc_page_fetches",
        "fp.gsc_page_breakdown",
        "core.tracked_pages",
    ):
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("fp.gsc_page_daily", api="INSERT, UPDATE", worker="UPDATE"),
        *grants("fp.gsc_page_forms", api="SELECT", worker="SELECT, INSERT, UPDATE"),
        *grants(
            "fp.gsc_page_fetches", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"
        ),
        *grants(
            "fp.gsc_page_breakdown", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"
        ),
        *grants("core.tracked_pages", api="SELECT, INSERT, DELETE", worker="SELECT"),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DROP TABLE core.tracked_pages, fp.gsc_page_breakdown, fp.gsc_page_fetches, "
        "fp.gsc_page_forms"
    )
    op.execute("ALTER TABLE fp.gsc_page_daily DROP COLUMN position_sum")
