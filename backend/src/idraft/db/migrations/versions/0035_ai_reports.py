"""AI visibility client reports: guest links and scheduled emails (client reports plan).

A report share is a random token that lets anyone holding the link read one project's AI
visibility report, read only, until it expires (7, 30 or 90 days) or a person revokes it. As for
`client_summary_shares`, only the SHA-256 of the token is stored and one definer function returns
the row with a given hash, because the public read has no session for the row-level policy.

A schedule emails the report weekly or monthly. The worker has no workspace until it has found a
due schedule, so a second definer function claims the due rows across workspaces and moves their
`next_run_at` in the same statement: a crash after the claim loses one send, never repeats it.

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

_TABLES = """
CREATE TABLE core.ai_report_shares (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    token_hash   bytea NOT NULL CONSTRAINT ai_report_shares_token_hash_key UNIQUE
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

CREATE INDEX ai_report_shares_project ON core.ai_report_shares (project_id, created_at DESC);

CREATE TABLE core.ai_report_schedules (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    frequency    text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
    recipients   text[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 10),
    paused       boolean NOT NULL DEFAULT false,
    next_run_at  timestamptz NOT NULL,
    last_sent_at timestamptz,
    last_error   text,
    created_by   uuid NOT NULL REFERENCES auth.users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX ai_report_schedules_project ON core.ai_report_schedules (project_id, created_at);

CREATE INDEX ai_report_schedules_due ON core.ai_report_schedules (next_run_at) WHERE NOT paused;
"""

# Whatever its expiry or revocation: the caller checks both, so an unknown, an expired and a
# revoked link all answer the same way.
_SHARE_LOOKUP = """
CREATE FUNCTION core.ai_report_share_by_token(p_token_hash bytea)
    RETURNS SETOF core.ai_report_shares
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        SELECT s.* FROM core.ai_report_shares s WHERE s.token_hash = p_token_hash;
    END;

REVOKE ALL ON FUNCTION core.ai_report_share_by_token(bytea) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.ai_report_share_by_token(bytea) TO app_api;
"""

# Weeks start on Monday and both run at 06:00 UTC. The new `next_run_at` is the first slot after
# `p_now`, so a worker that was down for a month sends once, not four times.
_CLAIM_DUE = """
CREATE FUNCTION core.ai_report_schedules_claim_due(p_now timestamptz, p_limit integer)
    RETURNS SETOF core.ai_report_schedules
    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        UPDATE core.ai_report_schedules s
           SET next_run_at = CASE s.frequency
                   WHEN 'weekly' THEN
                       (date_trunc('week', p_now AT TIME ZONE 'UTC')
                        + interval '1 week' + interval '6 hours') AT TIME ZONE 'UTC'
                   ELSE
                       (date_trunc('month', p_now AT TIME ZONE 'UTC')
                        + interval '1 month' + interval '6 hours') AT TIME ZONE 'UTC'
               END
         WHERE s.id IN (
                   SELECT d.id FROM core.ai_report_schedules d
                    WHERE NOT d.paused AND d.next_run_at <= p_now
                    ORDER BY d.next_run_at
                    LIMIT p_limit
                      FOR UPDATE SKIP LOCKED)
        RETURNING s.*;
    END;

REVOKE ALL ON FUNCTION core.ai_report_schedules_claim_due(timestamptz, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.ai_report_schedules_claim_due(timestamptz, integer) TO app_worker;
"""


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for table in ("core.ai_report_shares", "core.ai_report_schedules"):
        for statement in tenant_isolation(table):
            op.execute(statement)
    for statement in (
        *grants("core.ai_report_shares", api="SELECT, INSERT", worker="SELECT, INSERT"),
        column_grant(
            "core.ai_report_shares",
            role="app_api",
            privilege="UPDATE",
            columns=("revoked_at", "revoked_by"),
        ),
        *grants(
            "core.ai_report_schedules",
            api="SELECT, INSERT, DELETE",
            worker="SELECT",
        ),
        column_grant(
            "core.ai_report_schedules",
            role="app_api",
            privilege="UPDATE",
            columns=("frequency", "recipients", "paused", "next_run_at"),
        ),
        column_grant(
            "core.ai_report_schedules",
            role="app_worker",
            privilege="UPDATE",
            columns=("last_sent_at", "last_error"),
        ),
        *statements(_SHARE_LOOKUP),
        *statements(_CLAIM_DUE),
    ):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the shares and schedules are lost.
    op.execute("DROP FUNCTION core.ai_report_schedules_claim_due(timestamptz, integer)")
    op.execute("DROP FUNCTION core.ai_report_share_by_token(bytea)")
    op.execute("DROP TABLE core.ai_report_schedules")
    op.execute("DROP TABLE core.ai_report_shares")
