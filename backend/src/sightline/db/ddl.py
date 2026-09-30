"""SQL builders for Alembic revisions: grants and tenant isolation.

Applied revisions call these, so their output is frozen history. Change behaviour by adding a new
function, never by editing one that a revision already used.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

API_ROLE = "app_api"
WORKER_ROLE = "app_worker"
POLICY_NAME = "tenant_isolation"
_QUALIFIED_NAME = re.compile(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*")
_IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*")
_COLUMN_PRIVILEGES = frozenset({"SELECT", "INSERT", "UPDATE"})
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


def column_grant(table: str, *, role: str, privilege: str, columns: Sequence[str]) -> str:
    """GRANT one privilege on named columns only.

    Used where a role may change some columns of a row but must never change others: the API may
    rename a user but not make them a platform operator; the worker may bump a counter but not move
    a row to another workspace.
    """
    table = _table(table)
    if role not in (API_ROLE, WORKER_ROLE):
        raise ValueError(f"expected a runtime role, got {role!r}")
    if privilege not in _COLUMN_PRIVILEGES:
        raise ValueError(
            f"expected one of {sorted(_COLUMN_PRIVILEGES)} privileges, got {privilege!r}"
        )
    if not columns or not all(_IDENTIFIER.fullmatch(column) for column in columns):
        raise ValueError(f"expected lower-case column names, got {list(columns)!r}")
    return f"GRANT {privilege} ({', '.join(columns)}) ON {table} TO {role}"


def tenant_isolation(
    table: str, *, column: str = "workspace_id", also_visible_when: str | None = None
) -> list[str]:
    """Enable row-level security and add the `tenant_isolation` policy.

    A row can be inserted or changed only into the workspace set on the transaction.
    `also_visible_when` widens what can be read, for example a user's own memberships. It also
    widens what a DELETE can reach, because a policy's USING clause is all a DELETE is checked
    against: statements on such a table must name the workspace themselves.
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


def statements(script: str) -> list[str]:
    """Split a script into statements at blank lines.

    asyncpg sends one statement per call. Splitting at blank lines, not at semicolons, keeps
    function bodies whole, so a script must separate its statements with an empty line and must not
    put one inside a statement.
    """
    chunks = (chunk.strip() for chunk in re.split(r"\n\s*\n", script))
    return [
        chunk
        for chunk in chunks
        if chunk and not all(line.lstrip().startswith("--") for line in chunk.splitlines())
    ]
