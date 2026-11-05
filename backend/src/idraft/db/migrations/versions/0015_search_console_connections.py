"""Connecting Search Console: secrets, connections, integrations and the numbers they will hold.

Table definitions follow docs/04-data-model.md sections 10 and 11.1 and docs/18-first-party-
integrations.md section 12 (plan `docs/superpowers/plans/2026-11-04-search-console-clicks.md`, step
1), with these choices:

- `ops.secrets` is created here, with a workspace key and a unique `(workspace_id, id)` so that
  `fp.connections` can name its secret together with its workspace. A secret whose workspace is
  NULL is the platform's own and is invisible to the API through row-level security.
- The credential belongs to the connection (docs/18 section 3.1: re-auth and revocation live
  there). `fp.integrations` therefore has no `credential_ref`, which amendment A2 of docs/18
  still lists: two references to one secret would make the disconnect, which deletes the secret,
  break every integration's check. A non-log integration must name its connection instead.
- A project has at most one live integration per source for now (`integrations_one_live_per_
  project`), so a Domain and a URL-prefix property of one site are never both counted. The
  property is unique per workspace, as docs/04 says (open question FP-Q4).
- `fp.gsc_search_analytics` is partitioned by month on `metric_date`. A backfill reaches 16
  months back, so its partitions are prepared 17 months back instead of the default one.
- The API reads the numbers (a later step shows them) and the worker writes them; replacing a
  day is a DELETE and an INSERT, the documented exception to append-only (docs/18 section 4.4).
- The API can decrypt a refresh token (the property list and the revoke at disconnect need an
  access token), so it may read `ops.secrets`; it can create and delete a secret, never change
  one. The worker only reads.

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE ops.secrets (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    kind          text NOT NULL CHECK (kind IN ('provider_api_key', 'oauth_refresh_token',
                                                'webhook_secret', 'webhook_signing_secret')),
    ciphertext    bytea NOT NULL,
    dek_wrapped   bytea NOT NULL,
    kek_version   smallint NOT NULL CHECK (kek_version >= 1),
    fingerprint   text NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 64),
    created_at    timestamptz NOT NULL DEFAULT now(),
    rotated_at    timestamptz,
    expires_at    timestamptz,
    UNIQUE (workspace_id, id)
);

CREATE TABLE fp.connections (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id     uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    product          text NOT NULL CHECK (product IN ('gsc', 'ga4', 'bing_wmt', 'cloudflare')),
    auth_method      text NOT NULL CHECK (auth_method IN ('oauth', 'api_key', 'api_token',
                                                          'service_account')),
    subject_id       text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 255),
    subject_label    text CHECK (length(subject_label) <= 320),
    credential_ref   uuid,
    scopes           text[] NOT NULL,
    status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'reauth_required', 'revoked', 'error')),
    connected_by     uuid REFERENCES auth.users(id),
    connected_at     timestamptz NOT NULL DEFAULT now(),
    last_refresh_at  timestamptz,
    last_error_code  text,
    CHECK (status = 'revoked' OR credential_ref IS NOT NULL),
    UNIQUE (workspace_id, product, subject_id),
    UNIQUE (id, workspace_id),
    -- NO ACTION, so a disconnect clears the reference before it deletes the secret, and deleting a
    -- workspace (which removes both tables' rows in one statement) never trips the check above.
    FOREIGN KEY (workspace_id, credential_ref) REFERENCES ops.secrets (workspace_id, id)
);

CREATE TABLE fp.integrations (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id       uuid NOT NULL,
    project_id         uuid,
    kind               text NOT NULL CHECK (kind IN ('gsc', 'bing_wmt', 'ga4', 'cloudflare',
                                                     'server_logs')),
    external_account   text,
    external_property  text NOT NULL CHECK (length(external_property) BETWEEN 1 AND 2048),
    connection_id      uuid,
    scopes             text[] NOT NULL,
    status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'reauth_required', 'disabled', 'error')),
    last_success_at    timestamptz,
    last_error         text,
    backfill_state     jsonb NOT NULL DEFAULT '{}',
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT connection_required CHECK (kind = 'server_logs' OR connection_id IS NOT NULL),
    UNIQUE (workspace_id, kind, external_property),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects (id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (connection_id, workspace_id) REFERENCES fp.connections (id, workspace_id)
);

CREATE UNIQUE INDEX integrations_one_live_per_project
    ON fp.integrations (project_id, kind) WHERE status <> 'disabled';

CREATE INDEX integrations_connection ON fp.integrations (connection_id);

CREATE INDEX connections_workspace ON fp.connections (workspace_id, product);

-- Query text is tenant data, so it is scoped to the workspace (docs/18 section 12.2, A1).
CREATE TABLE fp.gsc_queries (
    workspace_id         uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    query_hash           bytea NOT NULL,
    query_text           text NOT NULL,
    normalized_text      text NOT NULL,
    matched_keyword_ids  uuid[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (workspace_id, query_hash)
);

CREATE INDEX gsc_queries_normalized ON fp.gsc_queries (workspace_id, normalized_text);

CREATE TABLE fp.gsc_search_analytics (
    integration_id  uuid NOT NULL,
    metric_date     date NOT NULL,
    search_type     text NOT NULL CHECK (search_type IN ('web', 'image', 'video', 'news',
                                                        'discover', 'googleNews')),
    query_hash      bytea NOT NULL,
    url_id          bigint NOT NULL,
    country_iso3    char(3) NOT NULL,
    device          text NOT NULL CHECK (device IN ('DESKTOP', 'MOBILE', 'TABLET')),
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    clicks          integer NOT NULL CHECK (clicks >= 0),
    impressions     integer NOT NULL CHECK (impressions >= 0),
    position_sum    numeric(14,2) NOT NULL,
    data_state      text NOT NULL CHECK (data_state IN ('final', 'all')),
    ingested_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, metric_date, search_type, query_hash, url_id, country_iso3,
                 device),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations (id, workspace_id)
        ON DELETE CASCADE
) PARTITION BY RANGE (metric_date);

-- The keyword join of docs/18 section 4.9 reads one project's rows for a window of dates.
CREATE INDEX gsc_search_analytics_project_date
    ON fp.gsc_search_analytics (project_id, metric_date);

INSERT INTO ops.partitioned_tables (parent, key_is_date, months_back)
VALUES ('fp.gsc_search_analytics', true, 17);

SELECT ops.maintain_partitions();
"""

