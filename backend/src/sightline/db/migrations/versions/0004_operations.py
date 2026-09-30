"""Operations: providers, budgets, schedules, the task ledger, raw payloads, cost, audit.

Table definitions follow docs/04-data-model.md sections 4.1, 11.1 to 11.4 and 11.7. `ops.secrets`
waits for first-party integrations and `ops.fetch_cache` for the shared fetch cache.

Revision ID: 0004
Revises: 0003
"""

from __future__ import annotations

from alembic import op

from sightline.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TASK_WORKLOADS = (
    "('seo_rank','ai_prompt','ai_mode_keyword','keyword_metrics','discovery',"
    "'ai_benchmark','gsc_sync','bing_sync','ga4_sync','cloudflare_sync')"
)
_COST_WORKLOADS = (
    "('seo_rank','ai_prompt','ai_mode_keyword','keyword_metrics','discovery',"
    "'ai_benchmark','gsc_sync','bing_sync','ga4_sync','cloudflare_sync',"
    "'ai_overview','extraction_llm','keyword_research','first_party')"
)

_TABLES = f"""
CREATE TABLE ops.providers (
    code   text PRIMARY KEY,
    label  text NOT NULL,
    kind   text NOT NULL CHECK (kind IN ('collection','official_llm','first_party','internal_llm'))
);

CREATE TABLE ops.provider_price_book (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    provider_code   text NOT NULL REFERENCES ops.providers(code),
    endpoint        text NOT NULL,
    price_unit      text NOT NULL,
    unit_price_usd  numeric(14,8) NOT NULL,
    conditions      jsonb NOT NULL DEFAULT '{{}}',
    valid_from      date NOT NULL,
    valid_to        date,
    source_url      text NOT NULL,
    verified_at     date NOT NULL
);

CREATE TABLE ops.budgets (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    project_id      uuid REFERENCES core.projects(id) ON DELETE CASCADE,
    workload        text CHECK (workload IN ('seo_rank','ai_prompt','keyword_research',
                                             'ai_benchmark','extraction_llm','first_party','all')),
    period          text NOT NULL DEFAULT 'month' CHECK (period IN ('month')),
    limit_usd       numeric(14,2) NOT NULL CHECK (limit_usd >= 0),
    soft_limit_pct  smallint NOT NULL DEFAULT 80 CHECK (soft_limit_pct BETWEEN 1 AND 100),
    action_on_hard  text NOT NULL DEFAULT 'pause' CHECK (action_on_hard IN ('pause','alert_only')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, workload, period)
);

CREATE TABLE ops.schedules (
    id                  uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id        uuid NOT NULL,
    project_id          uuid NOT NULL REFERENCES core.projects(id) ON DELETE CASCADE,
    workload            text NOT NULL CHECK (workload IN {_TASK_WORKLOADS}),
    name                text NOT NULL,
    cadence             text NOT NULL CHECK (cadence IN ('daily','weekly','monthly','cron')),
    cron_expr           text,
    timezone            text NOT NULL,
    window_start_local  time NOT NULL DEFAULT '02:00',
    window_hours        smallint NOT NULL DEFAULT 6 CHECK (window_hours BETWEEN 1 AND 24),
    weekday             smallint CHECK (weekday BETWEEN 0 AND 6),
    priority            text NOT NULL DEFAULT 'standard'
                        CHECK (priority IN ('high','standard','low')),
    provider_mode       text NOT NULL DEFAULT 'standard_queue'
                        CHECK (provider_mode IN ('standard_queue','priority_queue','live')),
    selector            jsonb NOT NULL DEFAULT '{{}}',
    is_active           boolean NOT NULL DEFAULT true,
    next_run_at         timestamptz NOT NULL,
    last_run_id         uuid,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ops.schedules (next_run_at) WHERE is_active;

CREATE TABLE ops.collection_runs (
    id                    uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    schedule_id           uuid REFERENCES ops.schedules(id),
    workload              text NOT NULL CHECK (workload IN {_TASK_WORKLOADS}),
    window_start          timestamptz NOT NULL,
    window_end            timestamptz NOT NULL,
    trigger               text NOT NULL CHECK (trigger IN ('schedule','manual','backfill','retry')),
    status                text NOT NULL
                          CHECK (status IN ('planned','running','completed','completed_with_errors',
                                            'failed','cancelled','budget_blocked')),
    status_reason         text,
    blocked_by_budget_id  uuid REFERENCES ops.budgets(id),
    created_by_type       text CHECK (created_by_type IN ('user','api_key','system')),
    created_by_id         text,
    origin_request_id     text,
    tasks_total           integer NOT NULL DEFAULT 0,
    tasks_succeeded       integer NOT NULL DEFAULT 0,
    tasks_failed          integer NOT NULL DEFAULT 0,
    estimated_cost_usd    numeric(14,4),
    actual_cost_usd       numeric(14,4),
    config_snapshot       jsonb NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    completed_at          timestamptz,
    UNIQUE NULLS NOT DISTINCT (schedule_id, window_start)
);

CREATE TABLE ops.collection_tasks (
    id                   bigint GENERATED ALWAYS AS IDENTITY,
    created_at           timestamptz NOT NULL DEFAULT now(),
    run_id               uuid NOT NULL,
    workspace_id         uuid NOT NULL,
    project_id           uuid NOT NULL,
    workload             text NOT NULL CHECK (workload IN {_TASK_WORKLOADS}),
    subject_type         text NOT NULL
                         CHECK (subject_type IN ('tracked_keyword','prompt_version','keyword',
                                                 'integration','seed_set')),
    subject_id           text NOT NULL,
    engine_code          text,
    location_id          integer,
    replicate_index      smallint NOT NULL DEFAULT 1,
    idempotency_key      bytea NOT NULL,
    request_fingerprint  bytea NOT NULL,
    provider_code        text NOT NULL,
    provider_endpoint    text NOT NULL,
    provider_task_id     text,
    scheduled_for        timestamptz NOT NULL,
    status               text NOT NULL
                         CHECK (status IN ('pending','submit_unknown','submitted','ready','fetched',
                                           'ingested','failed','dead','cancelled','skipped_cached')),
    dispatched_at        timestamptz,
    attempts             smallint NOT NULL DEFAULT 0,
    next_attempt_at      timestamptz,
    submitted_at         timestamptz,
    ready_at             timestamptz,
    completed_at         timestamptz,
    raw_payload_id       bigint,
    ready_source         text CHECK (ready_source IN ('poll','sweeper','live')),
    result_meta          jsonb,
    cost_usd             numeric(14,6),
    last_error_code      text,
    last_error_message   text,
    PRIMARY KEY (id, created_at),
    UNIQUE (idempotency_key, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX ON ops.collection_tasks (status, next_attempt_at)
    WHERE status IN ('pending','submit_unknown','submitted','ready','failed');

CREATE INDEX ON ops.collection_tasks (provider_code, provider_task_id)
    WHERE provider_task_id IS NOT NULL;

CREATE INDEX ON ops.collection_tasks (run_id);

CREATE TABLE ops.raw_payloads (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    storage               text NOT NULL CHECK (storage IN ('r2','pg_inline','local_spool')),
    object_key            text,
    inline_body           bytea,
    sha256                bytea NOT NULL,
    bytes_raw             integer NOT NULL,
    bytes_stored          integer NOT NULL,
    compression           text NOT NULL CHECK (compression IN ('zstd','gzip','none')),
    content_type          text NOT NULL,
    provider_code         text NOT NULL,
    provider_endpoint     text NOT NULL,
    provider_schema_hint  text,
    fetched_at            timestamptz NOT NULL,
    retention_class       text NOT NULL
                          CHECK (retention_class IN ('serp_raw','ai_raw','first_party_raw',
                                                     'error')),
    expires_at            timestamptz,
    UNIQUE (sha256)
);

CREATE TABLE ops.provider_cost_events (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    occurred_at     timestamptz NOT NULL,
    workspace_id    uuid,
    project_id      uuid,
    provider_code   text NOT NULL,
    endpoint        text NOT NULL,
    workload        text NOT NULL CHECK (workload IN {_COST_WORKLOADS}),
    channel         text NOT NULL CHECK (channel IN ('seo','ai','research','internal')),
    run_id          uuid,
    task_id         bigint,
    subject_type    text,
    subject_id      text,
    engine_code     text,
    request_count   integer NOT NULL DEFAULT 1,
    units           numeric(14,4),
    price_unit      text,
    cost_usd        numeric(14,6) NOT NULL,
    cost_source     text NOT NULL
                    CHECK (cost_source IN ('provider_reported','computed_from_tokens',
                                           'price_book_estimate')),
    billing_period  date NOT NULL,
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX ON ops.provider_cost_events (workspace_id, billing_period, project_id);

CREATE TABLE ops.cost_daily (
    cost_date      date NOT NULL,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    provider_code  text NOT NULL,
    endpoint       text NOT NULL,
    workload       text NOT NULL,
    engine_code    text NOT NULL DEFAULT '',
    request_count  bigint NOT NULL,
    cost_usd       numeric(14,6) NOT NULL,
    subjects       integer NOT NULL,
    PRIMARY KEY (cost_date, workspace_id, project_id, provider_code, endpoint, workload,
                 engine_code)
);

CREATE TABLE ops.audit_logs (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    workspace_id uuid,
    actor_type   text NOT NULL CHECK (actor_type IN ('user','api_key','system')),
    actor_id     text NOT NULL,
    action       text NOT NULL,
    target_type  text NOT NULL,
    target_id    text NOT NULL,
    before       jsonb,
    after        jsonb,
    ip           inet,
    user_agent   text,
    request_id   text
);

CREATE INDEX ON ops.audit_logs (workspace_id, occurred_at DESC);

CREATE TABLE ops.component_versions (
    component    text NOT NULL,
    version      smallint NOT NULL,
    released_at  timestamptz NOT NULL DEFAULT now(),
    git_sha      text NOT NULL,
    notes        text NOT NULL,
    is_breaking  boolean NOT NULL,
    PRIMARY KEY (component, version)
);
"""

