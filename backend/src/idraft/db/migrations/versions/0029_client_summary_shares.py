"""Internal links: shareable client summary links (plan 06, decision D15).

A share is a random token that lets anyone holding the link read one project's client summary,
read only, until it expires (7, 30 or 90 days) or a person revokes it. Only the SHA-256 of the
token is stored; the token itself is shown once, when the share is made.

The public read has no session, so the row-level policy would hide the share. As for an
invitation, one definer function returns the one row with a given token hash and nothing else;
what it returns is checked (expiry, revocation) by the caller.

Revision ID: 0029
Revises: 0028
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE core.client_summary_shares (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    token_hash   bytea NOT NULL CONSTRAINT client_summary_shares_token_hash_key UNIQUE
                 CHECK (length(token_hash) = 32),
    created_by   uuid NOT NULL REFERENCES auth.users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    revoked_by   uuid REFERENCES auth.users(id),
    CHECK (expires_at > created_at),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX client_summary_shares_project
    ON core.client_summary_shares (project_id, created_at DESC);
"""

# Whatever its expiry or revocation: the caller checks both, so an unknown, an expired and a
# revoked link can all be answered the same way.
_LOOKUP = """
CREATE FUNCTION core.client_summary_share_by_token(p_token_hash bytea)
    RETURNS SETOF core.client_summary_shares
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        SELECT s.* FROM core.client_summary_shares s WHERE s.token_hash = p_token_hash;
    END;

REVOKE ALL ON FUNCTION core.client_summary_share_by_token(bytea) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.client_summary_share_by_token(bytea) TO app_api;
"""

_TABLE = "core.client_summary_shares"


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for statement in tenant_isolation(_TABLE):
        op.execute(statement)
    for statement in (
        *grants(_TABLE, api="SELECT, INSERT"),
        column_grant(
            _TABLE, role="app_api", privilege="UPDATE", columns=("revoked_at", "revoked_by")
        ),
        *statements(_LOOKUP),
    ):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the shares are lost.
    op.execute("DROP FUNCTION core.client_summary_share_by_token(bytea)")
    op.execute("DROP TABLE core.client_summary_shares")
