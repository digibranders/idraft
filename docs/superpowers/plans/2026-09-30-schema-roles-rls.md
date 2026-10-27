# Schema, Roles and Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Phase 1 tables exist, owned by a non-superuser `migrator`; the API connects as `app_api` and can only see the workspace it set for the transaction; the worker connects as `app_worker`; partitioned tables maintain their own monthly partitions; and a test suite proves all of it against PostgreSQL 18 with the real roles.

**Architecture:** One shell script creates the four roles when a PostgreSQL data directory is first initialised, and the same script is mounted into the test container, the development stack, the image smoke test and production. Tables, policies and grants are Alembic revisions written as SQL. Every table with a `workspace_id` column gets a `tenant_isolation` policy built from two helper functions that read per-transaction settings. No runtime role can run DDL: the worker reaches partition creation through one `SECURITY DEFINER` function that works from a registry table.

**Tech Stack:** PostgreSQL 18 (`uuidv7()`, declarative partitioning, row-level security), Alembic, asyncpg, pytest with Testcontainers.

**Source documents:** `docs/04-data-model.md` sections 2, 4, 4.1, 11.1 to 11.4, 11.7, 12 and 13; `docs/22-infrastructure-devops.md` section 4.2; `docs/26-testing-quality.md` section 5 (cases DB-RLS-01 to 03, DB-GRANT-01, DB-PART-01 to 04, DB-CON-01); `docs/29-phase-roadmap.md` Phase 1; review-log items F1 and F2.

**Out of scope:** SQLAlchemy models and the model-versus-schema drift check (they arrive with the first code that needs them, plan 3); `ops.secrets` (Phase 12); `ops.fetch_cache` (Phase 11); `ops.slo_samples` and `ops.task_attempts` (with the worker, plan 4); retention drops (maintenance plan); the price book rows (Phase 0 spikes).

**Table DDL:** the `CREATE TABLE` statements are the ones in doc 04, copied into the revisions unchanged except for the deviations listed here. Everything the doc does not spell out (helper functions, policies, grants, the partition registry, the three tables the doc gives only as comments) is written in full in the tasks below.

| Deviation from doc 04 | Why |
|---|---|
| `auth.workspaces`, `auth.memberships`, `auth.api_keys` get real DDL (Task 3) | The doc carried them as comments from the Better Auth era |
| `core.projects.primary_domain_id` is created without its foreign key | `core.domains` is a Phase 2 table; the Phase 2 migration adds the constraint |
| Policies call `auth.current_workspace_id()` instead of repeating the `NULLIF(current_setting(...))` expression | One definition; the function is `STABLE` SQL and is inlined |
| `auth.memberships` and `auth.workspaces` are also visible to their own user through `auth.current_user_id()` | "List my workspaces" runs before any workspace is chosen |
| `ops.maintain_partitions()` (no arguments, registry-driven) is the `SECURITY DEFINER` entry point; `ops.ensure_monthly_partitions(regclass, ...)` is not callable by runtime roles | A definer function that takes any table name would let the worker create partitions anywhere |
| New partitions get the autovacuum settings of section 12.3 inside the function | The doc asked for it at creation |

**Grant matrix (the contract the tests check):**

| Table | `app_api` | `app_worker` |
|---|---|---|
| `auth.users`, `auth.sessions`, `auth.verification_tokens`, `auth.totp_secrets`, `auth.workspaces`, `auth.memberships`, `auth.invitations`, `auth.api_keys` | SELECT, INSERT, UPDATE, DELETE | SELECT |
| `core.projects` | SELECT, INSERT, UPDATE, DELETE | SELECT, UPDATE |
| `core.workspace_quotas` | SELECT, INSERT, UPDATE | SELECT |
| `ops.budgets` | SELECT, INSERT, UPDATE, DELETE | SELECT |
| `ops.providers`, `ops.component_versions`, `ops.partitioned_tables` | SELECT | SELECT |
| `ops.provider_price_book` | SELECT | SELECT, INSERT, UPDATE |
| `ops.schedules` | SELECT, INSERT, UPDATE, DELETE | SELECT, UPDATE |
| `ops.collection_runs` | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| `ops.collection_tasks` | SELECT | SELECT, INSERT, UPDATE |
| `ops.raw_payloads` | SELECT | SELECT, INSERT, UPDATE |
| `ops.provider_cost_events` | SELECT | SELECT, INSERT |
| `ops.cost_daily` | SELECT | SELECT, INSERT, UPDATE |
| `ops.audit_logs` | SELECT, INSERT | SELECT, INSERT |
| `ops.alembic_version` | SELECT | SELECT |

