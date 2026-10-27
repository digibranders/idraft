"""Reading what a database error says, so callers name the rule that was broken."""

from __future__ import annotations

from sqlalchemy.exc import DBAPIError, IntegrityError

_UNIQUE_VIOLATION = "23505"
_FOREIGN_KEY_VIOLATION = "23503"
# Waited for a lock longer than the connection's lock timeout, or was the one of two
# statements waiting on each other that PostgreSQL chose to end.
_GAVE_WAY = frozenset({"55P03", "40P01"})


def violated_unique_constraint(error: IntegrityError) -> str | None:
    """The name of the unique constraint or index a statement ran into, or None when the error
    is something else. asyncpg keeps the name; SQLAlchemy's wrapper only carries the code."""
    if getattr(error.orig, "sqlstate", None) != _UNIQUE_VIOLATION:
        return None
    name = getattr(getattr(error.orig, "__cause__", None), "constraint_name", None)
    return name if isinstance(name, str) else None


def violated_foreign_key(error: IntegrityError) -> str | None:
    """The name of the foreign key a statement broke, or None when the error is something else:
    a row still referenced on delete, or a reference to a row that does not exist."""
    if getattr(error.orig, "sqlstate", None) != _FOREIGN_KEY_VIOLATION:
        return None
    name = getattr(getattr(error.orig, "__cause__", None), "constraint_name", None)
    return name if isinstance(name, str) else None


def gave_way(error: BaseException) -> bool:
    """Whether the statement failed only because another transaction was in its way. Nothing
    is wrong; the same work succeeds when it is tried again."""
    return isinstance(error, DBAPIError) and getattr(error.orig, "sqlstate", None) in _GAVE_WAY
