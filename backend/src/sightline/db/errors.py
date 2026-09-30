"""Reading what a database error says, so callers name the rule that was broken."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

_UNIQUE_VIOLATION = "23505"


def violated_unique_constraint(error: IntegrityError) -> str | None:
    """The name of the unique constraint or index a statement ran into, or None when the error
    is something else. asyncpg keeps the name; SQLAlchemy's wrapper only carries the code."""
    if getattr(error.orig, "sqlstate", None) != _UNIQUE_VIOLATION:
        return None
    name = getattr(getattr(error.orig, "__cause__", None), "constraint_name", None)
    return name if isinstance(name, str) else None