Both roles get `USAGE` on the six schemas. Neither gets `CREATE` anywhere, `TRUNCATE`, or `REFERENCES`. `backup` reads everything through `pg_read_all_data`.

**Execution notes (2026-09-30), where the build differs from the text below:**

- **Revision numbers.** The plan says `0002` (identity) and `0003` (operations). The build has `0002_runtime_role_access` (schema `USAGE`, `SELECT` on `ops.alembic_version`, and the check that the roles exist), `0003_identity_and_tenancy` and `0004_operations`. Read every `0002` below as `0003` and every `0003` as `0004`.
- **Grant matrix.** The table above was the first draft. An independent review showed it was too wide, and it was replaced by table and column grants. The contract in force is `docs/04-data-model.md` section 13.1, checked by `backend/tests/db/test_grants.py` and `test_least_privilege.py`.
- **Statement splitting.** asyncpg sends one statement per call, so `idraft.db.ddl.statements()` splits a script at blank lines. A revision script separates statements with an empty line and has none inside a function body.
- **Partition functions.** `ops.ensure_monthly_partitions` locks `ops.partitioned_tables` (a lock no runtime role can take), has `lock_timeout = '5s'` and builds names with `format('%I.%I')`; `ops.maintain_partitions` skips registry rows whose table is gone.
- **Scoped transactions.** `workspace_transaction` and `user_transaction` write both settings in one statement, the unused one as an empty string.
- **Lint.** ruff rule `S608` is on for application code.
- **Findings and what was carried forward:** `docs/review-log.md`, "Schema, roles and tenant isolation".

**Shell note for this machine:** `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"` before Docker and test commands. Run the gates with `backend/check.sh`.

---

## File structure

```
infra/compose/postgres/initdb/10-roles.sh     the four roles, database ownership, pg_stat_statements
infra/compose/docker-compose.dev.yml          mounts the script, passes the role passwords
backend/.env.example                          DATABASE_URL is the app_api role
backend/smoke.sh                              migrates as migrator, serves as app_api
backend/README.md                             migrate command with the migrator URL
backend/src/idraft/db/ddl.py               SQL builders used by revisions: grants, tenant policies
backend/src/idraft/db/engine.py            user_transaction(); workspace_transaction(user_id=)
backend/src/idraft/db/migrations/versions/0002_identity_and_tenancy.py
backend/src/idraft/db/migrations/versions/0003_operations.py
backend/tests/conftest.py                     PostgresServer fixture with role URLs and database factory
backend/tests/db/seed.py                      one row per tenant table for a workspace
backend/tests/db/test_roles.py                role attributes, migration as a non-superuser
backend/tests/db/test_ddl.py                  the SQL builders
backend/tests/db/test_rls.py                  DB-RLS-01 to 03, user visibility, worker bypass
backend/tests/db/test_grants.py               DB-GRANT-01 and the grant matrix
backend/tests/db/test_partitions.py           DB-PART-01 to 04
backend/tests/db/test_constraints.py          DB-CON-01 and the uniqueness rules of Phase 1
```

---

### Task 1: Role bootstrap and role-aware test fixtures

**Files:** create `infra/compose/postgres/initdb/10-roles.sh`; rewrite the PostgreSQL fixtures in `backend/tests/conftest.py`; create `backend/tests/db/test_roles.py`; adapt `tests/db/test_migrations.py`, `tests/db/test_probe.py`, `tests/api/test_health.py` to the new fixtures.

- [ ] **Step 1: Write `10-roles.sh`**

