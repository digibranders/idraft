"""Auth events in the audit log.

Signing in, failing to, changing a password or a second factor: none of these has a workspace, and
the policy on ops.audit_logs rejects a row without one when app_api writes it. This function is
the one way to write such a row. It fixes what the caller must not choose: the workspace is always
NULL, the action must be an auth action, and the id and time come from the table defaults.

The function inserts as its owner, which row-level security does not apply to. It would stop
working if FORCE ROW LEVEL SECURITY were ever set on ops.audit_logs.

Revision ID: 0005
Revises: 0004
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import statements

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_SIGNATURE = "ops.record_auth_event(text, uuid, text, text, inet, text, text, jsonb)"

_FUNCTION = f"""
CREATE FUNCTION ops.record_auth_event(
    p_action text,
    p_user_id uuid,
    p_target_type text,
    p_target_id text,
    p_ip inet,
    p_user_agent text,
    p_request_id text,
    p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF p_action IS NULL
       OR length(p_action) > 64
       OR p_action !~ '^auth(\\.[a-z]+(_[a-z]+)*)+$' THEN
        RAISE EXCEPTION 'auth event action must be auth. followed by lower-case words'
            USING ERRCODE = 'check_violation';
    END IF;
    IF p_target_type IS NULL OR p_target_id IS NULL THEN
        RAISE EXCEPTION 'auth event target must be given' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO ops.audit_logs
        (workspace_id, actor_type, actor_id, action, target_type, target_id, after, ip,
         user_agent, request_id)
    VALUES
        (NULL,
         CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'user' END,
         coalesce(p_user_id::text, 'anonymous'),
         p_action, p_target_type, p_target_id, p_details, p_ip,
         left(p_user_agent, 512), p_request_id);
END $$;

REVOKE ALL ON FUNCTION {_SIGNATURE} FROM PUBLIC;

GRANT EXECUTE ON FUNCTION {_SIGNATURE} TO app_api;
"""


def upgrade() -> None:
    for statement in statements(_FUNCTION):
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute(f"DROP FUNCTION {_SIGNATURE}")