_TENANT_TABLES = (
    "ops.secrets",
    "fp.connections",
    "fp.integrations",
    "fp.gsc_queries",
    "fp.gsc_search_analytics",
)

# What a reconnect or a disconnect changes on a connection. The identity (workspace, product,
# subject) is never changed.
_CONNECTION_API_UPDATE = (
    "subject_label",
    "credential_ref",
    "scopes",
    "status",
    "connected_by",
    "connected_at",
    "last_refresh_at",
    "last_error_code",
)
_CONNECTION_WORKER_UPDATE = ("status", "last_refresh_at", "last_error_code")
_INTEGRATION_API_UPDATE = ("external_account", "connection_id", "scopes", "status", "last_error")
_INTEGRATION_WORKER_UPDATE = ("status", "last_success_at", "last_error", "backfill_state")


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("ops.secrets", api="SELECT, INSERT, DELETE", worker="SELECT"),
        *grants("fp.connections", api="SELECT, INSERT", worker="SELECT"),
        column_grant(
            "fp.connections", role="app_api", privilege="UPDATE", columns=_CONNECTION_API_UPDATE
        ),
        column_grant(
            "fp.connections",
            role="app_worker",
            privilege="UPDATE",
            columns=_CONNECTION_WORKER_UPDATE,
        ),
        *grants("fp.integrations", api="SELECT, INSERT", worker="SELECT"),
        column_grant(
            "fp.integrations", role="app_api", privilege="UPDATE", columns=_INTEGRATION_API_UPDATE
        ),
        column_grant(
            "fp.integrations",
            role="app_worker",
            privilege="UPDATE",
            columns=_INTEGRATION_WORKER_UPDATE,
        ),
        *grants("fp.gsc_queries", api="SELECT", worker="SELECT, INSERT"),
        column_grant(
            "fp.gsc_queries",
            role="app_worker",
            privilege="UPDATE",
            columns=("matched_keyword_ids",),
        ),
        *grants("fp.gsc_search_analytics", api="SELECT", worker="SELECT, INSERT, DELETE"),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute(
        "DELETE FROM ops.partitioned_tables WHERE parent = 'fp.gsc_search_analytics'::regclass"
    )
    op.execute(
        "DROP TABLE fp.gsc_search_analytics, fp.gsc_queries, fp.integrations, fp.connections, "
        "ops.secrets"
    )
