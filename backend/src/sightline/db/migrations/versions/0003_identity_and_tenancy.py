"""Identity and tenancy: users, sessions, workspaces, memberships, projects, quotas.

Table definitions follow docs/04-data-model.md section 4. `core.projects.primary_domain_id` has no
foreign key yet: `core.domains` arrives with the entities revision, which adds the constraint.

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

from alembic import op

from sightline.db.ddl import grants, statements, tenant_isolation

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

ROLES = "('owner','admin','editor','analyst','viewer','billing')"

# The settings are per transaction (set_config(..., true)). After such a transaction PostgreSQL
# leaves a custom setting as an empty string on the pooled connection, hence NULLIF.
_SETTING_FUNCTIONS = """
CREATE FUNCTION auth.current_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    RETURN NULLIF(current_setting('app.workspace_id', true), '')::uuid;

CREATE FUNCTION auth.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;
"""

_TABLES = f"""
CREATE TABLE auth.users (
    id                    uuid PRIMARY KEY DEFAULT uuidv7(),
    email                 citext NOT NULL UNIQUE,
    name                  text NOT NULL,
    image                 text,
    password_hash         text NOT NULL,
    email_verified_at     timestamptz,
    is_platform_operator  boolean NOT NULL DEFAULT false,
    disabled_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.workspaces (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    name         text NOT NULL,
    slug         citext NOT NULL UNIQUE,
    logo         text,
    metadata     text,
    plan_code    text NOT NULL DEFAULT 'internal',
    timezone     text NOT NULL DEFAULT 'UTC',
    status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleting')),
    purge_after  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.memberships (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role          text NOT NULL CHECK (role IN {ROLES}),
    project_ids   uuid[],
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX ON auth.memberships (user_id);

CREATE TABLE auth.sessions (
    id                   uuid PRIMARY KEY DEFAULT uuidv7(),
    token_hash           bytea NOT NULL UNIQUE,
    user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    state                text NOT NULL DEFAULT 'active' CHECK (state IN ('pending_totp','active')),
    fresh_until          timestamptz,
    idle_expires_at      timestamptz NOT NULL,
    absolute_expires_at  timestamptz NOT NULL,
    revoked_at           timestamptz,
    ip                   inet,
    user_agent           text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    last_seen_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON auth.sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth.verification_tokens (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    purpose       text NOT NULL CHECK (purpose IN ('email_verification','password_reset')),
    token_hash    bytea NOT NULL UNIQUE,
    expires_at    timestamptz NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON auth.verification_tokens (user_id, purpose) WHERE consumed_at IS NULL;

CREATE TABLE auth.totp_secrets (
    user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    secret_encrypted      bytea NOT NULL,
    confirmed_at          timestamptz,
    last_used_step        bigint,
    recovery_code_hashes  text[] NOT NULL DEFAULT '{{}}',
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.invitations (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    email         citext NOT NULL,
    role          text NOT NULL CHECK (role IN {ROLES}),
    project_ids   uuid[],
    token_hash    bytea NOT NULL UNIQUE,
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
    invited_by    uuid NOT NULL REFERENCES auth.users(id),
    expires_at    timestamptz NOT NULL,
    responded_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON auth.invitations (workspace_id, email) WHERE status = 'pending';

-- Deferred: no routes in V1. The table exists so API keys can ship without a migration.
CREATE TABLE auth.api_keys (
    id                     uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id           uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    name                   text NOT NULL,
    prefix                 text NOT NULL UNIQUE,
    key_hash               bytea NOT NULL,
    scopes                 text[] NOT NULL,
    expires_at             timestamptz,
    ip_allowlist           cidr[] NOT NULL DEFAULT '{{}}',
    rate_limit_per_minute  integer NOT NULL DEFAULT 120
                           CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
    last_used_at           timestamptz,
    last_used_ip           inet,
    created_by             uuid NOT NULL REFERENCES auth.users(id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    revoked_at             timestamptz
);

CREATE INDEX ON auth.api_keys (workspace_id);

CREATE TABLE core.projects (
    id                     uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id           uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE RESTRICT,
    name                   text NOT NULL,
    slug                   citext NOT NULL,
    primary_domain_id      integer,
    default_location_id    integer,
    default_language_code  text,
    timezone               text NOT NULL DEFAULT 'UTC',
    deep_check_weekday     smallint NOT NULL DEFAULT 1 CHECK (deep_check_weekday BETWEEN 0 AND 6),
    status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','paused','archived')),
    settings               jsonb NOT NULL DEFAULT '{{}}'::jsonb,
    data_version           bigint NOT NULL DEFAULT 0,
    entity_config_version  integer NOT NULL DEFAULT 1,
    created_by             uuid REFERENCES auth.users(id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    deleted_at             timestamptz,
    UNIQUE (workspace_id, slug)
);

CREATE INDEX ON core.projects (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE core.workspace_quotas (
    workspace_id                   uuid PRIMARY KEY
                                   REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    max_projects                   integer NOT NULL DEFAULT 10,
    max_tracked_keywords           integer NOT NULL DEFAULT 5000,
    max_active_prompts             integer NOT NULL DEFAULT 1000,
    max_ai_observations_per_month  integer NOT NULL DEFAULT 20000,
    max_serp_checks_per_month      integer NOT NULL DEFAULT 200000,
    updated_at                     timestamptz NOT NULL DEFAULT now()
);
"""

# Accepting an invitation happens before the user belongs to the workspace, so the policy on
# auth.invitations would hide the row. This returns that one invitation and nothing else.
_INVITATION_LOOKUP = """
CREATE FUNCTION auth.invitation_by_token(p_token_hash bytea) RETURNS SETOF auth.invitations
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        SELECT i.* FROM auth.invitations i WHERE i.token_hash = p_token_hash;
    END;

REVOKE ALL ON FUNCTION auth.invitation_by_token(bytea) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.invitation_by_token(bytea) TO app_api;
"""

# Before a workspace is chosen (the workspace switcher), a user may read their own memberships and
# the workspaces those belong to. The subquery runs under the memberships policy, which shows a
# user exactly their own rows. Writing still requires the workspace setting.
_OWN_MEMBERSHIP = "user_id = auth.current_user_id()"
_OWN_WORKSPACE = (
    "id IN (SELECT m.workspace_id FROM auth.memberships m WHERE m.user_id = auth.current_user_id())"
)

_CRUD = "SELECT, INSERT, UPDATE, DELETE"
_AUTH_TABLES = (
    "auth.users",
    "auth.sessions",
    "auth.verification_tokens",
    "auth.totp_secrets",
    "auth.workspaces",
    "auth.memberships",
    "auth.invitations",
    "auth.api_keys",
)


def upgrade() -> None:
    script = [
        *statements(_SETTING_FUNCTIONS),
        *statements(_TABLES),
        *statements(_INVITATION_LOOKUP),
        *tenant_isolation("auth.workspaces", column="id", also_visible_when=_OWN_WORKSPACE),
        *tenant_isolation("auth.memberships", also_visible_when=_OWN_MEMBERSHIP),
        *tenant_isolation("auth.invitations"),
        *tenant_isolation("auth.api_keys"),
        *tenant_isolation("core.projects"),
        *tenant_isolation("core.workspace_quotas"),
    ]
    for table in _AUTH_TABLES:
        script += grants(table, api=_CRUD, worker="SELECT")
    script += grants("core.projects", api=_CRUD, worker="SELECT, UPDATE")
    script += grants("core.workspace_quotas", api="SELECT, INSERT, UPDATE", worker="SELECT")
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute("DROP TABLE core.workspace_quotas, core.projects")
    op.execute("DROP FUNCTION auth.invitation_by_token(bytea)")
    op.execute(
        "DROP TABLE auth.api_keys, auth.invitations, auth.totp_secrets, "
        "auth.verification_tokens, auth.sessions, auth.memberships CASCADE"
    )
    op.execute("DROP TABLE auth.workspaces, auth.users")
    op.execute("DROP FUNCTION auth.current_user_id(), auth.current_workspace_id()")
