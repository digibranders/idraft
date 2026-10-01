"""Keywords, tracked keywords, groups, term assignments, keyword metrics, imports and URLs.

Table definitions follow docs/04-data-model.md sections 5.1, 7.1, 7.2 and 11.8, with these
choices (plan `docs/superpowers/plans/2026-10-01-keywords.md`):

- Every tenant table carries `workspace_id`, the link tables included, and refers to its parents
  through keys that carry the workspace, so a row can never point into another workspace (D1).
  A group member and a group's parent also carry the project, so they stay in one project.
- A tracked keyword's language is its keyword's: the key to `seo.keywords` includes it.
- The identity of a tracked keyword includes deleted rows; adding a deleted identity brings its
  row back (D3).
- `core.urls` is a global dictionary like `core.domains`; the API adds the target URLs users type
  (D5), SERP ingest adds the rest. `core.url_remap` waits for its first writer.
- Schedules now refer to their project through `(project_id, workspace_id)`, and runs to their
  schedule through `(schedule_id, workspace_id)`: routes write schedules from this revision on
  (docs/review-log.md F66). A tracked keyword names a schedule of its own project. A schedule
  is deleted by setting `deleted_at`, so its runs keep naming it.
- Snapshots are unique per task, so ingest can run twice; import rows record what writing
  them did.
- The price book gets the verified DataForSEO Labs prices (docs/27-cost-model.md section 1), used
  for estimates only.

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from alembic import op
from sqlalchemy import text

from sightline.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_DEPTH_PROFILES = "'light','standard','deep','full','weekly','weekly_light','until_own_match_100'"

_TABLES = f"""
CREATE TABLE core.urls (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    url_hash               bytea NOT NULL CHECK (length(url_hash) = 32),
    canonical_url          text NOT NULL CHECK (length(canonical_url) BETWEEN 1 AND 8192),
    domain_id              integer NOT NULL REFERENCES core.domains(id),
    path                   text NOT NULL,
    first_seen_at          timestamptz NOT NULL DEFAULT now(),
    canonicalizer_version  smallint NOT NULL CHECK (canonicalizer_version >= 1),
    UNIQUE (url_hash)
);

CREATE INDEX urls_domain_id ON core.urls (domain_id);

-- A deleted schedule keeps its row, so its runs keep naming it (docs/19 section 3.11.3).
ALTER TABLE ops.schedules
    ADD COLUMN deleted_at timestamptz,
    ADD CONSTRAINT schedules_id_workspace_id_key UNIQUE (id, workspace_id),
    ADD CONSTRAINT schedules_id_project_id_workspace_id_key UNIQUE (id, project_id, workspace_id),
    DROP CONSTRAINT schedules_project_id_fkey,
    ADD CONSTRAINT schedules_project_id_workspace_id_fkey
        FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE;

ALTER TABLE ops.collection_runs
    DROP CONSTRAINT collection_runs_schedule_id_fkey,
    ADD CONSTRAINT collection_runs_schedule_id_workspace_id_fkey
        FOREIGN KEY (schedule_id, workspace_id) REFERENCES ops.schedules(id, workspace_id);

-- A project's runs, newest first, and its manual runs of a day (the manual run limit).
CREATE INDEX collection_runs_project_created
    ON ops.collection_runs (project_id, created_at DESC, id);

-- A subject's recent tasks of a workload: the new-keyword metrics tick skips keywords that had
-- one in the last day, finished or not, so a failing keyword is not paid for every minute.
CREATE INDEX collection_tasks_subject ON ops.collection_tasks (workload, subject_id, created_at);

CREATE TABLE seo.keywords (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id     uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    text             text NOT NULL CHECK (text = btrim(text) AND length(text) BETWEEN 1 AND 700),
    normalized_text  text NOT NULL CHECK (length(normalized_text) >= 1),
    language_code    text NOT NULL CHECK (language_code ~ '^[a-z]{{2}}$'),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, normalized_text, language_code),
    UNIQUE (id, workspace_id),
    UNIQUE (id, workspace_id, language_code)
);

CREATE INDEX keywords_normalized_text_trgm ON seo.keywords USING gin (normalized_text gin_trgm_ops);