```bash
#!/usr/bin/env bash
# Runs once, as the PostgreSQL superuser, when the data directory is first initialised
# (docker-entrypoint-initdb.d). Creates the four roles of ADR-022 and hands the database to
# `migrator`. Used unchanged by production, the development stack, the image smoke test and the
# test suite, so a role can never differ between them.
set -euo pipefail
: "${PG_MIGRATOR_PASSWORD:?}" "${PG_API_PASSWORD:?}" "${PG_WORKER_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$PG_MIGRATOR_PASSWORD" \
  -v api_password="$PG_API_PASSWORD" \
  -v worker_password="$PG_WORKER_PASSWORD" \
  -v database="$POSTGRES_DB" <<'SQL'
-- migrator owns every schema and table and runs Alembic. Not a superuser.
CREATE ROLE migrator LOGIN PASSWORD :'migrator_password';
ALTER ROLE migrator SET lock_timeout = '2s';
ALTER ROLE migrator SET statement_timeout = '15min';

-- app_api serves users and is subject to row-level security.
CREATE ROLE app_api LOGIN NOBYPASSRLS PASSWORD :'api_password';
ALTER ROLE app_api SET statement_timeout = '15s';

-- app_worker plans, dispatches and maintains across workspaces. Never reachable from a request.
CREATE ROLE app_worker LOGIN BYPASSRLS PASSWORD :'worker_password';
ALTER ROLE app_worker SET statement_timeout = '120s';
GRANT pg_read_all_stats TO app_worker;

-- backup connects over the Unix socket with peer authentication, so it has no password.
CREATE ROLE backup LOGIN BYPASSRLS;
GRANT pg_read_all_data TO backup;

ALTER DATABASE :"database" OWNER TO migrator;
REVOKE ALL ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO app_api, app_worker, backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Not a trusted extension, so the superuser creates it; migrations create the trusted ones.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
```

Make it executable (`chmod +x`).

- [ ] **Step 2: Replace the PostgreSQL fixtures**

`PostgresServer` is a frozen dataclass holding `host`, `port`, `database`, and the superuser name and password, with:

```python
ROLE_PASSWORDS = {"migrator": "migrator-pw", "app_api": "api-pw", "app_worker": "worker-pw"}

def url(self, role: str = "superuser", database: str | None = None) -> str: ...
async def create_database(self, name: str) -> str:
    """Drop and create `name`, owned by migrator, with the same connect grants as the init script."""
```

The session fixture `pg` starts `postgres:18` with `infra/compose/postgres/initdb` mounted read-only at `/docker-entrypoint-initdb.d` and the three `PG_*_PASSWORD` variables set. `postgres_url` stays the superuser URL (engine tests create scratch tables). `migrated` runs `upgrade_to_head(pg.url("migrator"))` once. `app_settings` uses `pg.url("app_api")`.

- [ ] **Step 3: Write `tests/db/test_roles.py` (failing first)**

```python
ATTRIBUTES = {
    # role: (superuser, bypassrls, createdb, createrole)
    "migrator": (False, False, False, False),
    "app_api": (False, False, False, False),
    "app_worker": (False, True, False, False),
    "backup": (False, True, False, False),
}

async def test_roles_have_exactly_the_attributes_of_adr_022(pg) -> None: ...   # pg_roles
async def test_role_statement_timeouts(pg) -> None: ...                        # pg_db_role_setting via rolconfig
async def test_the_database_belongs_to_migrator(pg) -> None: ...               # pg_database.datdba
def test_migrations_run_as_a_non_superuser(pg) -> None: ...                    # fresh database, upgrade as migrator
async def test_runtime_roles_cannot_connect_as_each_other(pg) -> None: ...     # wrong password is rejected
```

- [ ] **Step 4: Run; adapt the existing tests to `pg`; all gates green**
- [ ] **Step 5: Commit** `Create the four database roles from one script and test as them`

---

### Task 2: SQL builders for grants and tenant policies

**Files:** create `backend/src/idraft/db/ddl.py`, `backend/tests/db/test_ddl.py`.

- [ ] **Step 1: Failing tests**