# Partitions are created ahead of time by a function no runtime role may call with a table of its
# choice. The worker calls maintain_partitions(), which works through the registry below.
_PARTITIONING = """
CREATE TABLE ops.partitioned_tables (
    parent        regclass PRIMARY KEY,
    key_is_date   boolean NOT NULL DEFAULT false,
    months_back   integer NOT NULL DEFAULT 1 CHECK (months_back >= 0),
    months_ahead  integer NOT NULL DEFAULT 3 CHECK (months_ahead >= 1)
);

CREATE FUNCTION ops.ensure_monthly_partitions(
    p_parent regclass,
    p_months_back int DEFAULT 1,
    p_months_ahead int DEFAULT 3,
    p_key_is_date boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog SET lock_timeout = '5s' AS $$
DECLARE
    m date;
    parent_schema name;
    parent_table name;
    part_table name;
    created integer := 0;
BEGIN
    -- One caller at a time: two workers starting their daily maintenance together must not race.
    -- A table lock, not an advisory lock: anyone can take an advisory lock and hold it, while
    -- no runtime role has any privilege on this table. Adding a partition locks the parent
    -- exclusively for an instant; lock_timeout bounds the wait, so maintenance behind a long
    -- query fails and is retried instead of queueing every other query on that table.
    LOCK TABLE ops.partitioned_tables IN SHARE UPDATE EXCLUSIVE MODE;
    SELECT n.nspname, c.relname INTO STRICT parent_schema, parent_table
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = p_parent;
    -- Month boundaries are computed and written in UTC, so the result does not depend on the
    -- session TimeZone.
    FOR m IN
        SELECT generate_series(
            date_trunc('month', (now() AT TIME ZONE 'UTC')
                                - make_interval(months => p_months_back))::date,
            date_trunc('month', (now() AT TIME ZONE 'UTC')
                                + make_interval(months => p_months_ahead))::date,
            interval '1 month')::date
    LOOP
        part_table := parent_table || '_p' || to_char(m, 'YYYYMM');
        IF to_regclass(format('%I.%I', parent_schema, part_table)) IS NULL THEN
            -- timestamptz keys get explicit UTC literals; date keys get plain dates.
            EXECUTE format(
                'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
                parent_schema, part_table, parent_schema, parent_table,
                CASE WHEN p_key_is_date THEN m::text ELSE m::text || ' 00:00:00+00' END,
                CASE WHEN p_key_is_date THEN (m + interval '1 month')::date::text
                     ELSE (m + interval '1 month')::date::text || ' 00:00:00+00' END);
            EXECUTE format(
                'ALTER TABLE %I.%I SET (autovacuum_vacuum_insert_scale_factor = 0.05, '
                'autovacuum_analyze_scale_factor = 0.02)', parent_schema, part_table);
            created := created + 1;
        END IF;
    END LOOP;
    RETURN created;
END $$;

CREATE FUNCTION ops.maintain_partitions() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    entry ops.partitioned_tables;
    created integer := 0;
BEGIN
    -- A registry row whose table has been dropped is skipped, so one stale row can never stop
    -- partitions being created for every other table.
    FOR entry IN
        SELECT t.* FROM ops.partitioned_tables t
        WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.parent)
    LOOP
        created := created + ops.ensure_monthly_partitions(
            entry.parent, entry.months_back, entry.months_ahead, entry.key_is_date);
    END LOOP;
    RETURN created;
END $$;

REVOKE ALL ON FUNCTION ops.ensure_monthly_partitions(regclass, int, int, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION ops.maintain_partitions() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ops.maintain_partitions() TO app_worker;

INSERT INTO ops.partitioned_tables (parent)
VALUES ('ops.collection_tasks'), ('ops.provider_cost_events');

SELECT ops.maintain_partitions();
"""

