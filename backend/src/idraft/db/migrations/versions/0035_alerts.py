"""Alert rules, the alerts they raise, and where evaluation stopped (version 1: in the app only).

See docs/04-data-model.md section 11.5 and docs/superpowers/plans/2026-11-24-alerts.md. Choices:

- `channels` and `digest_mode` keep the columns of the specification, but their CHECKs allow only
  what version 1 delivers (`in_app`, `immediate`). Email and Slack widen the CHECKs later with a
  migration of their own; no column changes.
- An alert event names its rule with the workspace, so a rule of another workspace cannot be
  referenced, and carries `subject_label` (the words of the prompt or keyword) so a list needs no
  join. `dedupe_key` is unique: evaluating the same run twice raises each alert once.
- The API changes an alert only to acknowledge it (two columns); the worker adds alerts and moves
  the cursor of a project, and never changes an alert or a rule.
- `ops.alert_cursors` holds, per project, the last run completed that was evaluated and the last
  rank event read (rank events have no run, so they get an id watermark of their own).

Revision ID: 0035
Revises: 0034
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = r"""
CREATE TABLE ops.alert_rules (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    rule_type       text NOT NULL CHECK (length(rule_type) <= 64),
    scope           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(scope) = 'object'),
    params          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(params) = 'object'),
    channels        text[] NOT NULL DEFAULT '{in_app}' CHECK (channels = ARRAY['in_app']),
    digest_mode     text NOT NULL DEFAULT 'immediate' CHECK (digest_mode = 'immediate'),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id)
        REFERENCES core.projects(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX alert_rules_project ON ops.alert_rules (project_id, created_at, id);

CREATE TABLE ops.alert_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_id         uuid NOT NULL,
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    subject_type    text NOT NULL CHECK (subject_type IN ('prompt', 'keyword')),
    subject_id      text NOT NULL,
    subject_label   text NOT NULL,
    dedupe_key      text NOT NULL UNIQUE,
    event_kind      text NOT NULL,
    severity        text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    evidence        jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
    occurred_at     timestamptz NOT NULL,
    notified_at     timestamptz,
    acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    acknowledged_at timestamptz,
    FOREIGN KEY (rule_id, workspace_id)
        REFERENCES ops.alert_rules(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, workspace_id)
        REFERENCES core.projects(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX alert_events_project_time ON ops.alert_events (project_id, occurred_at DESC, id DESC);

CREATE INDEX alert_events_rule ON ops.alert_events (rule_id);

CREATE TABLE ops.alert_cursors (
    project_id          uuid PRIMARY KEY,
    workspace_id        uuid NOT NULL,
    last_completed_at   timestamptz NOT NULL,
    last_rank_event_id  bigint NOT NULL DEFAULT 0,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (project_id, workspace_id)
        REFERENCES core.projects(id, workspace_id) ON DELETE CASCADE
);
"""


def upgrade() -> None:
    for statement in [
        *statements(_TABLES),
        *tenant_isolation("ops.alert_rules"),
        *tenant_isolation("ops.alert_events"),
        *tenant_isolation("ops.alert_cursors"),
        *grants("ops.alert_rules", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "ops.alert_rules",
            role="app_api",
            privilege="UPDATE",
            columns=["name", "scope", "params", "is_active", "updated_at"],
        ),
        *grants("ops.alert_events", api="SELECT", worker="SELECT, INSERT"),
        column_grant(
            "ops.alert_events",
            role="app_api",
            privilege="UPDATE",
            columns=["acknowledged_by", "acknowledged_at"],
        ),
        # Evaluation narrows a rule to the prompts of a group.
        *grants("ai.prompt_terms", worker="SELECT"),
        *grants("ops.alert_cursors", api="SELECT", worker="SELECT, INSERT"),
        column_grant(
            "ops.alert_cursors",
            role="app_worker",
            privilege="UPDATE",
            columns=["last_completed_at", "last_rank_event_id", "updated_at"],
        ),
    ]:
        op.execute(statement)


def downgrade() -> None:
    # For local development only (tests/db/test_migrations.py walks the history down and up).
    # Releases are forward-only: this revision only adds tables (expand), nothing to contract.
    op.execute("REVOKE SELECT ON ai.prompt_terms FROM app_worker")
    op.execute("DROP TABLE ops.alert_cursors")
    op.execute("DROP TABLE ops.alert_events")
    op.execute("DROP TABLE ops.alert_rules")
