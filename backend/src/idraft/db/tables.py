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
    CHAR,
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    MetaData,
    Numeric,
    PrimaryKeyConstraint,
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

# Global dictionaries (docs/04-data-model.md sections 5.1 and 5.2): no workspace, no row-level
# security, never listed by a route except the registries.
providers = Table(
    "providers",
    metadata,
    Column("code", Text, primary_key=True),
    Column("label", Text, nullable=False),
    Column("kind", Text, nullable=False),
    schema="ops",
)

domain_categories = Table(
    "domain_categories",
    metadata,
    Column("code", Text, primary_key=True),
    Column("label", Text, nullable=False),
    Column("description", Text, nullable=False),
    schema="core",
)

domains = Table(
    "domains",
    metadata,
    Column("id", Integer, primary_key=True, server_default=FetchedValue()),
    Column("host", Text, nullable=False),
    Column("registrable_domain", Text, nullable=False),
    Column("public_suffix", Text, nullable=False),
    Column("is_ip", Boolean, nullable=False, server_default=FetchedValue()),
    Column("default_category", Text, ForeignKey(domain_categories.c.code)),
    Column("category_source", Text),
    Column("category_version", SmallInteger),
    Column("first_seen_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    UniqueConstraint("host", name="domains_host_key"),
    schema="core",
)

locations = Table(
    "locations",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=False),
    Column("name", Text, nullable=False),
    Column("country_iso", CHAR(2), nullable=False),
    Column("location_type", Text, nullable=False),
    Column("parent_id", Integer, ForeignKey("core.locations.id")),
    Column("is_active", Boolean, nullable=False, server_default=FetchedValue()),
    schema="core",
)

provider_location_map = Table(
    "provider_location_map",
    metadata,
    Column("provider_code", Text, ForeignKey(providers.c.code), primary_key=True),
    Column("location_id", Integer, ForeignKey(locations.c.id), primary_key=True),
    Column("provider_value", Text, nullable=False),
    Column("supports", ARRAY(Text), nullable=False),
    schema="core",
)

projects = Table(
    "projects",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="RESTRICT"), nullable=False),
    Column("name", Text, nullable=False),
    Column("slug", CITEXT, nullable=False),
    Column("primary_domain_id", Integer, ForeignKey(domains.c.id)),
    Column("default_location_id", Integer, ForeignKey(locations.c.id)),
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
    # What tenant tables refer to, so a row can never point into another workspace.
    UniqueConstraint("id", "workspace_id", name="projects_id_workspace_id_key"),
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
    Column("project_id", Uuid, nullable=False),
    Column("workload", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("cadence", Text, nullable=False),
    Column("cron_expr", Text),
    Column("timezone", Text, nullable=False),
    Column("window_start_local", Time, nullable=False, server_default=FetchedValue()),
    Column("window_hours", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("weekday", SmallInteger),
    Column("month_day", SmallInteger),
    Column("priority", Text, nullable=False, server_default=FetchedValue()),
    Column("provider_mode", Text, nullable=False, server_default=FetchedValue()),
    Column("selector", JSONB, nullable=False, server_default=FetchedValue()),
    Column("is_active", Boolean, nullable=False, server_default=FetchedValue()),
    Column("next_run_at", DateTime(timezone=True), nullable=False),
    Column("last_run_id", Uuid),
    _created_at(),
    # A deleted schedule keeps its row, so its runs keep naming it.
    Column("deleted_at", DateTime(timezone=True)),
    UniqueConstraint("id", "workspace_id", name="schedules_id_workspace_id_key"),
    UniqueConstraint(
        "id", "project_id", "workspace_id", name="schedules_id_project_id_workspace_id_key"
    ),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        name="schedules_project_id_workspace_id_fkey",
        ondelete="CASCADE",
    ),
    schema="ops",
)

