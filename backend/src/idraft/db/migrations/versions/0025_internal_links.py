"""Internal link tracker, slice 1: page tiers, tier rules, pages and tags per project, and
crawls with their pages, link edges and tier flow.

Plan `docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md`, decisions D2 to
D17:

- Tier levels belong to the workspace (positions 1 to 8, code and colour from the position);
  every existing workspace gets the four defaults here. The position key is deferrable, so
  deleting a tier closes the gap in one UPDATE.
- A page's tier is one `core.project_pages` row per project and URL: `manual` (a null tier is
  a manual Untiered) or `rule` (with its rule). Tags are terms on `core.page_terms`.
- Crawls are `seo.crawl_runs` with the spec's states; one may be under way per project. Pages
  are kept for every crawl; links are partitioned by crawl so that old crawls are dropped
  whole. The worker has no DDL right, so the partitions are made and dropped by two definer
  functions, as `ops.maintain_partitions` makes monthly ones.
- `site_crawl` joins the cost workloads and budget groups, and the On-Page price joins the
  price book.

Revision ID: 0025
Revises: 0024
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from alembic import op
from sqlalchemy import text

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_PLACEMENTS = "('content','auto_generated','navigation','header','footer','sidebar','breadcrumb')"
_EDGE_SCOPES = "('editorial','auto_generated','template')"

_TABLES = f"""
CREATE TABLE core.page_tier_levels (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
    name         text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 60),
    description  text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT page_tier_levels_id_workspace_id_key UNIQUE (id, workspace_id),
    CONSTRAINT page_tier_levels_position_key UNIQUE (workspace_id, position)
        DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE core.tier_rules (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    position     integer NOT NULL CHECK (position BETWEEN 1 AND 500),
    match_type   text NOT NULL CHECK (match_type IN ('exact','prefix','pattern')),
    value        text NOT NULL CHECK (left(value, 1) = '/' AND length(value) <= 500),
    tier_id      uuid NOT NULL,
    created_by   uuid REFERENCES auth.users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tier_rules_id_workspace_id_key UNIQUE (id, workspace_id),
    CONSTRAINT tier_rules_position_key UNIQUE (project_id, position)
        DEFERRABLE INITIALLY IMMEDIATE,
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (tier_id, workspace_id) REFERENCES core.page_tier_levels(id, workspace_id)
);

CREATE INDEX tier_rules_tier ON core.tier_rules (tier_id);