```python
def test_grant_statements_per_role() -> None:
    assert grants("core.projects", api="SELECT, INSERT", worker="SELECT") == [
        "GRANT SELECT, INSERT ON core.projects TO app_api",
        "GRANT SELECT ON core.projects TO app_worker",
    ]

def test_a_role_without_privileges_gets_no_statement() -> None:
    assert grants("ops.collection_tasks", api="SELECT") == ["GRANT SELECT ON ops.collection_tasks TO app_api"]

def test_tenant_isolation_uses_the_workspace_helper_for_reads_and_writes() -> None:
    assert tenant_isolation("core.projects") == [
        "ALTER TABLE core.projects ENABLE ROW LEVEL SECURITY",
        "CREATE POLICY tenant_isolation ON core.projects "
        "USING (workspace_id = auth.current_workspace_id()) "
        "WITH CHECK (workspace_id = auth.current_workspace_id())",
    ]

def test_a_table_can_widen_what_is_visible_without_widening_what_is_writable() -> None:
    statements = tenant_isolation("auth.memberships", also_visible_when="user_id = auth.current_user_id()")
    assert "USING (workspace_id = auth.current_workspace_id() OR user_id = auth.current_user_id())" in statements[1]
    assert statements[1].endswith("WITH CHECK (workspace_id = auth.current_workspace_id())")

def test_the_tenant_column_can_be_named() -> None:
    assert "USING (id = auth.current_workspace_id()" in tenant_isolation("auth.workspaces", column="id")[1]

@pytest.mark.parametrize("name", ["projects; DROP TABLE x", "core.projects x", "Core.Projects", ""])
def test_identifiers_are_validated(name: str) -> None:
    with pytest.raises(ValueError): tenant_isolation(name)
```

- [ ] **Step 2: Implement**

```python
"""SQL builders for Alembic revisions: grants and tenant isolation.

Applied revisions call these, so their output is frozen history. Change behaviour by adding a new
function, never by editing one that a revision already used.
"""
from __future__ import annotations
import re

API_ROLE = "app_api"
WORKER_ROLE = "app_worker"
POLICY_NAME = "tenant_isolation"
_QUALIFIED_NAME = re.compile(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*")
_IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*")

def _table(name: str) -> str:
    if not _QUALIFIED_NAME.fullmatch(name):
        raise ValueError(f"expected schema.table in lower case, got {name!r}")
    return name

def grants(table: str, *, api: str = "", worker: str = "") -> list[str]:
    table = _table(table)
    return [f"GRANT {privileges} ON {table} TO {role}"
            for role, privileges in ((API_ROLE, api), (WORKER_ROLE, worker)) if privileges]

def tenant_isolation(table: str, *, column: str = "workspace_id", also_visible_when: str | None = None) -> list[str]:
    table = _table(table)
    if not _IDENTIFIER.fullmatch(column):
        raise ValueError(f"expected a lower-case column name, got {column!r}")
    owned = f"{column} = auth.current_workspace_id()"
    visible = f"{owned} OR {also_visible_when}" if also_visible_when else owned
    return [f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
            f"CREATE POLICY {POLICY_NAME} ON {table} USING ({visible}) WITH CHECK ({owned})"]
```

- [ ] **Step 3: Gates green; commit** `Add SQL builders for grants and tenant isolation`

---

### Task 3: Revision 0002, identity and tenancy

**Files:** create `versions/0002_identity_and_tenancy.py`; create `tests/db/seed.py`, `tests/db/test_rls.py`, `tests/db/test_grants.py`, `tests/db/test_constraints.py`; extend `db/engine.py` and `tests/db/test_engine.py`.

- [ ] **Step 1: Failing tests** (each runs as the named role through `pg.url(role)`)

`test_rls.py`:

