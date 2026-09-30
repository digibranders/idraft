"""Table metadata the application builds its statements from.

Migrations are the source of truth and are written as SQL. This module restates the columns so
queries are composed and typed instead of written as strings. tests/db/test_tables.py compares it
with the migrated schema: column names, types, nullability, primary keys, unique constraints,
foreign keys, and which columns have a database default.

Columns with a database default are marked `FetchedValue()`: inserts leave them out and the
database fills them in. Default expressions, indexes and CHECK constraints are not restated here.
A table is declared when the application first reads or writes it.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    FetchedValue,
    ForeignKey,
    Integer,
    LargeBinary,
    MetaData,
    SmallInteger,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT, INET, JSONB

metadata = MetaData()


def _id() -> Column[UUID]:
    return Column("id", Uuid, primary_key=True, server_default=FetchedValue())


def _created_at() -> Column[datetime]:
    return Column(
        "created_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()
    )


users = Table(
    "users",
    metadata,
    _id(),
    Column("email", CITEXT, nullable=False),
    Column("name", Text, nullable=False),
    Column("image", Text),
    Column("password_hash", Text, nullable=False),
    Column("email_verified_at", DateTime(timezone=True)),
    Column("is_platform_operator", Boolean, nullable=False, server_default=FetchedValue()),
    Column("disabled_at", DateTime(timezone=True)),
    _created_at(),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    UniqueConstraint("email", name="users_email_key"),
    schema="auth",
)

workspaces = Table(
    "workspaces",
    metadata,
    _id(),
    Column("name", Text, nullable=False),
    Column("slug", CITEXT, nullable=False),
    Column("logo", Text),
    Column("metadata", Text),
    Column("plan_code", Text, nullable=False, server_default=FetchedValue()),
    Column("timezone", Text, nullable=False, server_default=FetchedValue()),
    Column("status", Text, nullable=False, server_default=FetchedValue()),
    Column("purge_after", DateTime(timezone=True)),
    _created_at(),
    UniqueConstraint("slug", name="workspaces_slug_key"),
    schema="auth",
)

memberships = Table(
    "memberships",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    Column("user_id", Uuid, ForeignKey(users.c.id, ondelete="CASCADE"), nullable=False),
    Column("role", Text, nullable=False),
    Column("project_ids", ARRAY(Uuid)),
    _created_at(),
    UniqueConstraint("workspace_id", "user_id", name="memberships_workspace_id_user_id_key"),
    schema="auth",
)

sessions = Table(
    "sessions",
    metadata,
    _id(),
    Column("token_hash", LargeBinary, nullable=False),
    Column("user_id", Uuid, ForeignKey(users.c.id, ondelete="CASCADE"), nullable=False),
    Column("state", Text, nullable=False, server_default=FetchedValue()),
    Column("fresh_until", DateTime(timezone=True)),
    Column("idle_expires_at", DateTime(timezone=True), nullable=False),
    Column("absolute_expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)),
    Column("ip", INET),
    Column("user_agent", Text),
    _created_at(),
    Column("last_seen_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    UniqueConstraint("token_hash", name="sessions_token_hash_key"),
    schema="auth",
)

verification_tokens = Table(
    "verification_tokens",
    metadata,
    _id(),
    Column("user_id", Uuid, ForeignKey(users.c.id, ondelete="CASCADE"), nullable=False),
    Column("purpose", Text, nullable=False),
    Column("token_hash", LargeBinary, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("consumed_at", DateTime(timezone=True)),
    _created_at(),
    UniqueConstraint("token_hash", name="verification_tokens_token_hash_key"),
    schema="auth",
)

totp_secrets = Table(
    "totp_secrets",
    metadata,
    Column("user_id", Uuid, ForeignKey(users.c.id, ondelete="CASCADE"), primary_key=True),
    Column("secret_encrypted", LargeBinary, nullable=False),
    Column("confirmed_at", DateTime(timezone=True)),
    Column("last_used_step", BigInteger),
    Column("recovery_code_hashes", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    _created_at(),
    schema="auth",
)

invitations = Table(
    "invitations",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    Column("email", CITEXT, nullable=False),
    Column("role", Text, nullable=False),
    Column("project_ids", ARRAY(Uuid)),
    Column("token_hash", LargeBinary, nullable=False),
    Column("status", Text, nullable=False, server_default=FetchedValue()),
    Column("invited_by", Uuid, ForeignKey(users.c.id), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("responded_at", DateTime(timezone=True)),
    _created_at(),
    UniqueConstraint("token_hash", name="invitations_token_hash_key"),
    schema="auth",
)

projects = Table(
    "projects",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="RESTRICT"), nullable=False),
    Column("name", Text, nullable=False),
    Column("slug", CITEXT, nullable=False),
    # The foreign key arrives with core.domains (Phase 2).
    Column("primary_domain_id", Integer),
    Column("default_location_id", Integer),
    Column("default_language_code", Text),
    Column("timezone", Text, nullable=False, server_default=FetchedValue()),
    Column("deep_check_weekday", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("status", Text, nullable=False, server_default=FetchedValue()),
    Column("settings", JSONB, nullable=False, server_default=FetchedValue()),
    Column("data_version", BigInteger, nullable=False, server_default=FetchedValue()),
    Column("entity_config_version", Integer, nullable=False, server_default=FetchedValue()),
    Column("created_by", Uuid, ForeignKey(users.c.id)),
    _created_at(),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    Column("deleted_at", DateTime(timezone=True)),
    UniqueConstraint("workspace_id", "slug", name="projects_workspace_id_slug_key"),
    schema="core",
)

workspace_quotas = Table(
    "workspace_quotas",
    metadata,
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), primary_key=True),
    Column("max_projects", Integer, nullable=False, server_default=FetchedValue()),
    Column("max_tracked_keywords", Integer, nullable=False, server_default=FetchedValue()),
    Column("max_active_prompts", Integer, nullable=False, server_default=FetchedValue()),
    Column("max_ai_observations_per_month", Integer, nullable=False, server_default=FetchedValue()),
    Column("max_serp_checks_per_month", Integer, nullable=False, server_default=FetchedValue()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    schema="core",
)

audit_logs = Table(
    "audit_logs",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("occurred_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    Column("workspace_id", Uuid),
    Column("actor_type", Text, nullable=False),
    Column("actor_id", Text, nullable=False),
    Column("action", Text, nullable=False),
    Column("target_type", Text, nullable=False),
    Column("target_id", Text, nullable=False),
    # Python None is stored as SQL NULL, not as the JSON value null: "nothing before" is no value.
    Column("before", JSONB(none_as_null=True)),
    Column("after", JSONB(none_as_null=True)),
    Column("ip", INET),
    Column("user_agent", Text),
    Column("request_id", Text),
    schema="ops",
)
