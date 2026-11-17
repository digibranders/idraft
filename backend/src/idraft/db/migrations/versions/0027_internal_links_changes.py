"""Internal link tracker, slices 2 and 3: what changed between crawls, the alert record,
mentions for link opportunities, the people's decisions and Search Console page totals.

Plan `docs/superpowers/plans/2026-11-17-internal-links-04-backend-slices-2-3.md`, decisions D1
to D13:

- `seo.crawl_runs` gets the diff's base (`previous_run_id`) and the state of its second job,
  `crawl_enrich` (D1). The crawl is usable while that job is `pending`.
- Changes are stored per run because link partitions are dropped past the last four crawls
  (D2). Only the pairs that were lost or added, and only the pages that moved, have rows.
- Mentions are per run; decisions belong to the project (D12, D13).
- `fp.gsc_page_daily` holds clicks and impressions per page and day, because the Search Console
  pull has no page dimension (D10).

Revision ID: 0027
Revises: 0026
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
ALTER TABLE seo.crawl_runs
    ADD COLUMN previous_run_id uuid,
    ADD COLUMN enrich_state text NOT NULL DEFAULT 'pending'
        CHECK (enrich_state IN ('pending','running','done','failed')),
    ADD COLUMN enrich_phase text CHECK (enrich_phase IN ('changes','anchors','mentions','done')),
    ADD COLUMN enrich_failures smallint NOT NULL DEFAULT 0,
    ADD COLUMN enrich_offset bigint NOT NULL DEFAULT 0;  -- the last URL id the mention phase read

CREATE INDEX crawl_runs_enriching ON seo.crawl_runs (state, created_at)
    WHERE enrich_state IN ('pending','running');

ALTER TABLE seo.crawl_pages
    ADD COLUMN editorial_anchors integer NOT NULL DEFAULT 0,
    ADD COLUMN generic_anchors integer NOT NULL DEFAULT 0;

CREATE TABLE seo.crawl_link_changes (
    run_id          uuid NOT NULL,
    workspace_id    uuid NOT NULL,
    change          text NOT NULL CHECK (change IN ('lost','added')),
    scope           text NOT NULL CHECK (scope IN ('editorial','all')),
    source_url_id   bigint NOT NULL,
    target_url_id   bigint NOT NULL,
    placement       text NOT NULL,
    anchor          text NOT NULL DEFAULT '' CHECK (length(anchor) <= 500),
    still_linked_by text,
    PRIMARY KEY (run_id, change, scope, source_url_id, target_url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX crawl_link_changes_target ON seo.crawl_link_changes
    (run_id, change, scope, target_url_id);

CREATE TABLE seo.crawl_page_changes (
    run_id             uuid NOT NULL,
    workspace_id       uuid NOT NULL,
    url_id             bigint NOT NULL,
    is_new             boolean NOT NULL,
    editorial_in_delta integer,
    equity_points      double precision,
    depth_state        text CHECK (depth_state IN ('lost','found')),
    depth_delta        integer,
    PRIMARY KEY (run_id, url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.crawl_alerts (
    run_id         uuid PRIMARY KEY,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    lost_links     integer NOT NULL CHECK (lost_links >= 0),
    max_position   smallint NOT NULL CHECK (max_position BETWEEN 1 AND 8),
    threshold      smallint NOT NULL CHECK (threshold BETWEEN 1 AND 50),
    channel        text NOT NULL CHECK (channel IN ('app','email','slack')),
    delivery_state text NOT NULL CHECK (delivery_state IN ('shown_in_app','channel_unavailable')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.crawl_mentions (
    run_id        uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    source_url_id bigint NOT NULL,
    target_url_id bigint NOT NULL,
    phrase        text NOT NULL CHECK (length(phrase) BETWEEN 3 AND 200),
    context       text NOT NULL CHECK (length(context) <= 400),
    origin        text NOT NULL CHECK (origin IN ('keyword','anchor')),
    PRIMARY KEY (run_id, source_url_id, target_url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX crawl_mentions_target ON seo.crawl_mentions (run_id, target_url_id);

CREATE TABLE core.link_opportunity_decisions (
    project_id    uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    source_url_id bigint NOT NULL,
    target_url_id bigint NOT NULL,
    status        text NOT NULL CHECK (status IN ('accepted','dismissed')),
    decided_by    uuid REFERENCES auth.users(id),
    decided_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, source_url_id, target_url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE core.tier_suggestion_dismissals (
    project_id   uuid NOT NULL,
    workspace_id uuid NOT NULL,
    url_id       bigint NOT NULL,
    dismissed_by uuid REFERENCES auth.users(id),
    dismissed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE fp.gsc_page_daily (
    integration_id uuid NOT NULL,
    metric_date    date NOT NULL,
    url_id         bigint NOT NULL,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    clicks         integer NOT NULL CHECK (clicks >= 0),
    impressions    integer NOT NULL CHECK (impressions >= 0),
    ingested_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, metric_date, url_id),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX gsc_page_daily_project_url ON fp.gsc_page_daily (project_id, url_id, metric_date);
"""

_TENANT_TABLES = (
    "seo.crawl_link_changes",
    "seo.crawl_page_changes",
    "seo.crawl_alerts",
    "seo.crawl_mentions",
    "core.link_opportunity_decisions",
    "core.tier_suggestion_dismissals",
    "fp.gsc_page_daily",
)
_ENRICH_COLUMNS = (
    "previous_run_id",
    "enrich_state",
    "enrich_phase",
    "enrich_failures",
    "enrich_offset",
)


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("seo.crawl_link_changes", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_page_changes", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_alerts", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_mentions", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *grants("core.link_opportunity_decisions", api="SELECT, INSERT, DELETE"),
        column_grant(
            "core.link_opportunity_decisions",
            role="app_api",
            privilege="UPDATE",
            columns=("status", "decided_by", "decided_at"),
        ),
        *grants("core.tier_suggestion_dismissals", api="SELECT, INSERT, DELETE"),
        *grants("fp.gsc_page_daily", api="SELECT", worker="SELECT, INSERT, DELETE"),
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=_ENRICH_COLUMNS
        ),
        column_grant(
            "seo.crawl_pages",
            role="app_worker",
            privilege="UPDATE",
            columns=("editorial_anchors", "generic_anchors"),
        ),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DROP TABLE fp.gsc_page_daily, core.tier_suggestion_dismissals, "
        "core.link_opportunity_decisions, seo.crawl_mentions, seo.crawl_alerts, "
        "seo.crawl_page_changes, seo.crawl_link_changes"
    )
    op.execute(
        "ALTER TABLE seo.crawl_pages DROP COLUMN editorial_anchors, DROP COLUMN generic_anchors"
    )
    op.execute("DROP INDEX seo.crawl_runs_enriching")
    op.execute(
        "ALTER TABLE seo.crawl_runs DROP COLUMN previous_run_id, DROP COLUMN enrich_state, "
        "DROP COLUMN enrich_phase, DROP COLUMN enrich_failures, DROP COLUMN enrich_offset"
    )