```python
async def test_every_table_with_a_workspace_column_is_isolated(pg, migrated) -> None:
    """DB-RLS-01, from the catalog: no future table can ship without its policy."""
    # information_schema.columns where column_name = 'workspace_id' in our six schemas, plus auth.workspaces;
    # each must have pg_class.relrowsecurity and a pg_policy named tenant_isolation.

async def test_without_a_workspace_the_api_sees_no_tenant_rows(...)      # DB-RLS-02
async def test_with_workspace_a_the_api_sees_only_a(...)                 # DB-RLS-02, every tenant table
async def test_the_api_cannot_write_a_row_for_another_workspace(...)     # DB-RLS-02, WITH CHECK
async def test_the_api_cannot_move_a_row_to_another_workspace(...)       # UPDATE ... SET workspace_id
async def test_the_api_cannot_turn_row_security_off(...)                 # DB-RLS-03
async def test_a_user_sees_their_memberships_and_workspaces_across_tenants(...)
async def test_a_user_does_not_see_other_members_through_the_user_setting(...)
async def test_an_invitation_is_found_by_token_without_a_workspace(...)  # auth.invitation_by_token
async def test_the_worker_sees_every_workspace(...)
async def test_backup_reads_everything_and_writes_nothing(...)
```

`test_grants.py`: the grant matrix above as a parametrized table read from `information_schema.role_table_grants`, plus `DB-GRANT-01`: no runtime role can run DDL (`CREATE TABLE core.x`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE`), and every table in the six schemas appears in the matrix (so a new table cannot ship without a decision).

`test_constraints.py`: unique workspace slug; one membership per user and workspace; one pending invitation per workspace and email; project slug unique within a workspace and reusable across workspaces; role values constrained; `uuidv7()` defaults sort by creation.

`test_engine.py`: `workspace_transaction(sessions, workspace_id, user_id=...)` sets both settings; `user_transaction(sessions, user_id)` sets only the user; both are cleared after the transaction.

- [ ] **Step 2: Write the revision.** Order: helper functions; `auth.users`; `auth.workspaces`; `auth.memberships`; `auth.sessions`; `auth.verification_tokens`; `auth.totp_secrets`; `auth.invitations`; `auth.api_keys`; `core.projects`; `core.workspace_quotas`; `auth.invitation_by_token`; policies; schema usage; grants.

```sql
CREATE FUNCTION auth.current_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    RETURN NULLIF(current_setting('app.workspace_id', true), '')::uuid;

CREATE FUNCTION auth.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;

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
    role          text NOT NULL CHECK (role IN ('owner','admin','editor','analyst','viewer','billing')),
    project_ids   uuid[],
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);
CREATE INDEX ON auth.memberships (user_id);

