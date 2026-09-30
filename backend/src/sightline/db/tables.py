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
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    Integer,
    LargeBinary,
    MetaData,
    Numeric,
    SmallInteger,
    Table,
    Text,
    Time,
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

budgets = Table(
    "budgets",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    # NULL: the budget covers the whole workspace.
    Column("project_id", Uuid, ForeignKey(projects.c.id, ondelete="CASCADE")),
    Column("workload", Text),
    Column("period", Text, nullable=False, server_default=FetchedValue()),
    Column("limit_usd", Numeric(14, 2), nullable=False),
    Column("soft_limit_pct", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("action_on_hard", Text, nullable=False, server_default=FetchedValue()),
    _created_at(),
    UniqueConstraint(
        "workspace_id",
        "project_id",
        "workload",
        "period",
        name="budgets_workspace_id_project_id_workload_period_key",
        postgresql_nulls_not_distinct=True,
    ),
    schema="ops",
)

schedules = Table(
    "schedules",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, ForeignKey(projects.c.id, ondelete="CASCADE"), nullable=False),
    Column("workload", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("cadence", Text, nullable=False),
    Column("cron_expr", Text),
    Column("timezone", Text, nullable=False),
    Column("window_start_local", Time, nullable=False, server_default=FetchedValue()),
    Column("window_hours", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("weekday", SmallInteger),
    Column("priority", Text, nullable=False, server_default=FetchedValue()),
    Column("provider_mode", Text, nullable=False, server_default=FetchedValue()),
    Column("selector", JSONB, nullable=False, server_default=FetchedValue()),
    Column("is_active", Boolean, nullable=False, server_default=FetchedValue()),
    Column("next_run_at", DateTime(timezone=True), nullable=False),
    Column("last_run_id", Uuid),
    _created_at(),
    schema="ops",
)

collection_runs = Table(
    "collection_runs",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("schedule_id", Uuid, ForeignKey(schedules.c.id)),
    Column("workload", Text, nullable=False),
    Column("window_start", DateTime(timezone=True), nullable=False),
    Column("window_end", DateTime(timezone=True), nullable=False),
    Column("trigger", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("status_reason", Text),
    Column("blocked_by_budget_id", Uuid, ForeignKey(budgets.c.id)),
    Column("created_by_type", Text),
    Column("created_by_id", Text),
    Column("origin_request_id", Text),
    Column("tasks_total", Integer, nullable=False, server_default=FetchedValue()),
    Column("tasks_succeeded", Integer, nullable=False, server_default=FetchedValue()),
    Column("tasks_failed", Integer, nullable=False, server_default=FetchedValue()),
    Column("estimated_cost_usd", Numeric(14, 4)),
    Column("actual_cost_usd", Numeric(14, 4)),
    Column("config_snapshot", JSONB, nullable=False),
    _created_at(),
    Column("completed_at", DateTime(timezone=True)),
    UniqueConstraint(
        "schedule_id",
        "window_start",
        name="collection_runs_schedule_id_window_start_key",
    ),
    schema="ops",
)

# Partitioned by `created_at`, which is therefore part of the key: a task is named by both.
collection_tasks = Table(
    "collection_tasks",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column(
        "created_at",
        DateTime(timezone=True),
        primary_key=True,
        nullable=False,
        server_default=FetchedValue(),
    ),
    Column("run_id", Uuid, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("workload", Text, nullable=False),
    Column("subject_type", Text, nullable=False),
    Column("subject_id", Text, nullable=False),
    Column("engine_code", Text),
    Column("location_id", Integer),
    Column("replicate_index", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("idempotency_key", LargeBinary, nullable=False),
    Column("request_fingerprint", LargeBinary, nullable=False),
    Column("provider_code", Text, nullable=False),
    Column("provider_endpoint", Text, nullable=False),
    Column("provider_task_id", Text),
    Column("scheduled_for", DateTime(timezone=True), nullable=False),
    Column("status", Text, nullable=False),
    Column("dispatched_at", DateTime(timezone=True)),
    Column("attempts", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("next_attempt_at", DateTime(timezone=True)),
    Column("submitted_at", DateTime(timezone=True)),
    Column("ready_at", DateTime(timezone=True)),
    Column("completed_at", DateTime(timezone=True)),
    Column("raw_payload_id", BigInteger),
    Column("ready_source", Text),
    Column("result_meta", JSONB(none_as_null=True)),
    Column("cost_usd", Numeric(14, 6)),
    Column("last_error_code", Text),
    Column("last_error_message", Text),
    UniqueConstraint(
        "idempotency_key", "created_at", name="collection_tasks_idempotency_key_created_at_key"
    ),
    schema="ops",
)

provider_cost_events = Table(
    "provider_cost_events",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("occurred_at", DateTime(timezone=True), primary_key=True, nullable=False),
    # NULL: platform overhead, such as a balance check.
    Column("workspace_id", Uuid),
    Column("project_id", Uuid),
    Column("provider_code", Text, nullable=False),
    Column("endpoint", Text, nullable=False),
    Column("workload", Text, nullable=False),
    Column("channel", Text, nullable=False),
    Column("run_id", Uuid),
    Column("task_id", BigInteger),
    Column("subject_type", Text),
    Column("subject_id", Text),
    Column("engine_code", Text),
    Column("request_count", Integer, nullable=False, server_default=FetchedValue()),
    Column("units", Numeric(14, 4)),
    Column("price_unit", Text),
    Column("cost_usd", Numeric(14, 6), nullable=False),
    Column("cost_source", Text, nullable=False),
    Column("billing_period", Date, nullable=False),
    schema="ops",
)