_SEED = """
INSERT INTO ops.providers (code, label, kind) VALUES
    ('dataforseo', 'DataForSEO', 'collection'),
    ('internal', 'Internal classifiers', 'internal_llm');
"""

_TENANT_TABLES = (
    "ops.budgets",
    "ops.schedules",
    "ops.collection_runs",
    "ops.collection_tasks",
    "ops.provider_cost_events",
    "ops.cost_daily",
    "ops.audit_logs",
)

_CRUD = "SELECT, INSERT, UPDATE, DELETE"
# Least privilege, as in the previous revision. The worker bypasses row-level security, so it gets
# UPDATE on named columns only and can never change a row's workspace, project or identity. The
# API cannot read ops.raw_payloads at all: that table is a cache shared by every workspace and has
# no workspace column to filter on. The contract is tested in tests/db/test_grants.py.
_TABLE_GRANTS: dict[str, tuple[str, str]] = {
    # table: (app_api, app_worker)
    "ops.providers": ("SELECT", "SELECT"),
    "ops.component_versions": ("SELECT", "SELECT"),
    "ops.partitioned_tables": ("", ""),
    "ops.provider_price_book": ("SELECT", "SELECT, INSERT, UPDATE"),
    "ops.budgets": (_CRUD, "SELECT"),
    "ops.schedules": (_CRUD, "SELECT"),
    "ops.collection_runs": ("SELECT", "SELECT, INSERT"),
    "ops.collection_tasks": ("SELECT", "SELECT, INSERT"),
    "ops.raw_payloads": ("", "SELECT, INSERT"),
    "ops.provider_cost_events": ("SELECT", "SELECT, INSERT"),
    "ops.cost_daily": ("SELECT", "SELECT, INSERT"),
    "ops.audit_logs": ("SELECT", "SELECT"),
}
# Every column except id and occurred_at, so an entry's time always comes from the database clock.
_AUDIT_COLUMNS = (
    "workspace_id",
    "actor_type",
    "actor_id",
    "action",
    "target_type",
    "target_id",
    "before",
    "after",
    "ip",
    "user_agent",
    "request_id",
)
_COLUMN_GRANTS: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    # table, role, privilege, columns
    ("ops.audit_logs", "app_api", "INSERT", _AUDIT_COLUMNS),
    ("ops.audit_logs", "app_worker", "INSERT", _AUDIT_COLUMNS),
    (
        # A manual run: what was asked for, never the counters or the actual cost.
        "ops.collection_runs",
        "app_api",
        "INSERT",
        (
            "workspace_id",
            "project_id",
            "schedule_id",
            "workload",
            "window_start",
            "window_end",
            "trigger",
            "status",
            "created_by_type",
            "created_by_id",
            "origin_request_id",
            "estimated_cost_usd",
            "config_snapshot",
        ),
    ),
    ("ops.collection_runs", "app_api", "UPDATE", ("status", "status_reason", "completed_at")),
    (
        "ops.collection_runs",
        "app_worker",
        "UPDATE",
        (
            "status",
            "status_reason",
            "blocked_by_budget_id",
            "tasks_total",
            "tasks_succeeded",
            "tasks_failed",
            "estimated_cost_usd",
            "actual_cost_usd",
            "completed_at",
        ),
    ),
    ("ops.schedules", "app_worker", "UPDATE", ("next_run_at", "last_run_id")),
    (
        "ops.collection_tasks",
        "app_worker",
        "UPDATE",
        (
            "provider_task_id",
            "scheduled_for",
            "status",
            "dispatched_at",
            "attempts",
            "next_attempt_at",
            "submitted_at",
            "ready_at",
            "completed_at",
            "raw_payload_id",
            "ready_source",
            "result_meta",
            "cost_usd",
            "last_error_code",
            "last_error_message",
        ),
    ),
    ("ops.raw_payloads", "app_worker", "UPDATE", ("expires_at",)),
    ("ops.cost_daily", "app_worker", "UPDATE", ("request_count", "cost_usd", "subjects")),
)


def upgrade() -> None:
    script = [*statements(_TABLES), *statements(_PARTITIONING), *statements(_SEED)]
    for table in _TENANT_TABLES:
        # Rows without a workspace (platform overhead) match no workspace: the API never sees them.
        script += tenant_isolation(table)
    for table, (api, worker) in _TABLE_GRANTS.items():
        script += grants(table, api=api, worker=worker)
    for table, role, privilege, columns in _COLUMN_GRANTS:
        script.append(column_grant(table, role=role, privilege=privilege, columns=columns))
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute("DROP FUNCTION ops.maintain_partitions()")
    op.execute("DROP FUNCTION ops.ensure_monthly_partitions(regclass, int, int, boolean)")
    op.execute(
        "DROP TABLE ops.partitioned_tables, ops.component_versions, ops.audit_logs, "
        "ops.cost_daily, ops.provider_cost_events, ops.raw_payloads, ops.collection_tasks, "
        "ops.collection_runs, ops.schedules, ops.budgets, ops.provider_price_book, ops.providers"
    )