CREATE TABLE auth.api_keys (
    id                     uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id           uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    name                   text NOT NULL,
    prefix                 text NOT NULL UNIQUE,
    key_hash               bytea NOT NULL,
    scopes                 text[] NOT NULL,
    expires_at             timestamptz,
    ip_allowlist           cidr[] NOT NULL DEFAULT '{}',
    rate_limit_per_minute  integer NOT NULL DEFAULT 120 CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
    last_used_at           timestamptz,
    last_used_ip           inet,
    created_by             uuid NOT NULL REFERENCES auth.users(id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    revoked_at             timestamptz
);

CREATE FUNCTION auth.invitation_by_token(p_token_hash bytea) RETURNS SETOF auth.invitations
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    RETURN (SELECT i FROM auth.invitations i WHERE i.token_hash = p_token_hash);
REVOKE ALL ON FUNCTION auth.invitation_by_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.invitation_by_token(bytea) TO app_api;
```

Policies: `tenant_isolation("auth.workspaces", column="id", also_visible_when="id IN (SELECT workspace_id FROM auth.memberships WHERE user_id = auth.current_user_id())")`; `tenant_isolation("auth.memberships", also_visible_when="user_id = auth.current_user_id()")`; plain `tenant_isolation` for `auth.invitations`, `auth.api_keys`, `core.projects`, `core.workspace_quotas`.

`downgrade()` drops the ten tables and three functions (local development only).

- [ ] **Step 3: Extend the engine helpers**

```python
_SET_USER = text("SELECT set_config('app.user_id', :user_id, true)")

@asynccontextmanager
async def workspace_transaction(sessions, workspace_id: UUID, *, user_id: UUID | None = None) -> AsyncIterator[AsyncSession]:
    async with sessions() as session, session.begin():
        await session.execute(_SET_WORKSPACE, {"workspace_id": str(workspace_id)})
        if user_id is not None:
            await session.execute(_SET_USER, {"user_id": str(user_id)})
        yield session

@asynccontextmanager
async def user_transaction(sessions, user_id: UUID) -> AsyncIterator[AsyncSession]:
    """For the requests that run before a workspace is chosen, such as listing a user's workspaces."""
    async with sessions() as session, session.begin():
        await session.execute(_SET_USER, {"user_id": str(user_id)})
        yield session
```

- [ ] **Step 4: Gates green; commit** `Add identity and tenancy tables with tenant isolation`

---

### Task 4: Revision 0003, operations tables and partition maintenance

**Files:** create `versions/0003_operations.py`; create `tests/db/test_partitions.py`; extend `seed.py`, `test_rls.py`, `test_grants.py`, `test_constraints.py`.

- [ ] **Step 1: Failing tests**

`test_partitions.py`:

```python
async def test_partitions_exist_from_one_month_back_to_three_ahead(...)       # DB-PART-01
async def test_maintenance_is_idempotent(...)                                 # DB-PART-01, second call creates nothing
async def test_a_timestamp_lands_in_its_utc_month(...)                        # DB-PART-02: 2026-10-31 23:59:59.999+00 and 2026-11-01 00:00+00
async def test_bounds_are_utc_whatever_the_session_time_zone(...)             # DB-PART-03
async def test_there_is_no_default_partition(...)                             # DB-PART-04: an insert beyond the range fails
async def test_the_worker_can_maintain_partitions_but_not_create_them_freely(...)
async def test_the_api_cannot_maintain_partitions(...)
async def test_new_partitions_carry_the_autovacuum_settings(...)
```

`test_constraints.py` additions (DB-CON-01): duplicate `idempotency_key` in one partition; duplicate raw `sha256`; one budget per workspace, project and workload with `NULLS NOT DISTINCT`; one run per schedule and window.

`test_rls.py` and `test_grants.py` pick up the new tables through the catalog and the matrix.

- [ ] **Step 2: Write the revision.** Tables from doc 04 sections 11.1 (without `ops.secrets`), 4.1 (`ops.budgets`), 11.2, 11.3 (without `ops.fetch_cache`), 11.4 and 11.7, in dependency order, then:

```sql
CREATE TABLE ops.partitioned_tables (
    parent        regclass PRIMARY KEY,
    key_is_date   boolean NOT NULL DEFAULT false,
    months_back   integer NOT NULL DEFAULT 1 CHECK (months_back >= 0),
    months_ahead  integer NOT NULL DEFAULT 3 CHECK (months_ahead >= 1)
);

CREATE FUNCTION ops.ensure_monthly_partitions(
    p_parent regclass, p_months_back int DEFAULT 1, p_months_ahead int DEFAULT 3, p_key_is_date boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    m date;
    part_name text;
    parent_name text := p_parent::text;
    created integer := 0;
BEGIN
    -- Month boundaries are computed and written in UTC so the result does not depend on the session TimeZone.
    FOR m IN
        SELECT generate_series(
            date_trunc('month', (now() AT TIME ZONE 'UTC') - make_interval(months => p_months_back))::date,
            date_trunc('month', (now() AT TIME ZONE 'UTC') + make_interval(months => p_months_ahead))::date,
            interval '1 month')::date
    LOOP
        part_name := parent_name || '_p' || to_char(m, 'YYYYMM');
        IF to_regclass(part_name) IS NULL THEN
            EXECUTE format('CREATE TABLE %s PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                           part_name, parent_name,
                           CASE WHEN p_key_is_date THEN m::text ELSE m::text || ' 00:00:00+00' END,
                           CASE WHEN p_key_is_date THEN (m + interval '1 month')::date::text
                                ELSE (m + interval '1 month')::date::text || ' 00:00:00+00' END);
            EXECUTE format('ALTER TABLE %s SET (autovacuum_vacuum_insert_scale_factor = 0.05, '
                           'autovacuum_analyze_scale_factor = 0.02)', part_name);
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
    FOR entry IN SELECT * FROM ops.partitioned_tables LOOP
        created := created + ops.ensure_monthly_partitions(
            entry.parent, entry.months_back, entry.months_ahead, entry.key_is_date);
    END LOOP;
    RETURN created;
END $$;

REVOKE ALL ON FUNCTION ops.ensure_monthly_partitions(regclass, int, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.maintain_partitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.maintain_partitions() TO app_worker;

INSERT INTO ops.partitioned_tables (parent) VALUES ('ops.collection_tasks'), ('ops.provider_cost_events');
SELECT ops.maintain_partitions();
```

Policies: plain `tenant_isolation` for `ops.budgets`, `ops.schedules`, `ops.collection_runs`, `ops.collection_tasks`, `ops.provider_cost_events`, `ops.cost_daily`, `ops.audit_logs`. Rows whose `workspace_id` is NULL (platform overhead) match no workspace, so the API never sees them.

Seed `ops.providers`: `dataforseo` (collection), `internal` (internal_llm). The other codes arrive with the phase that uses them.

Grants per the matrix, including `GRANT SELECT ON ops.alembic_version TO app_api, app_worker`.

- [ ] **Step 3: Gates green; commit** `Add operations tables, monthly partition maintenance and their isolation`

---

### Task 5: Development stack, smoke test and README use the roles

**Files:** modify `infra/compose/docker-compose.dev.yml`, `backend/.env.example`, `backend/smoke.sh`, `backend/README.md`.

- [ ] **Step 1:** The dev Compose `postgres` service mounts `./postgres/initdb` at `/docker-entrypoint-initdb.d`, sets the three passwords to development values, and starts with `-c shared_preload_libraries=pg_stat_statements`. `.env.example` uses `app_api`. The README migrates with the migrator URL.
- [ ] **Step 2:** `smoke.sh` mounts the same script, migrates as `migrator`, and serves as `app_api`; it must still end with `readyz` 200.
- [ ] **Step 3:** Recreate the dev volume (`docker compose ... down -v`, then `up -d --wait`), migrate, build the image, run `smoke.sh`.
- [ ] **Step 4: Commit** `Run the development stack and the image smoke test with the real roles`

---

### Task 6: Write the schema decisions back into the docs

- [x] Doc 04: real DDL for `auth.workspaces`, `auth.memberships`, `auth.api_keys`; the two helper functions and the user-visibility policies in section 13; the partition registry and `ops.maintain_partitions()` in section 12.2; the grant matrix (new section 13.1); the deferred `primary_domain_id` foreign key.
- [x] Doc 22 section 4.2.2: the init script as built (the database is owned by `migrator`; `backup` has no password; `pg_stat_statements`); migrations never create roles.
- [x] Doc 24 sections 3.1, 4 and 12: what RLS does and does not prove; the roles that bypass it; grants as containment.
- [x] Docs 21, 26 and 31: the partition entry point and the DB test cases name what was built.
- [x] Review log: F1 and F2 closed; one row per change; the review findings; items carried forward.
- [x] Commit `Record the schema and role decisions in the docs`

---

## Self-review

| Requirement | Task |
|---|---|
| Roles `app_api`, `app_worker`, `migrator`, `backup` with the attributes of ADR-022 and doc 22 | 1 |
| Migrations run as a non-superuser owner | 1 |
| Phase 1 `auth`, `core` tables | 3 |
| Phase 1 `ops` tables, partitions, `ops.ensure_monthly_partitions` | 4 |
| RLS helper and policies on every `workspace_id` table (DB-RLS-01 to 03) | 2, 3, 4 |
| Grants: append-only audit log, no DDL at runtime (DB-GRANT-01) | 3, 4 |
| Partition behaviour (DB-PART-01 to 04) | 4 |
| Uniqueness and idempotency constraints (DB-CON-01, Phase 1 part) | 3, 4 |
| Tests run as the real roles, not a superuser (F1); readiness works as `app_api` (F2) | 1, 4 |
| Same role script in tests, dev, smoke and production | 1, 5 |
