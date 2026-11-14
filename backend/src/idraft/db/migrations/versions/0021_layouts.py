"""Layouts: which cards and headline numbers a person sees on a screen.

See docs/04-data-model.md section 11.6a, the layout spec section 9.1 and the plan
docs/superpowers/plans/2026-11-13-ai-wp-11-layouts-api.md.

A row whose `owner_user_id` is NULL is the workspace's team default. Choices (plan decisions):

- Personal rows reference the membership, so a person's layouts go when they leave the
  workspace or are deleted, and every layout goes with its workspace (L4).
- Besides `tenant_isolation`, a restrictive policy keeps a member's personal rows from the other
  members of the workspace (owner decision D-09). The API also names the caller in every
  statement; each half is tested alone (L2).
- The API may change only the document and who changed it when; never the owner, the screen or
  the workspace of a row (L5). Workers get nothing.
- A document is a JSON object of at most 16 KB as stored text (L12).

Revision ID: 0021
Revises: 0020
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLE = r"""
CREATE TABLE core.layouts (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    owner_user_id   uuid,
    screen          text NOT NULL
                    CHECK (length(screen) <= 64 AND screen ~ '^[a-z_]+(\.[a-z_]+)?$'),
    document        jsonb NOT NULL
                    CHECK (jsonb_typeof(document) = 'object'
                           AND octet_length(document::text) <= 16384),
    schema_version  integer NOT NULL CHECK (schema_version >= 1),
    updated_by      uuid NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, owner_user_id)
        REFERENCES auth.memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX layouts_personal ON core.layouts (workspace_id, owner_user_id, screen)
    WHERE owner_user_id IS NOT NULL;

CREATE UNIQUE INDEX layouts_team ON core.layouts (workspace_id, screen)
    WHERE owner_user_id IS NULL;
"""

# Restrictive: ANDed with tenant_isolation, so it can only narrow what a member sees and writes.
# Without a user setting (''), auth.current_user_id() is NULL and only team defaults are visible.
_PRIVACY = (
    "CREATE POLICY layouts_owner ON core.layouts AS RESTRICTIVE "
    "USING (owner_user_id IS NULL OR owner_user_id = auth.current_user_id()) "
    "WITH CHECK (owner_user_id IS NULL OR owner_user_id = auth.current_user_id())"
)


def upgrade() -> None:
    for statement in [
        *statements(_TABLE),
        *tenant_isolation("core.layouts"),
        _PRIVACY,
        *grants("core.layouts", api="SELECT, INSERT, DELETE"),
        column_grant(
            "core.layouts",
            role="app_api",
            privilege="UPDATE",
            columns=["document", "schema_version", "updated_by", "updated_at"],
        ),
    ]:
        op.execute(statement)


def downgrade() -> None:
    # For local development only (tests/db/test_migrations.py walks the history down and up).
    # Releases are forward-only: this revision only adds a table (expand), nothing to contract.
    op.execute("DROP TABLE core.layouts")