CREATE TABLE core.project_pages (
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    workspace_id uuid NOT NULL,
    tier_id      uuid,
    tier_source  text NOT NULL CHECK (tier_source IN ('manual','rule')),
    rule_id      uuid,
    set_by       uuid REFERENCES auth.users(id),
    set_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id),
    CONSTRAINT project_pages_source_fits CHECK (
        (tier_source = 'rule' AND rule_id IS NOT NULL AND tier_id IS NOT NULL)
     OR (tier_source = 'manual' AND rule_id IS NULL)),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (tier_id, workspace_id) REFERENCES core.page_tier_levels(id, workspace_id),
    FOREIGN KEY (rule_id, workspace_id) REFERENCES core.tier_rules(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX project_pages_tier ON core.project_pages (workspace_id, tier_id);

CREATE INDEX project_pages_rule ON core.project_pages (rule_id) WHERE rule_id IS NOT NULL;

CREATE TABLE core.page_terms (
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    term_id      uuid NOT NULL,
    workspace_id uuid NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id, term_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (term_id, workspace_id) REFERENCES core.taxonomy_terms(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX page_terms_term ON core.page_terms (term_id);

CREATE TABLE seo.crawl_runs (
    id                    uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    trigger               text NOT NULL
                          CHECK (trigger IN ('website_added','schedule','manual','ceiling_retry')),
    state                 text NOT NULL DEFAULT 'queued'
                          CHECK (state IN ('queued','crawling','processing','ready',
                                           'stopped_at_ceiling','failed','cancelled')),
    target_host           text NOT NULL CHECK (length(target_host) BETWEEN 1 AND 255),
    settings              jsonb NOT NULL,
    ceiling               integer NOT NULL CHECK (ceiling BETWEEN 1 AND 1000000),
    provider_task_id      text,
    pages_found           integer NOT NULL DEFAULT 0,
    pages_crawled         integer NOT NULL DEFAULT 0,
    sitemap_pages         integer,
    estimated_cost_usd    numeric(14,6),
    cost_usd              numeric(14,6),
    stop_reason           text,
    error_code            text,
    error_message         text CHECK (length(error_message) <= 500),
    cancel_requested      boolean NOT NULL DEFAULT false,
    ingest_phase          text CHECK (ingest_phase IN ('pages','non_indexable','links',
                                                       'template','metrics','done')),
    ingest_token          text,
    ingest_offset         integer NOT NULL DEFAULT 0,
    ingest_failures       smallint NOT NULL DEFAULT 0,
    start_url_id          bigint REFERENCES core.urls(id),
    equity_lost_to_errors double precision,
    equity_p25            double precision,
    links_stored          integer NOT NULL DEFAULT 0,
    links_dropped_at      timestamptz,
    tier_flow_stale       boolean NOT NULL DEFAULT false,
    requested_by          uuid REFERENCES auth.users(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    submitted_at          timestamptz,
    crawled_at            timestamptz,
    finished_at           timestamptz,
    CONSTRAINT crawl_runs_id_workspace_id_key UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

-- One crawl under way per project (spec 6.2, "Crawl now").
CREATE UNIQUE INDEX crawl_runs_one_active ON seo.crawl_runs (project_id)
    WHERE state IN ('queued','crawling','processing');

CREATE INDEX crawl_runs_project_created ON seo.crawl_runs (project_id, created_at DESC, id DESC);

CREATE INDEX crawl_runs_working ON seo.crawl_runs (state, created_at)
    WHERE state IN ('queued','crawling','processing');

CREATE TABLE seo.crawl_pages (
    run_id                   uuid NOT NULL,
    url_id                   bigint NOT NULL REFERENCES core.urls(id),
    workspace_id             uuid NOT NULL,
    project_id               uuid NOT NULL,
    -- The URL as the provider crawled it: raw HTML and links are asked for by this one.
    crawled_url              text NOT NULL CHECK (length(crawled_url) BETWEEN 1 AND 8192),
    status_code              smallint,
    resource_type            text NOT NULL
                             CHECK (resource_type IN ('html','redirect','broken','other')),
    redirect_url_id          bigint REFERENCES core.urls(id),
    is_indexable             boolean NOT NULL DEFAULT true,
    non_indexable_reason     text CHECK (non_indexable_reason IN
                             ('robots_txt','meta_tag','http_header','attribute',
                              'too_many_redirects','canonical')),
    canonical_url_id         bigint REFERENCES core.urls(id),
    title                    text CHECK (length(title) <= 1000),
    in_sitemap               boolean NOT NULL DEFAULT false,
    links_state              text NOT NULL DEFAULT 'waiting'
                             CHECK (links_state IN ('waiting','from_html','from_provider','none')),
    click_depth              integer,
    depth_without_auto       integer,
    equity_share             double precision,
    linking_pages_editorial  integer NOT NULL DEFAULT 0,
    linking_pages_auto       integer NOT NULL DEFAULT 0,
    linking_pages_template   integer NOT NULL DEFAULT 0,
    linking_pages_all        integer NOT NULL DEFAULT 0,
    outlinks_editorial       integer NOT NULL DEFAULT 0,
    outlinks_auto            integer NOT NULL DEFAULT 0,
    outlinks_template        integer NOT NULL DEFAULT 0,
    outlinks_all             integer NOT NULL DEFAULT 0,
    broken_outlinks          integer NOT NULL DEFAULT 0,
    redirect_outlinks        integer NOT NULL DEFAULT 0,
    non_indexable_outlinks   integer NOT NULL DEFAULT 0,
    top_anchor               text,
    is_orphan                boolean NOT NULL DEFAULT false,
    is_editorial_orphan      boolean NOT NULL DEFAULT false,
    deep_only_through_auto   boolean NOT NULL DEFAULT false,
    PRIMARY KEY (run_id, url_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX crawl_pages_links_waiting ON seo.crawl_pages (run_id, url_id)
    WHERE links_state = 'waiting';

CREATE INDEX crawl_pages_run_equity ON seo.crawl_pages (run_id, equity_share DESC, url_id);

CREATE TABLE seo.crawl_links (
    run_id             uuid NOT NULL,
    id                 bigint GENERATED ALWAYS AS IDENTITY,
    workspace_id       uuid NOT NULL,
    source_url_id      bigint NOT NULL,
    target_url_id      bigint NOT NULL,
    anchor             text NOT NULL DEFAULT '' CHECK (length(anchor) <= 500),
    kind               text NOT NULL CHECK (kind IN ('text','image')),
    placement          text NOT NULL CHECK (placement IN {_PLACEMENTS}),
    scope              text NOT NULL CHECK (scope IN {_EDGE_SCOPES}),
    rel                text[] NOT NULL DEFAULT '{{}}',
    is_followed        boolean NOT NULL,
    occurrences        smallint NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
    container_hash     bigint,
    template_candidate boolean NOT NULL DEFAULT false,
    PRIMARY KEY (run_id, id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
) PARTITION BY LIST (run_id);

CREATE INDEX crawl_links_run_source ON seo.crawl_links (run_id, source_url_id, scope);

CREATE INDEX crawl_links_run_target ON seo.crawl_links (run_id, target_url_id, scope);

CREATE TABLE seo.crawl_tier_flow (
    run_id       uuid NOT NULL,
    workspace_id uuid NOT NULL,
    scope        text NOT NULL CHECK (scope IN ('editorial','auto_generated','template','all')),
    from_tier_id uuid,
    to_tier_id   uuid,
    links        integer NOT NULL CHECK (links >= 0),
    CONSTRAINT crawl_tier_flow_cell_key UNIQUE NULLS NOT DISTINCT
        (run_id, scope, from_tier_id, to_tier_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE seo.crawl_tier_stats (
    run_id        uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    tier_id       uuid,
    pages         integer NOT NULL CHECK (pages >= 0),
    equity_share  double precision NOT NULL,
    average_depth double precision,
    CONSTRAINT crawl_tier_stats_tier_key UNIQUE NULLS NOT DISTINCT (run_id, tier_id),
    FOREIGN KEY (run_id, workspace_id) REFERENCES seo.crawl_runs(id, workspace_id)
        ON DELETE CASCADE
);
"""

# The worker cannot create tables. These two make and drop the partition of one crawl, and
# nothing else: the run must exist, and only a partition of seo.crawl_links is dropped.
_PARTITIONS = """
CREATE FUNCTION seo.add_crawl_links_partition(p_run_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '5s'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM seo.crawl_runs WHERE id = p_run_id) THEN
        RAISE EXCEPTION 'no crawl run %', p_run_id;
    END IF;
    EXECUTE format('CREATE TABLE IF NOT EXISTS seo.%I PARTITION OF seo.crawl_links '
                   'FOR VALUES IN (%L)',
                   'crawl_links_' || replace(p_run_id::text, '-', ''), p_run_id);
END $$;

CREATE FUNCTION seo.drop_crawl_links_partition(p_run_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '5s'
AS $$
DECLARE
    part regclass := to_regclass('seo.crawl_links_' || replace(p_run_id::text, '-', ''));
BEGIN
    IF part IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_inherits
        WHERE inhrelid = part AND inhparent = 'seo.crawl_links'::regclass) THEN
        RETURN false;
    END IF;
    EXECUTE format('DROP TABLE %s', part);
    RETURN true;
END $$;

REVOKE ALL ON FUNCTION seo.add_crawl_links_partition(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION seo.drop_crawl_links_partition(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION seo.add_crawl_links_partition(uuid) TO app_worker;

GRANT EXECUTE ON FUNCTION seo.drop_crawl_links_partition(uuid) TO app_worker;
"""

_OLD_COST_WORKLOADS = (
    "'seo_rank','ai_prompt','ai_mode_keyword','keyword_metrics','discovery',"
    "'ai_benchmark','gsc_sync','bing_sync','ga4_sync','cloudflare_sync',"
    "'ai_overview','extraction_llm','keyword_research','first_party'"
)
_OLD_BUDGET_GROUPS = (
    "'seo_rank','ai_prompt','keyword_research','ai_benchmark','extraction_llm','first_party','all'"
)


def _workload_checks(cost: str, groups: str) -> list[str]:
    return [
        "ALTER TABLE ops.provider_cost_events DROP CONSTRAINT provider_cost_events_workload_check",
        "ALTER TABLE ops.provider_cost_events ADD CONSTRAINT provider_cost_events_workload_check "
        f"CHECK (workload IN ({cost}))",
        "ALTER TABLE ops.budgets DROP CONSTRAINT budgets_workload_check",
        "ALTER TABLE ops.budgets ADD CONSTRAINT budgets_workload_check "
        f"CHECK (workload IN ({groups}))",
    ]


_TENANT_TABLES = (
    "core.page_tier_levels",
    "core.tier_rules",
    "core.project_pages",
    "core.page_terms",
    "seo.crawl_runs",
    "seo.crawl_pages",
    "seo.crawl_links",
    "seo.crawl_tier_flow",
    "seo.crawl_tier_stats",
)
_RUN_API_UPDATE = ("state", "cancel_requested", "error_code", "finished_at", "tier_flow_stale")
_RUN_WORKER_UPDATE = (
    "state",
    "provider_task_id",
    "pages_found",
    "pages_crawled",
    "sitemap_pages",
    "estimated_cost_usd",
    "cost_usd",
    "stop_reason",
    "error_code",
    "error_message",
    "ingest_phase",
    "ingest_token",
    "ingest_offset",
    "ingest_failures",
    "start_url_id",
    "equity_lost_to_errors",
    "equity_p25",
    "links_stored",
    "links_dropped_at",
    "tier_flow_stale",
    "submitted_at",
    "crawled_at",
    "finished_at",
)
_PAGE_WORKER_UPDATE = (
    "is_indexable",
    "non_indexable_reason",
    "links_state",
    "click_depth",
    "depth_without_auto",
    "equity_share",
    "linking_pages_editorial",
    "linking_pages_auto",
    "linking_pages_template",
    "linking_pages_all",
    "outlinks_editorial",
    "outlinks_auto",
    "outlinks_template",
    "outlinks_all",
    "broken_outlinks",
    "redirect_outlinks",
    "non_indexable_outlinks",
    "top_anchor",
    "is_orphan",
    "is_editorial_orphan",
    "deep_only_through_auto",
)
_DEFAULT_TIERS = (
    (1, "Money pages", "Pages that bring revenue: products, services, pricing."),
    (2, "Supporting pages", "Pages that lead to the money pages: categories, comparisons."),
    (3, "Content pages", "Articles and guides that earn visits and links."),
    (4, "Utility pages", "About, contact, legal and account pages."),
)
# Spec 6.1, verified on the pricing page on 2026-11-16: per page crawled, ten times with
# JavaScript rendering.
_CRAWL_PRICES = (
    (Decimal("0.00015"), '{"javascript": false}'),
    (Decimal("0.0015"), '{"javascript": true}'),
)


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("core.page_tier_levels", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "core.page_tier_levels",
            role="app_api",
            privilege="UPDATE",
            columns=("position", "name", "description", "updated_at"),
        ),
        *grants("core.tier_rules", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "core.tier_rules",
            role="app_api",
            privilege="UPDATE",
            columns=("position", "match_type", "value", "tier_id"),
        ),
        *grants(
            "core.project_pages",
            api="SELECT, INSERT, DELETE",
            worker="SELECT, INSERT, DELETE",
        ),
        column_grant(
            "core.project_pages",
            role="app_api",
            privilege="UPDATE",
            columns=("tier_id", "tier_source", "rule_id", "set_by", "set_at"),
        ),
        column_grant(
            "core.project_pages",
            role="app_worker",
            privilege="UPDATE",
            columns=("tier_id", "tier_source", "rule_id", "set_at"),
        ),
        *grants("core.page_terms", api="SELECT, INSERT, DELETE"),
        *grants("seo.crawl_runs", api="SELECT, INSERT", worker="SELECT, INSERT"),
        column_grant("seo.crawl_runs", role="app_api", privilege="UPDATE", columns=_RUN_API_UPDATE),
        column_grant(
            "seo.crawl_runs", role="app_worker", privilege="UPDATE", columns=_RUN_WORKER_UPDATE
        ),
        *grants("seo.crawl_pages", api="SELECT", worker="SELECT, INSERT"),
        column_grant(
            "seo.crawl_pages", role="app_worker", privilege="UPDATE", columns=_PAGE_WORKER_UPDATE
        ),
        *grants("seo.crawl_links", api="SELECT", worker="SELECT, INSERT, DELETE"),
        column_grant(
            "seo.crawl_links", role="app_worker", privilege="UPDATE", columns=("placement", "scope")
        ),
        *grants(
            "seo.crawl_tier_flow", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"
        ),
        *grants(
            "seo.crawl_tier_stats", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT, DELETE"
        ),
        *_workload_checks(
            f"{_OLD_COST_WORKLOADS},'site_crawl'", f"{_OLD_BUDGET_GROUPS},'site_crawl'"
        ),
    ]
    for statement in script:
        op.execute(statement)
    for statement in statements(_PARTITIONS):
        op.execute(statement)
    bind = op.get_bind()
    for position, name, description in _DEFAULT_TIERS:
        bind.execute(
            text(
                "INSERT INTO core.page_tier_levels (workspace_id, position, name, description) "
                "SELECT id, :position, :name, :description FROM auth.workspaces"
            ),
            {"position": position, "name": name, "description": description},
        )
    for price, conditions in _CRAWL_PRICES:
        bind.execute(
            text(
                "INSERT INTO ops.provider_price_book (provider_code, endpoint, price_unit, "
                "unit_price_usd, conditions, valid_from, source_url, verified_at) VALUES "
                "('dataforseo', 'on_page/task_post', 'page', :price, CAST(:conditions AS jsonb), "
                ":valid_from, 'https://dataforseo.com/pricing/on-page/onpage-api', :verified)"
            ),
            {
                "price": price,
                "conditions": conditions,
                "valid_from": date(2026, 11, 16),
                "verified": date(2026, 11, 16),
            },
        )


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute(
        "DELETE FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
        "AND endpoint = 'on_page/task_post'"
    )
    op.execute("DELETE FROM ops.provider_cost_events WHERE workload = 'site_crawl'")
    op.execute("DELETE FROM ops.budgets WHERE workload = 'site_crawl'")
    for statement in _workload_checks(_OLD_COST_WORKLOADS, _OLD_BUDGET_GROUPS):
        op.execute(statement)
    op.execute("DROP FUNCTION seo.drop_crawl_links_partition(uuid)")
    op.execute("DROP FUNCTION seo.add_crawl_links_partition(uuid)")
    op.execute(
        "DROP TABLE seo.crawl_tier_stats, seo.crawl_tier_flow, seo.crawl_links, "
        "seo.crawl_pages, seo.crawl_runs, core.page_terms, core.project_pages, "
        "core.tier_rules, core.page_tier_levels"
    )