CREATE TABLE seo.tracked_keywords (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id     uuid NOT NULL,
    project_id       uuid NOT NULL,
    keyword_id       uuid NOT NULL,
    search_engine    text NOT NULL DEFAULT 'google' CHECK (search_engine IN ('google','bing')),
    location_id      integer NOT NULL REFERENCES core.locations(id),
    language_code    text NOT NULL,
    device           text NOT NULL CHECK (device IN ('desktop','mobile')),
    os               text CHECK (os IN ('windows','macos','android','ios')),
    config_version   integer NOT NULL DEFAULT 1 CHECK (config_version >= 1),
    depth_profile    text NOT NULL DEFAULT 'standard' CHECK (depth_profile IN ({_DEPTH_PROFILES})),
    target_url_id    bigint REFERENCES core.urls(id),
    intent           text NOT NULL DEFAULT 'unknown'
                     CHECK (intent IN ('informational','navigational','commercial','transactional',
                                       'local','unknown')),
    intent_source    text CHECK (intent_source IN ('provider','manual','rule')),
    funnel_stage     text NOT NULL DEFAULT 'unknown'
                     CHECK (funnel_stage IN ('tofu','mofu','bofu','retention','unknown')),
    priority         smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    business_value   numeric(12,2) CHECK (business_value >= 0),
    frequency        text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','custom')),
    schedule_id      uuid,
    source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','csv_import','api','gsc_import','discovery',
                                       'bulk_paste')),
    is_active        boolean NOT NULL DEFAULT true,
    created_by       uuid REFERENCES auth.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    CONSTRAINT tracked_keyword_identity UNIQUE
        (project_id, keyword_id, search_engine, location_id, language_code, device),
    UNIQUE (id, workspace_id),
    UNIQUE (id, project_id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (keyword_id, workspace_id, language_code)
        REFERENCES seo.keywords(id, workspace_id, language_code),
    -- A schedule of the same project.
    FOREIGN KEY (schedule_id, project_id, workspace_id)
        REFERENCES ops.schedules(id, project_id, workspace_id)
);

CREATE INDEX tracked_keywords_live_project ON seo.tracked_keywords (project_id)
    WHERE deleted_at IS NULL AND is_active;

CREATE INDEX tracked_keywords_live_workspace ON seo.tracked_keywords (workspace_id)
    WHERE deleted_at IS NULL AND is_active;

CREATE INDEX tracked_keywords_schedule_id ON seo.tracked_keywords (schedule_id)
    WHERE schedule_id IS NOT NULL;

CREATE INDEX tracked_keywords_keyword_id ON seo.tracked_keywords (keyword_id);

