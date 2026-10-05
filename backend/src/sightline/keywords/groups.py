"""Keyword groups as the API and the worker both change them (docs/19-api-specification.md
section 3.6.2): one change at a time per project, the same limits, and a path made of names.
A group's `path` is the names from the root down joined by `/`.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final
from uuid import UUID

from sqlalchemy import func, insert, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import keyword_groups

# As deep as taxonomy terms go (docs/19 section 3.5).
GROUP_DEPTH_MAX: Final = 10
# The check on `seo.keyword_groups.path` in migration 0011.
PATH_BYTES_MAX: Final = 2048
NAME_MAX: Final = 100


async def lock_groups(db: AsyncSession, project_id: UUID) -> None:
    """Group changes in one project run one at a time until the transaction ends, so a move is
    checked for cycles against a tree no other request is changing."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"keyword_groups:{project_id}"), 0)
            )
        )
    )


def path_fits(names: Sequence[str]) -> bool:
    """Whether a path of these names is within the limits: 1 to `NAME_MAX` characters each, no
    `/` in a name, at most `GROUP_DEPTH_MAX` names, and at most `PATH_BYTES_MAX` bytes."""
    if not 1 <= len(names) <= GROUP_DEPTH_MAX:
        return False
    if any(not 1 <= len(name) <= NAME_MAX or "/" in name for name in names):
        return False
    return len("/".join(names).encode()) <= PATH_BYTES_MAX


async def ensure_group_path(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, names: Sequence[str]
) -> UUID:
    """The group at this path of names, created level by level where missing. Names match
    without case, as sibling names are unique without case. The caller holds `lock_groups` and
    has checked `path_fits`."""
    if not names:
        raise ValueError("a group path has at least one name")
    g = keyword_groups.c
    parent_id: UUID | None = None
    parent_path = ""
    for name in names:
        found = (
            await db.execute(
                select(g.id, g.path).where(
                    g.workspace_id == workspace_id,
                    g.project_id == project_id,
                    func.lower(g.name) == name.lower(),
                    g.parent_id.is_(None) if parent_id is None else g.parent_id == parent_id,
                )
            )
        ).one_or_none()
        if found is not None:
            parent_id, parent_path = found.id, found.path
            continue
        path = name if parent_id is None else f"{parent_path}/{name}"
        parent_id = (
            await db.execute(
                insert(keyword_groups)
                .values(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    parent_id=parent_id,
                    name=name,
                    path=path,
                )
                .returning(g.id)
            )
        ).scalar_one()
        parent_path = path
    if parent_id is None:  # pragma: no cover - names is not empty
        raise ValueError("a group path has at least one name")
    return parent_id
