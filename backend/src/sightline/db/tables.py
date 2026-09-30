"""Table metadata the application builds its statements from.

Migrations are the source of truth and are written as SQL. This module restates the columns so
queries are composed and typed instead of written as strings, and a test compares it with the
migrated schema (tests/db/test_tables.py), so the two cannot drift apart.

Columns with a database default are marked `FetchedValue()`: inserts leave them out and the
database fills them in. Indexes and CHECK constraints are not restated here.
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
    LargeBinary,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT, INET

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