CREATE TABLE seo.tracked_keyword_config_history (
    tracked_keyword_id  uuid NOT NULL,
    workspace_id        uuid NOT NULL,
    config_version      integer NOT NULL CHECK (config_version >= 1),
    depth_profile       text NOT NULL CHECK (depth_profile IN ({_DEPTH_PROFILES})),
    target_url_id       bigint REFERENCES core.urls(id),
    valid_from          timestamptz NOT NULL,
    valid_to            timestamptz CHECK (valid_to >= valid_from),
    changed_by          uuid REFERENCES auth.users(id),
    change_reason       text CHECK (length(change_reason) <= 500),
    PRIMARY KEY (tracked_keyword_id, config_version),
    FOREIGN KEY (tracked_keyword_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE seo.keyword_groups (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL,
    project_id    uuid NOT NULL,
    parent_id     uuid,
    name          text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100
                                       AND strpos(name, '/') = 0),
    -- At most 2,048 bytes: under the 2,704 a btree entry of keyword_groups_project_path holds.
    path          text NOT NULL CHECK (length(path) >= 1 AND octet_length(path) <= 2048),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (id, project_id, workspace_id),
    CHECK (parent_id IS DISTINCT FROM id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    -- A parent is in the same project, so in the same workspace too.
    FOREIGN KEY (parent_id, project_id, workspace_id)
        REFERENCES seo.keyword_groups(id, project_id, workspace_id) ON DELETE CASCADE
);

-- Names compare without case among siblings, roots included.
CREATE UNIQUE INDEX keyword_groups_sibling_name
    ON seo.keyword_groups (project_id, parent_id, lower(name)) NULLS NOT DISTINCT;

CREATE INDEX keyword_groups_project_path ON seo.keyword_groups (project_id, path text_pattern_ops);

CREATE INDEX keyword_groups_parent_id ON seo.keyword_groups (parent_id);

CREATE TABLE seo.keyword_group_members (
    group_id            uuid NOT NULL,
    tracked_keyword_id  uuid NOT NULL,
    project_id          uuid NOT NULL,
    workspace_id        uuid NOT NULL,
    PRIMARY KEY (group_id, tracked_keyword_id),
    FOREIGN KEY (group_id, project_id, workspace_id)
        REFERENCES seo.keyword_groups(id, project_id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (tracked_keyword_id, project_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, project_id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX keyword_group_members_tracked_keyword_id
    ON seo.keyword_group_members (tracked_keyword_id);

CREATE TABLE seo.tracked_keyword_terms (
    tracked_keyword_id  uuid NOT NULL,
    term_id             uuid NOT NULL,
    workspace_id        uuid NOT NULL,
    assigned_by         text NOT NULL DEFAULT 'manual'
                        CHECK (assigned_by IN ('manual','import','rule','auto_cluster',
                                               'ai_suggestion')),
    PRIMARY KEY (tracked_keyword_id, term_id),
    FOREIGN KEY (tracked_keyword_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (term_id, workspace_id)
        REFERENCES core.taxonomy_terms(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX tracked_keyword_terms_term_id ON seo.tracked_keyword_terms (term_id);

-- A per-keyword change to the project's competitor set (core.project_entities).
CREATE TABLE seo.tracked_keyword_competitors (
    tracked_keyword_id  uuid NOT NULL,
    entity_id           uuid NOT NULL,
    workspace_id        uuid NOT NULL,
    mode                text NOT NULL CHECK (mode IN ('include','exclude')),
    PRIMARY KEY (tracked_keyword_id, entity_id),
    FOREIGN KEY (tracked_keyword_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (entity_id, workspace_id)
        REFERENCES core.entities(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX tracked_keyword_competitors_entity_id
    ON seo.tracked_keyword_competitors (entity_id);

CREATE TABLE seo.keyword_metric_snapshots (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id        uuid NOT NULL,
    keyword_id          uuid NOT NULL,
    location_id         integer NOT NULL REFERENCES core.locations(id),
    language_code       text NOT NULL,
    source              text NOT NULL CHECK (source IN ('dataforseo_labs','dataforseo_google_ads',
                                                        'dataforseo_clickstream')),
    fetched_at          timestamptz NOT NULL,
    data_month          date CHECK (extract(day FROM data_month) = 1),
    search_volume       integer CHECK (search_volume >= 0),
    monthly_searches    jsonb NOT NULL DEFAULT '[]'
                        CHECK (jsonb_typeof(monthly_searches) = 'array'),
    cpc_usd             numeric(10,4) CHECK (cpc_usd >= 0),
    competition         numeric(5,4) CHECK (competition BETWEEN 0 AND 1),
    competition_level   text CHECK (competition_level IN ('LOW','MEDIUM','HIGH')),
    keyword_difficulty  smallint CHECK (keyword_difficulty BETWEEN 0 AND 100),
    intent_main         text,
    intent_detail       jsonb,
    serp_item_types     text[],
    raw_payload_id      bigint,
    task_id             bigint,
    cost_event_id       bigint,
    is_material_change  boolean NOT NULL,
    -- One snapshot per task, so ingesting a task twice writes one row; two tasks of one call
    -- for the same keyword (a manual refresh and the monthly run) write two.
    CONSTRAINT keyword_metric_snapshots_one_per_task UNIQUE (task_id),
    UNIQUE (id, workspace_id),
    -- What the current row refers to, so it names a snapshot of its own key.
    CONSTRAINT keyword_metric_snapshots_current_key
        UNIQUE (id, workspace_id, keyword_id, location_id, language_code, source),
    FOREIGN KEY (keyword_id, workspace_id, language_code)
        REFERENCES seo.keywords(id, workspace_id, language_code) ON DELETE CASCADE
);

CREATE INDEX keyword_metric_snapshots_latest
    ON seo.keyword_metric_snapshots (keyword_id, location_id, language_code, fetched_at DESC);

-- One row per keyword, location, language and source: the latest snapshot.
CREATE TABLE seo.keyword_metrics_current (
    keyword_id          uuid NOT NULL,
    location_id         integer NOT NULL,
    language_code       text NOT NULL,
    source              text NOT NULL,
    workspace_id        uuid NOT NULL,
    snapshot_id         bigint NOT NULL,
    search_volume       integer,
    cpc_usd             numeric(10,4),
    keyword_difficulty  smallint,
    intent_main         text,
    fetched_at          timestamptz NOT NULL,
    PRIMARY KEY (keyword_id, location_id, language_code, source),
    FOREIGN KEY (keyword_id, workspace_id, language_code)
        REFERENCES seo.keywords(id, workspace_id, language_code) ON DELETE CASCADE,
    FOREIGN KEY (snapshot_id, workspace_id, keyword_id, location_id, language_code, source)
        REFERENCES seo.keyword_metric_snapshots(id, workspace_id, keyword_id, location_id,
                                                language_code, source) ON DELETE CASCADE
);

CREATE TABLE seo.keyword_imports (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id       uuid NOT NULL,
    project_id         uuid NOT NULL,
    source             text NOT NULL CHECK (source IN ('upload','paste','api','gsc')),
    original_filename  text CHECK (length(original_filename) BETWEEN 1 AND 255),
    upload_object_key  text,
    status             text NOT NULL
                       CHECK (status IN ('uploaded','parsing','needs_mapping','preview_ready',
                                         'writing','completed','completed_with_errors','failed',
                                         'cancelled','expired')),
    column_mapping     jsonb NOT NULL DEFAULT '{{}}',
    defaults           jsonb NOT NULL DEFAULT '{{}}',
    counts             jsonb NOT NULL DEFAULT '{{}}',
    duplicate_action   text CHECK (duplicate_action IN ('skip','merge_terms')),
    error_code         text,
    created_by         uuid NOT NULL REFERENCES auth.users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    finished_at        timestamptz,
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX keyword_imports_project_created ON seo.keyword_imports (project_id, created_at DESC);

-- A file row; `device = both` makes two, parts 1 (desktop) and 2 (mobile).
CREATE TABLE seo.keyword_import_rows (
    import_id                    uuid NOT NULL,
    row_no                       integer NOT NULL CHECK (row_no >= 1),
    part                         smallint NOT NULL DEFAULT 1 CHECK (part IN (1, 2)),
    workspace_id                 uuid NOT NULL,
    raw                          jsonb NOT NULL,
    keyword_text                 text,
    normalized_text              text,
    language_code                text,
    device                       text CHECK (device IN ('desktop','mobile')),
    location_id                  integer,
    outcome                      text NOT NULL
                                 CHECK (outcome IN ('new','duplicate','variant','conflict',
                                                    'invalid')),
    reason_code                  text,
    reason                       text,
    existing_tracked_keyword_id  uuid,
    action                       text NOT NULL
                                 CHECK (action IN ('create','skip','merge','force_separate')),
    -- What writing the row did: the report says which rows failed and what each one became.
    result                       text CHECK (result IN ('created','skipped','merged','failed')),
    tracked_keyword_id           uuid,
    write_error_code             text,
    PRIMARY KEY (import_id, row_no, part),
    CHECK (part = 1 OR device IS NOT DISTINCT FROM 'mobile'),
    FOREIGN KEY (import_id, workspace_id)
        REFERENCES seo.keyword_imports(id, workspace_id) ON DELETE CASCADE
)
"""

_TENANT_TABLES = (
    "seo.keywords",
    "seo.tracked_keywords",
    "seo.tracked_keyword_config_history",
    "seo.keyword_groups",
    "seo.keyword_group_members",
    "seo.tracked_keyword_terms",
    "seo.tracked_keyword_competitors",
    "seo.keyword_metric_snapshots",
    "seo.keyword_metrics_current",
    "seo.keyword_imports",
    "seo.keyword_import_rows",
)

# docs/27-cost-model.md section 1, verified 2026-09-29; prices after the 1 July 2026 change.
_LABS_PRICES = (
    ("request", Decimal("0.012")),
    ("item", Decimal("0.00012")),
)
_LABS_ENDPOINT = "dataforseo_labs/google/keyword_overview"
_LABS_PRICING_URL = "https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api"

_URL_INSERT_COLUMNS = ("url_hash", "canonical_url", "domain_id", "path", "canonicalizer_version")
_DOMAIN_INSERT_COLUMNS = ("host", "registrable_domain", "public_suffix", "is_ip")
_KEYWORD_INSERT_COLUMNS = ("workspace_id", "text", "normalized_text", "language_code")
# Identity columns never change; `config_version` with the history row that explains it.
_TRACKED_KEYWORD_API_UPDATE = (
    "config_version",
    "depth_profile",
    "target_url_id",
    "intent",
    "intent_source",
    "funnel_stage",
    "priority",
    "business_value",
    "frequency",
    "schedule_id",
    "is_active",
    "updated_at",
    "deleted_at",
)
# An import that brings back a deleted keyword drops a schedule deleted since.
_TRACKED_KEYWORD_WORKER_UPDATE = ("is_active", "updated_at", "deleted_at", "schedule_id")
_IMPORT_API_UPDATE = ("column_mapping", "defaults", "status", "duplicate_action", "finished_at")
_IMPORT_WORKER_UPDATE = ("column_mapping", "status", "counts", "error_code", "finished_at")
_RUN_WORKER_UPDATE = ("window_start", "window_end", "config_snapshot")


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    seed = text(
        "INSERT INTO ops.provider_price_book (provider_code, endpoint, price_unit, "
        "unit_price_usd, conditions, valid_from, source_url, verified_at) "
        "VALUES ('dataforseo', :endpoint, :unit, :price, '{}', :valid_from, :url, :verified)"
    )
    for unit, price in _LABS_PRICES:
        op.get_bind().execute(
            seed,
            {
                "endpoint": _LABS_ENDPOINT,
                "unit": unit,
                "price": price,
                "valid_from": date(2026, 7, 1),
                "url": _LABS_PRICING_URL,
                "verified": date(2026, 9, 29),
            },
        )
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("core.urls", api="SELECT", worker="SELECT"),
        column_grant("core.urls", role="app_api", privilege="INSERT", columns=_URL_INSERT_COLUMNS),
        column_grant(
            "core.urls", role="app_worker", privilege="INSERT", columns=_URL_INSERT_COLUMNS
        ),
        # Imports write target URLs, whose hosts may be new.
        *grants("core.domains", worker="SELECT"),
        column_grant(
            "core.domains", role="app_worker", privilege="INSERT", columns=_DOMAIN_INSERT_COLUMNS
        ),
        # Imports file keywords under terms and groups, creating missing ones.
        *grants("core.taxonomy_vocabularies", worker="SELECT"),
        *grants("core.taxonomy_terms", worker="SELECT, INSERT"),
        # A project's first tracked keyword, from an import too, creates its metrics schedule.
        *grants("ops.schedules", worker="INSERT"),
        *grants("seo.keywords", api="SELECT", worker="SELECT"),
        column_grant(
            "seo.keywords", role="app_api", privilege="INSERT", columns=_KEYWORD_INSERT_COLUMNS
        ),
        column_grant(
            "seo.keywords", role="app_worker", privilege="INSERT", columns=_KEYWORD_INSERT_COLUMNS
        ),
        *grants("seo.tracked_keywords", api="SELECT, INSERT", worker="SELECT, INSERT"),
        column_grant(
            "seo.tracked_keywords",
            role="app_api",
            privilege="UPDATE",
            columns=_TRACKED_KEYWORD_API_UPDATE,
        ),
        column_grant(
            "seo.tracked_keywords",
            role="app_worker",
            privilege="UPDATE",
            columns=_TRACKED_KEYWORD_WORKER_UPDATE,
        ),
        *grants(
            "seo.tracked_keyword_config_history", api="SELECT, INSERT", worker="SELECT, INSERT"
        ),
        column_grant(
            "seo.tracked_keyword_config_history",
            role="app_api",
            privilege="UPDATE",
            columns=("valid_to",),
        ),
        *grants(
            "seo.keyword_groups", api="SELECT, INSERT, UPDATE, DELETE", worker="SELECT, INSERT"
        ),
        *grants("seo.keyword_group_members", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT"),
        *grants("seo.tracked_keyword_terms", api="SELECT, INSERT, DELETE", worker="SELECT, INSERT"),
        *grants("seo.tracked_keyword_competitors", api="SELECT, INSERT, DELETE"),
        *grants("seo.keyword_metric_snapshots", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.keyword_metrics_current", api="SELECT", worker="SELECT, INSERT, UPDATE"),
        *grants("seo.keyword_imports", api="SELECT, INSERT", worker="SELECT"),
        column_grant(
            "seo.keyword_imports", role="app_api", privilege="UPDATE", columns=_IMPORT_API_UPDATE
        ),
        column_grant(
            "seo.keyword_imports",
            role="app_worker",
            privilege="UPDATE",
            columns=_IMPORT_WORKER_UPDATE,
        ),
        *grants("seo.keyword_import_rows", api="SELECT", worker="SELECT, INSERT, DELETE"),
        column_grant(
            "seo.keyword_import_rows", role="app_api", privilege="UPDATE", columns=("action",)
        ),
        column_grant(
            "seo.keyword_import_rows",
            role="app_worker",
            privilege="UPDATE",
            columns=("result", "tracked_keyword_id", "write_error_code"),
        ),
        # A schedule is deleted by setting `deleted_at`: its runs keep naming it.
        "REVOKE DELETE ON ops.schedules FROM app_api",
        # The planner opens a manual run's window when it plans it, and records the
        # configuration its plan used (plan decision D9).
        column_grant(
            "ops.collection_runs",
            role="app_worker",
            privilege="UPDATE",
            columns=_RUN_WORKER_UPDATE,
        ),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute(
        "DROP TABLE seo.keyword_import_rows, seo.keyword_imports, seo.keyword_metrics_current, "
        "seo.keyword_metric_snapshots, seo.tracked_keyword_competitors, "
        "seo.tracked_keyword_terms, seo.keyword_group_members, seo.keyword_groups, "
        "seo.tracked_keyword_config_history, seo.tracked_keywords, seo.keywords"
    )
    op.execute(
        "DELETE FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
        f"AND endpoint = '{_LABS_ENDPOINT}'"
    )
    op.execute(
        "ALTER TABLE ops.collection_runs "
        "DROP CONSTRAINT collection_runs_schedule_id_workspace_id_fkey, "
        "ADD CONSTRAINT collection_runs_schedule_id_fkey "
        "FOREIGN KEY (schedule_id) REFERENCES ops.schedules(id)"
    )
    op.execute("DROP INDEX ops.collection_tasks_subject, ops.collection_runs_project_created")
    op.execute(
        "ALTER TABLE ops.schedules DROP CONSTRAINT schedules_project_id_workspace_id_fkey, "
        "ADD CONSTRAINT schedules_project_id_fkey FOREIGN KEY (project_id) "
        "REFERENCES core.projects(id) ON DELETE CASCADE, "
        "DROP CONSTRAINT schedules_id_project_id_workspace_id_key, "
        "DROP CONSTRAINT schedules_id_workspace_id_key, "
        "DROP COLUMN deleted_at"
    )
    op.execute(
        f"REVOKE UPDATE ({', '.join(_RUN_WORKER_UPDATE)}) ON ops.collection_runs FROM app_worker"
    )
    op.execute("GRANT DELETE ON ops.schedules TO app_api")
    op.execute("REVOKE INSERT ON ops.schedules FROM app_worker")
    op.execute("REVOKE INSERT ON core.taxonomy_terms FROM app_worker")
    op.execute("REVOKE SELECT ON core.taxonomy_terms, core.taxonomy_vocabularies FROM app_worker")
    op.execute("REVOKE SELECT, INSERT ON core.domains FROM app_worker")
    op.execute("DROP TABLE core.urls")
