"""Baseline: trusted extensions and the six schemas.

pg_stat_statements is created by the infrastructure init script, because it is not a trusted
extension and the migrator role is not a superuser (docs/22-infrastructure-devops.md section 4.2).

Revision ID: 0001
Revises:
"""

from __future__ import annotations

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

EXTENSIONS = ("citext", "pg_trgm", "pgcrypto", "btree_gist")
SCHEMAS = ("auth", "core", "seo", "ai", "fp", "ops")


def upgrade() -> None:
    for extension in EXTENSIONS:
        op.execute(f"CREATE EXTENSION IF NOT EXISTS {extension}")
    for schema in SCHEMAS:
        op.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")


def downgrade() -> None:
    # Local development only. `ops` stays because it holds the version table.
    for schema in ("fp", "ai", "seo", "core", "auth"):
        op.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
