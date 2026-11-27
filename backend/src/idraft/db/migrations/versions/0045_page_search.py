"""Page search detail and Monitoring: position per page and day, address forms, page fetches,
breakdowns and tracked pages.

- `fp.gsc_page_daily` gains `position_sum`, so a page's average position can be read back.
- `fp.gsc_page_forms` keeps the address strings Search Console used for a page, for its page filter.
- `fp.gsc_page_fetches` marks what one page's history and breakdown reads already stored, and
  holds the number of queries of a page in a period.
- `fp.gsc_page_breakdown` holds a page's top queries, countries and devices for one period.
- `core.tracked_pages` lists the pages a project watches in Monitoring.

Revision ID: 0045
Revises: 0044
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import API_ROLE, WORKER_ROLE, grants, statements, tenant_isolation

revision: str = "0045"
down_revision: str | None = "0044"
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
    row_count      integer NOT NULL CHECK (row_count >= 0),  -- rows stored
    truncated      boolean NOT NULL DEFAULT false,  -- more rows came back than were stored
    query_count    integer,  -- kind 'query' only: rows Google returned, the page's queries
    query_count_capped boolean NOT NULL DEFAULT false,  -- 25,000 rows came back: a lower bound
    fetched_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, url_id, kind, date_from, date_to),
    CHECK (date_from <= date_to),
    CHECK ((kind = 'query') = (query_count IS NOT NULL)),
    CHECK (query_count IS NULL OR query_count >= 0),
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
    clicks         integer NOT NULL CHECK (clicks >= 0),
    impressions    integer NOT NULL CHECK (impressions >= 0),
    position_sum   numeric(14,2) NOT NULL,
    PRIMARY KEY (integration_id, url_id, date_from, date_to, dimension, key),
    CHECK (date_from <= date_to),
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
        # UPDATE: the stores write with INSERT ... ON CONFLICT DO UPDATE.
        *grants(
            "fp.gsc_page_fetches",
            api="SELECT, INSERT, UPDATE, DELETE",
            worker="SELECT, INSERT, UPDATE, DELETE",
        ),
        *grants(
            "fp.gsc_page_breakdown",
            api="SELECT, INSERT, UPDATE, DELETE",
            worker="SELECT, INSERT, UPDATE, DELETE",
        ),
        *grants("core.tracked_pages", api="SELECT, INSERT, DELETE", worker="SELECT"),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(f"REVOKE INSERT, UPDATE ON fp.gsc_page_daily FROM {API_ROLE}")
    op.execute(f"REVOKE UPDATE ON fp.gsc_page_daily FROM {WORKER_ROLE}")
    op.execute(
        "DROP TABLE core.tracked_pages, fp.gsc_page_breakdown, fp.gsc_page_fetches, "
        "fp.gsc_page_forms"
    )
    op.execute("ALTER TABLE fp.gsc_page_daily DROP COLUMN position_sum")
