"""Runtime roles may use the schemas and read the schema revision.

The roles themselves are created by infra/compose/postgres/initdb/10-roles.sh when the database is
first initialised; from this revision on, migrations grant to them. `app_api` must be able to read
`ops.alembic_version`, because /api/readyz reports whether the schema is current.

Revision ID: 0002
Revises: 0001
"""

from __future__ import annotations

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

SCHEMAS = ("auth", "core", "seo", "ai", "fp", "ops")
RUNTIME_ROLES = ("app_api", "app_worker")

_REQUIRE_ROLES = """
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(name, ', ') INTO missing
    FROM unnest(ARRAY['app_api', 'app_worker', 'backup']) AS name
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = name);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'database roles are missing: %', missing
            USING HINT = 'Initialise the cluster with infra/compose/postgres/initdb/10-roles.sh.';
    END IF;
END $$
"""


def upgrade() -> None:
    op.execute(_REQUIRE_ROLES)
    roles = ", ".join(RUNTIME_ROLES)
    for schema in SCHEMAS:
        op.execute(f"GRANT USAGE ON SCHEMA {schema} TO {roles}")
    op.execute(f"GRANT SELECT ON ops.alembic_version TO {roles}")


def downgrade() -> None:
    roles = ", ".join(RUNTIME_ROLES)
    op.execute(f"REVOKE SELECT ON ops.alembic_version FROM {roles}")
    for schema in SCHEMAS:
        op.execute(f"REVOKE USAGE ON SCHEMA {schema} FROM {roles}")