collection_runs = Table(
    "collection_runs",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("schedule_id", Uuid),
    Column("workload", Text, nullable=False),
    Column("window_start", DateTime(timezone=True), nullable=False),
    Column("window_end", DateTime(timezone=True), nullable=False),
    Column("trigger", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("status_reason", Text),
    Column("blocked_by_budget_id", Uuid, ForeignKey(budgets.c.id, ondelete="SET NULL")),
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
    ForeignKeyConstraint(
        ["schedule_id", "workspace_id"],
        [schedules.c.id, schedules.c.workspace_id],
        name="collection_runs_schedule_id_workspace_id_fkey",
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

# Verified prices, for estimates only; actual costs come from the provider.
provider_price_book = Table(
    "provider_price_book",
    metadata,
    _id(),
    Column("provider_code", Text, ForeignKey(providers.c.code), nullable=False),
    Column("endpoint", Text, nullable=False),
    Column("price_unit", Text, nullable=False),
    Column("unit_price_usd", Numeric(14, 8), nullable=False),
    Column("conditions", JSONB, nullable=False, server_default=FetchedValue()),
    Column("valid_from", Date, nullable=False),
    Column("valid_to", Date),
    Column("source_url", Text, nullable=False),
    Column("verified_at", Date, nullable=False),
    schema="ops",
)

# Cost events per day, rolled up hourly (docs/27-cost-model.md section 10.1).
cost_daily = Table(
    "cost_daily",
    metadata,
    Column("cost_date", Date, primary_key=True),
    Column("workspace_id", Uuid, primary_key=True),
    Column("project_id", Uuid, primary_key=True),
    Column("provider_code", Text, primary_key=True),
    Column("endpoint", Text, primary_key=True),
    Column("workload", Text, primary_key=True),
    Column("engine_code", Text, primary_key=True, server_default=FetchedValue()),
    Column("request_count", BigInteger, nullable=False),
    Column("cost_usd", Numeric(14, 6), nullable=False),
    Column("subjects", Integer, nullable=False),
    schema="ops",
)

raw_payloads = Table(
    "raw_payloads",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("storage", Text, nullable=False),
    Column("object_key", Text),
    Column("inline_body", LargeBinary),
    Column("sha256", LargeBinary, nullable=False),
    Column("bytes_raw", Integer, nullable=False),
    Column("bytes_stored", Integer, nullable=False),
    Column("compression", Text, nullable=False),
    Column("content_type", Text, nullable=False),
    Column("provider_code", Text, nullable=False),
    Column("provider_endpoint", Text, nullable=False),
    Column("provider_schema_hint", Text),
    Column("fetched_at", DateTime(timezone=True), nullable=False),
    Column("retention_class", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True)),
    UniqueConstraint("retention_class", "sha256", name="raw_payloads_retention_class_sha256_key"),
    schema="ops",
)

# Entities (docs/04-data-model.md section 6). Each refers to its parents through
# (id, workspace_id), so no row can point into another workspace.
entities = Table(
    "entities",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    Column("entity_type", Text, nullable=False),
    Column("canonical_name", Text, nullable=False),
    Column("parent_entity_id", Uuid),
    Column("description", Text),
    Column("is_ambiguous", Boolean, nullable=False, server_default=FetchedValue()),
    Column("disambiguation_hints", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    _created_at(),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    UniqueConstraint("id", "workspace_id", name="entities_id_workspace_id_key"),
    ForeignKeyConstraint(
        ["parent_entity_id", "workspace_id"], ["core.entities.id", "core.entities.workspace_id"]
    ),
    schema="core",
)

entity_aliases = Table(
    "entity_aliases",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("entity_id", Uuid, nullable=False),
    Column("alias", Text, nullable=False),
    Column("match_mode", Text, nullable=False, server_default=FetchedValue()),
    Column("case_sensitive", Boolean, nullable=False, server_default=FetchedValue()),
    Column("language_code", Text),
    Column("is_negative", Boolean, nullable=False, server_default=FetchedValue()),
    Column("requires_context", Boolean, nullable=False, server_default=FetchedValue()),
    Column("created_by", Uuid, ForeignKey(users.c.id, ondelete="SET NULL")),
    _created_at(),
    UniqueConstraint(
        "entity_id",
        "alias",
        "match_mode",
        "is_negative",
        name="entity_aliases_entity_id_alias_match_mode_is_negative_key",
    ),
    ForeignKeyConstraint(
        ["entity_id", "workspace_id"],
        [entities.c.id, entities.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="core",
)

entity_domains = Table(
    "entity_domains",
    metadata,
    _id(),
    Column("entity_id", Uuid, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("domain_id", Integer, ForeignKey(domains.c.id), nullable=False),
    Column("match_scope", Text, nullable=False, server_default=FetchedValue()),
    Column("path_prefix", Text),
    UniqueConstraint(
        "entity_id",
        "domain_id",
        "match_scope",
        "path_prefix",
        name="entity_domains_entity_id_domain_id_match_scope_path_prefix_key",
        postgresql_nulls_not_distinct=True,
    ),
    ForeignKeyConstraint(
        ["entity_id", "workspace_id"],
        [entities.c.id, entities.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="core",
)

project_entities = Table(
    "project_entities",
    metadata,
    Column("project_id", Uuid, primary_key=True),
    Column("entity_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("role", Text, nullable=False),
    Column("is_primary", Boolean, nullable=False, server_default=FetchedValue()),
    Column("track_seo", Boolean, nullable=False, server_default=FetchedValue()),
    Column("track_ai", Boolean, nullable=False, server_default=FetchedValue()),
    Column("color_index", SmallInteger),
    Column("added_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    Column("removed_at", DateTime(timezone=True)),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    # No cascade: a role keeps the entity it names alive.
    ForeignKeyConstraint(["entity_id", "workspace_id"], [entities.c.id, entities.c.workspace_id]),
    schema="core",
)

# A view, read with the reader's rights: the base tables' policies apply to it.
project_domain_roles = Table(
    "project_domain_roles",
    MetaData(),
    Column("project_id", Uuid),
    Column("workspace_id", Uuid),
    Column("entity_id", Uuid),
    Column("role", Text),
    Column("domain_id", Integer),
    Column("match_scope", Text),
    Column("path_prefix", Text),
    schema="core",
)

# Taxonomy (docs/04-data-model.md section 5.3).
taxonomy_vocabularies = Table(
    "taxonomy_vocabularies",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    Column("project_id", Uuid),
    Column("kind", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("is_hierarchical", Boolean, nullable=False, server_default=FetchedValue()),
    Column("is_single_valued", Boolean, nullable=False, server_default=FetchedValue()),
    # Names are unique without case through the index taxonomy_vocabularies_scope_kind_name.
    UniqueConstraint("id", "workspace_id", name="taxonomy_vocabularies_id_workspace_id_key"),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="core",
)

taxonomy_terms = Table(
    "taxonomy_terms",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("vocabulary_id", Uuid, nullable=False),
    Column("parent_id", Uuid),
    Column("name", Text, nullable=False),
    Column("slug", CITEXT, nullable=False),
    Column("path", Text, nullable=False),
    Column("source", Text, nullable=False, server_default=FetchedValue()),
    Column("description", Text),
    _created_at(),
    UniqueConstraint(
        "vocabulary_id",
        "parent_id",
        "slug",
        name="taxonomy_terms_vocabulary_id_parent_id_slug_key",
        postgresql_nulls_not_distinct=True,
    ),
    UniqueConstraint("id", "workspace_id", name="taxonomy_terms_id_workspace_id_key"),
    UniqueConstraint("id", "vocabulary_id", name="taxonomy_terms_id_vocabulary_id_key"),
    ForeignKeyConstraint(
        ["vocabulary_id", "workspace_id"],
        [taxonomy_vocabularies.c.id, taxonomy_vocabularies.c.workspace_id],
        ondelete="CASCADE",
    ),
    # A parent is in the same vocabulary, so in the same workspace too.
    ForeignKeyConstraint(
        ["parent_id", "vocabulary_id"],
        ["core.taxonomy_terms.id", "core.taxonomy_terms.vocabulary_id"],
        ondelete="CASCADE",
    ),
    schema="core",
)

# A global dictionary of canonical URLs (docs/04-data-model.md section 5.1).
urls = Table(
    "urls",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("url_hash", LargeBinary, nullable=False),
    Column("canonical_url", Text, nullable=False),
    Column("domain_id", Integer, ForeignKey(domains.c.id), nullable=False),
    Column("path", Text, nullable=False),
    Column("first_seen_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    Column("canonicalizer_version", SmallInteger, nullable=False),
    UniqueConstraint("url_hash", name="urls_url_hash_key"),
    schema="core",
)

# Keywords (docs/04-data-model.md sections 7.1 and 7.2). Each refers to its parents through
# keys that carry the workspace, so no row can point into another workspace.
keywords = Table(
    "keywords",
    metadata,
    _id(),
    Column("workspace_id", Uuid, ForeignKey(workspaces.c.id, ondelete="CASCADE"), nullable=False),
    Column("text", Text, nullable=False),
    Column("normalized_text", Text, nullable=False),
    Column("language_code", Text, nullable=False),
    _created_at(),
    UniqueConstraint(
        "workspace_id",
        "normalized_text",
        "language_code",
        name="keywords_workspace_id_normalized_text_language_code_key",
    ),
    UniqueConstraint("id", "workspace_id", name="keywords_id_workspace_id_key"),
    UniqueConstraint(
        "id", "workspace_id", "language_code", name="keywords_id_workspace_id_language_code_key"
    ),
    schema="seo",
)

tracked_keywords = Table(
    "tracked_keywords",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("keyword_id", Uuid, nullable=False),
    Column("search_engine", Text, nullable=False, server_default=FetchedValue()),
    Column("location_id", Integer, ForeignKey(locations.c.id), nullable=False),
    Column("language_code", Text, nullable=False),
    Column("device", Text, nullable=False),
    Column("os", Text),
    Column("config_version", Integer, nullable=False, server_default=FetchedValue()),
    Column("depth_profile", Text, nullable=False, server_default=FetchedValue()),
    Column("target_url_id", BigInteger, ForeignKey(urls.c.id)),
    Column("intent", Text, nullable=False, server_default=FetchedValue()),
    Column("intent_source", Text),
    Column("funnel_stage", Text, nullable=False, server_default=FetchedValue()),
    Column("priority", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("business_value", Numeric(12, 2)),
    Column("frequency", Text, nullable=False, server_default=FetchedValue()),
    Column("schedule_id", Uuid),
    Column("source", Text, nullable=False, server_default=FetchedValue()),
    Column("is_active", Boolean, nullable=False, server_default=FetchedValue()),
    Column("created_by", Uuid, ForeignKey(users.c.id)),
    _created_at(),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    Column("deleted_at", DateTime(timezone=True)),
    UniqueConstraint(
        "project_id",
        "keyword_id",
        "search_engine",
        "location_id",
        "language_code",
        "device",
        name="tracked_keyword_identity",
    ),
    UniqueConstraint("id", "workspace_id", name="tracked_keywords_id_workspace_id_key"),
    UniqueConstraint(
        "id", "project_id", "workspace_id", name="tracked_keywords_id_project_id_workspace_id_key"
    ),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["keyword_id", "workspace_id", "language_code"],
        [keywords.c.id, keywords.c.workspace_id, keywords.c.language_code],
    ),
    # A schedule of the same project.
    ForeignKeyConstraint(
        ["schedule_id", "project_id", "workspace_id"],
        [schedules.c.id, schedules.c.project_id, schedules.c.workspace_id],
    ),
    schema="seo",
)

tracked_keyword_config_history = Table(
    "tracked_keyword_config_history",
    metadata,
    Column("tracked_keyword_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("config_version", Integer, primary_key=True),
    Column("depth_profile", Text, nullable=False),
    Column("target_url_id", BigInteger, ForeignKey(urls.c.id)),
    Column("valid_from", DateTime(timezone=True), nullable=False),
    Column("valid_to", DateTime(timezone=True)),
    Column("changed_by", Uuid, ForeignKey(users.c.id)),
    Column("change_reason", Text),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

keyword_groups = Table(
    "keyword_groups",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("parent_id", Uuid),
    Column("name", Text, nullable=False),
    Column("path", Text, nullable=False),
    _created_at(),
    UniqueConstraint("id", "workspace_id", name="keyword_groups_id_workspace_id_key"),
    UniqueConstraint(
        "id", "project_id", "workspace_id", name="keyword_groups_id_project_id_workspace_id_key"
    ),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    # A parent is in the same project, so in the same workspace too.
    ForeignKeyConstraint(
        ["parent_id", "project_id", "workspace_id"],
        [
            "seo.keyword_groups.id",
            "seo.keyword_groups.project_id",
            "seo.keyword_groups.workspace_id",
        ],
        ondelete="CASCADE",
    ),
    schema="seo",
)

keyword_group_members = Table(
    "keyword_group_members",
    metadata,
    Column("group_id", Uuid, primary_key=True),
    Column("tracked_keyword_id", Uuid, primary_key=True),
    Column("project_id", Uuid, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    ForeignKeyConstraint(
        ["group_id", "project_id", "workspace_id"],
        [keyword_groups.c.id, keyword_groups.c.project_id, keyword_groups.c.workspace_id],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "project_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.project_id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

tracked_keyword_terms = Table(
    "tracked_keyword_terms",
    metadata,
    Column("tracked_keyword_id", Uuid, primary_key=True),
    Column("term_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("assigned_by", Text, nullable=False, server_default=FetchedValue()),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["term_id", "workspace_id"],
        [taxonomy_terms.c.id, taxonomy_terms.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

tracked_keyword_competitors = Table(
    "tracked_keyword_competitors",
    metadata,
    Column("tracked_keyword_id", Uuid, primary_key=True),
    Column("entity_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("mode", Text, nullable=False),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["entity_id", "workspace_id"],
        [entities.c.id, entities.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

keyword_metric_snapshots = Table(
    "keyword_metric_snapshots",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("workspace_id", Uuid, nullable=False),
    Column("keyword_id", Uuid, nullable=False),
    Column("location_id", Integer, ForeignKey(locations.c.id), nullable=False),
    Column("language_code", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("fetched_at", DateTime(timezone=True), nullable=False),
    Column("data_month", Date),
    Column("search_volume", Integer),
    Column("monthly_searches", JSONB, nullable=False, server_default=FetchedValue()),
    Column("cpc_usd", Numeric(10, 4)),
    Column("competition", Numeric(5, 4)),
    Column("competition_level", Text),
    Column("keyword_difficulty", SmallInteger),
    Column("intent_main", Text),
    Column("intent_detail", JSONB),
    Column("serp_item_types", ARRAY(Text)),
    Column("raw_payload_id", BigInteger),
    Column("task_id", BigInteger),
    Column("cost_event_id", BigInteger),
    Column("is_material_change", Boolean, nullable=False),
    # One snapshot per task, so ingesting a task twice writes one row.
    UniqueConstraint("task_id", name="keyword_metric_snapshots_one_per_task"),
    UniqueConstraint("id", "workspace_id", name="keyword_metric_snapshots_id_workspace_id_key"),
    UniqueConstraint(
        "id",
        "workspace_id",
        "keyword_id",
        "location_id",
        "language_code",
        "source",
        name="keyword_metric_snapshots_current_key",
    ),
    ForeignKeyConstraint(
        ["keyword_id", "workspace_id", "language_code"],
        [keywords.c.id, keywords.c.workspace_id, keywords.c.language_code],
        ondelete="CASCADE",
    ),
    schema="seo",
)

keyword_metrics_current = Table(
    "keyword_metrics_current",
    metadata,
    Column("keyword_id", Uuid, primary_key=True),
    Column("location_id", Integer, primary_key=True),
    Column("language_code", Text, primary_key=True),
    Column("source", Text, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("snapshot_id", BigInteger, nullable=False),
    Column("search_volume", Integer),
    Column("cpc_usd", Numeric(10, 4)),
    Column("keyword_difficulty", SmallInteger),
    Column("intent_main", Text),
    Column("fetched_at", DateTime(timezone=True), nullable=False),
    ForeignKeyConstraint(
        ["keyword_id", "workspace_id", "language_code"],
        [keywords.c.id, keywords.c.workspace_id, keywords.c.language_code],
        ondelete="CASCADE",
    ),
    ForeignKeyConstraint(
        ["snapshot_id", "workspace_id", "keyword_id", "location_id", "language_code", "source"],
        [
            keyword_metric_snapshots.c.id,
            keyword_metric_snapshots.c.workspace_id,
            keyword_metric_snapshots.c.keyword_id,
            keyword_metric_snapshots.c.location_id,
            keyword_metric_snapshots.c.language_code,
            keyword_metric_snapshots.c.source,
        ],
        ondelete="CASCADE",
    ),
    schema="seo",
)

keyword_imports = Table(
    "keyword_imports",
    metadata,
    _id(),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("source", Text, nullable=False),
    Column("original_filename", Text),
    Column("upload_object_key", Text),
    Column("status", Text, nullable=False),
    Column("column_mapping", JSONB, nullable=False, server_default=FetchedValue()),
    Column("defaults", JSONB, nullable=False, server_default=FetchedValue()),
    Column("counts", JSONB, nullable=False, server_default=FetchedValue()),
    Column("duplicate_action", Text),
    Column("error_code", Text),
    Column("created_by", Uuid, ForeignKey(users.c.id), nullable=False),
    _created_at(),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("finished_at", DateTime(timezone=True)),
    UniqueConstraint("id", "workspace_id", name="keyword_imports_id_workspace_id_key"),
    ForeignKeyConstraint(
        ["project_id", "workspace_id"],
        [projects.c.id, projects.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

keyword_import_rows = Table(
    "keyword_import_rows",
    metadata,
    Column("import_id", Uuid, primary_key=True),
    Column("row_no", Integer, primary_key=True),
    Column("part", SmallInteger, primary_key=True, server_default=FetchedValue()),
    Column("workspace_id", Uuid, nullable=False),
    Column("raw", JSONB, nullable=False),
    Column("keyword_text", Text),
    Column("normalized_text", Text),
    Column("language_code", Text),
    Column("device", Text),
    Column("location_id", Integer),
    Column("outcome", Text, nullable=False),
    Column("reason_code", Text),
    Column("reason", Text),
    Column("existing_tracked_keyword_id", Uuid),
    Column("action", Text, nullable=False),
    Column("result", Text),
    Column("tracked_keyword_id", Uuid),
    Column("write_error_code", Text),
    ForeignKeyConstraint(
        ["import_id", "workspace_id"],
        [keyword_imports.c.id, keyword_imports.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

serp_feature_types = Table(
    "serp_feature_types",
    metadata,
    Column("code", Text, primary_key=True),
    Column("label", Text, nullable=False),
    Column("ownable", Boolean, nullable=False),
    Column("tracked_by_default", Boolean, nullable=False, server_default=FetchedValue()),
    schema="seo",
)

# Rank collection (migration 0013). The observation tables are partitioned by month on
# `observed_at` (`occurred_at` for events): the partition key is part of every primary key.
serp_snapshots = Table(
    "serp_snapshots",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("observed_date", Date, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("tracked_keyword_id", Uuid, nullable=False),
    Column("config_version", Integer, nullable=False),
    Column("collection_task_id", BigInteger),
    Column("observation_class", Text, nullable=False, server_default=FetchedValue()),
    Column("provider_code", Text, nullable=False),
    Column("provider_endpoint", Text, nullable=False),
    Column("provider_task_id", Text),
    Column("se_domain", Text),
    Column("location_id", Integer, nullable=False),
    Column("language_code", Text, nullable=False),
    Column("device", Text, nullable=False),
    Column("os", Text),
    Column("depth_requested", SmallInteger, nullable=False),
    Column("depth_returned", SmallInteger, nullable=False),
    Column("se_results_count", BigInteger),
    Column("item_types", ARRAY(Text), nullable=False),
    Column("organic_url_ids", ARRAY(BigInteger), nullable=False),
    Column("organic_domain_ids", ARRAY(Integer), nullable=False),
    Column("organic_abs_positions", ARRAY(SmallInteger), nullable=False),
    Column("has_ai_overview", Boolean, nullable=False),
    Column("ai_overview_state", Text),
    Column("has_ai_mode_link", Boolean),
    Column("raw_payload_id", BigInteger, ForeignKey(raw_payloads.c.id), nullable=False),
    Column("parser_version", SmallInteger, nullable=False),
    Column("canonicalizer_version", SmallInteger, nullable=False),
    Column("cost_usd", Numeric(14, 6)),
    Column("served_from_cache", Boolean, nullable=False, server_default=FetchedValue()),
    Column("extras", JSONB),
    Column("superseded_by", BigInteger),
    UniqueConstraint(
        "id",
        "observed_at",
        "workspace_id",
        "project_id",
        "tracked_keyword_id",
        name="serp_snapshots_identity_key",
    ),
    UniqueConstraint(
        "collection_task_id",
        "observed_at",
        name="serp_snapshots_collection_task_id_observed_at_key",
    ),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "project_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.project_id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

serp_features = Table(
    "serp_features",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("observed_at", DateTime(timezone=True), primary_key=True),
    Column("serp_snapshot_id", BigInteger, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("tracked_keyword_id", Uuid, nullable=False),
    Column("feature_type", Text, ForeignKey(serp_feature_types.c.code), nullable=False),
    Column("ordinal", SmallInteger, nullable=False),
    Column("rank_absolute", SmallInteger),
    Column("source_url_ids", ARRAY(BigInteger), nullable=False, server_default=FetchedValue()),
    Column("source_domain_ids", ARRAY(Integer), nullable=False, server_default=FetchedValue()),
    Column("owned_by_project", Boolean, nullable=False),
    Column("owned_position", SmallInteger),
    Column("competitor_entity_ids", ARRAY(Uuid), nullable=False, server_default=FetchedValue()),
    Column("payload", JSONB),
    Column("parser_version", SmallInteger, nullable=False),
    ForeignKeyConstraint(
        ["serp_snapshot_id", "observed_at", "workspace_id", "project_id", "tracked_keyword_id"],
        [
            serp_snapshots.c.id,
            serp_snapshots.c.observed_at,
            serp_snapshots.c.workspace_id,
            serp_snapshots.c.project_id,
            serp_snapshots.c.tracked_keyword_id,
        ],
        ondelete="CASCADE",
    ),
    schema="seo",
)

domain_rank_observations = Table(
    "domain_rank_observations",
    metadata,
    Column("serp_snapshot_id", BigInteger, nullable=False),
    Column("observed_at", DateTime(timezone=True), nullable=False),
    Column("observed_date", Date, nullable=False),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("tracked_keyword_id", Uuid, nullable=False),
    Column("entity_id", Uuid, nullable=False),
    Column("role", Text, nullable=False),
    Column("organic_rank", SmallInteger),
    Column("absolute_rank", SmallInteger),
    Column("ranking_url_id", BigInteger),
    Column("ranking_title", Text),
    Column("ranking_snippet", Text),
    Column("all_organic_ranks", ARRAY(SmallInteger), nullable=False, server_default=FetchedValue()),
    Column("all_url_ids", ARRAY(BigInteger), nullable=False, server_default=FetchedValue()),
    Column("result_count", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("owned_feature_types", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    Column("cited_in_ai_overview", Boolean),
    Column("ai_overview_citation_position", SmallInteger),
    Column("depth_requested", SmallInteger, nullable=False),
    Column("is_valid", Boolean, nullable=False, server_default=FetchedValue()),
    PrimaryKeyConstraint("tracked_keyword_id", "entity_id", "observed_at", "serp_snapshot_id"),
    ForeignKeyConstraint(
        ["serp_snapshot_id", "observed_at", "workspace_id", "project_id", "tracked_keyword_id"],
        [
            serp_snapshots.c.id,
            serp_snapshots.c.observed_at,
            serp_snapshots.c.workspace_id,
            serp_snapshots.c.project_id,
            serp_snapshots.c.tracked_keyword_id,
        ],
        ondelete="CASCADE",
    ),
    schema="seo",
)

tracked_keyword_state = Table(
    "tracked_keyword_state",
    metadata,
    Column("tracked_keyword_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("last_snapshot_id", BigInteger),
    Column("last_observed_at", DateTime(timezone=True)),
    Column("current_rank", SmallInteger),
    Column("current_absolute_rank", SmallInteger),
    Column("current_url_id", BigInteger),
    Column("previous_rank", SmallInteger),
    Column("previous_observed_at", DateTime(timezone=True)),
    Column("previous_depth_requested", SmallInteger),
    Column("rank_change", SmallInteger),
    Column("best_rank", SmallInteger),
    Column("best_rank_at", DateTime(timezone=True)),
    Column("worst_rank", SmallInteger),
    Column("first_ranked_at", DateTime(timezone=True)),
    Column("feature_types_present", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    Column("owned_feature_types", ARRAY(Text), nullable=False, server_default=FetchedValue()),
    Column("has_ai_overview", Boolean),
    Column("cited_in_ai_overview", Boolean),
    Column("aio_state", Text),
    Column("aio_citation_position", SmallInteger),
    Column("aio_observation_id", BigInteger),
    Column("current_depth_requested", SmallInteger),
    Column("target_url_match", Boolean),
    Column("url_changed_at", DateTime(timezone=True)),
    Column("consecutive_failures", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("consecutive_beyond", SmallInteger, nullable=False, server_default=FetchedValue()),
    Column("last_ranked_rank", SmallInteger),
    Column("is_stale", Boolean, nullable=False, server_default=FetchedValue()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=FetchedValue()),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "project_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.project_id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

serp_current_results = Table(
    "serp_current_results",
    metadata,
    Column("tracked_keyword_id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("organic_rank", SmallInteger, primary_key=True),
    Column("serp_snapshot_id", BigInteger, nullable=False),
    Column("absolute_rank", SmallInteger),
    Column("url_id", BigInteger, ForeignKey(urls.c.id), nullable=False),
    Column("domain_id", Integer, ForeignKey(domains.c.id), nullable=False),
    Column("title", Text),
    Column("snippet", Text),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "project_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.project_id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)

rank_events = Table(
    "rank_events",
    metadata,
    Column("id", BigInteger, primary_key=True, server_default=FetchedValue()),
    Column("occurred_at", DateTime(timezone=True), primary_key=True),
    Column("workspace_id", Uuid, nullable=False),
    Column("project_id", Uuid, nullable=False),
    Column("tracked_keyword_id", Uuid, nullable=False),
    Column("entity_id", Uuid, nullable=False),
    Column("event_type", Text, nullable=False),
    Column("from_rank", SmallInteger),
    Column("to_rank", SmallInteger),
    Column("from_url_id", BigInteger),
    Column("to_url_id", BigInteger),
    Column("other_entity_id", Uuid),
    # The feature type of a `feature_gained` or `feature_lost` event, else null.
    Column("feature_type", Text),
    Column("serp_snapshot_id", BigInteger, nullable=False),
    ForeignKeyConstraint(
        ["tracked_keyword_id", "project_id", "workspace_id"],
        [tracked_keywords.c.id, tracked_keywords.c.project_id, tracked_keywords.c.workspace_id],
        ondelete="CASCADE",
    ),
    schema="seo",
)
