"""SQL builders for Alembic revisions: grants and tenant isolation.

Applied revisions call these, so their output is frozen history. Change behaviour by adding a new
function, never by editing one that a revision already used.
"""

from __future__ import annotations

import re

API_ROLE = "app_api"
WORKER_ROLE = "app_worker"
POLICY_NAME = "tenant_isolation"
_QUALIFIED_NAME = re.compile(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*")
_IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*")
_PRIVILEGES = re.compile(r"(SELECT|INSERT|UPDATE|DELETE)(, (SELECT|INSERT|UPDATE|DELETE))*")


def _table(name: str) -> str:
    if not _QUALIFIED_NAME.fullmatch(name):
        raise ValueError(f"expected schema.table in lower case, got {name!r}")
    return name


def _privileges(value: str) -> str:
    if not _PRIVILEGES.fullmatch(value):
        raise ValueError(
            f"expected privileges such as 'SELECT, INSERT' (no ALL, no TRUNCATE), got {value!r}"
        )
    return value


def grants(table: str, *, api: str = "", worker: str = "") -> list[str]:
    """One GRANT per runtime role that gets anything. Runtime roles never get DDL rights."""
    table = _table(table)
    return [
        f"GRANT {_privileges(privileges)} ON {table} TO {role}"
        for role, privileges in ((API_ROLE, api), (WORKER_ROLE, worker))
        if privileges
    ]


def tenant_isolation(
    table: str, *, column: str = "workspace_id", also_visible_when: str | None = None
) -> list[str]:
    """Enable row-level security and add the `tenant_isolation` policy.

    A row is writable only for the workspace set on the transaction. `also_visible_when` widens
    what can be read (for example a user's own memberships), never what can be written.
    """
    table = _table(table)
    if not _IDENTIFIER.fullmatch(column):
        raise ValueError(f"expected a lower-case column name, got {column!r}")
    owned = f"{column} = auth.current_workspace_id()"
    visible = f"{owned} OR {also_visible_when}" if also_visible_when else owned
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"CREATE POLICY {POLICY_NAME} ON {table} USING ({visible}) WITH CHECK ({owned})",
    ]
