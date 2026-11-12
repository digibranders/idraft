"""Layouts (docs/19-api-specification.md section 3.11.5c; layout spec sections 6.3 and 9).

What a member sees on a screen is their personal layout, else the team default, else the
built-in default the web app holds. A stored value that is not a layout document counts as
absent. The `ETag` covers the caller's personal row and the team row of the screen; a write
sends it back as `If-Match` (plan decisions L6 and L7).
"""

from __future__ import annotations

import hashlib
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.layouts import repository
from idraft.api.layouts.catalog import SCREENS
from idraft.api.layouts.repository import StoredLayout
from idraft.api.problems import NotFoundError
from idraft.api.schemas.ai_layouts import LayoutDocument, LayoutEditor, ResolvedLayout
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction


@dataclass(frozen=True, slots=True)
class Resolved:
    layout: ResolvedLayout
    etag: str


def etag(personal: StoredLayout | None, team: StoredLayout | None) -> str:
    def part(row: StoredLayout | None) -> str:
        return "-" if row is None else f"{row.id}:{row.updated_at.isoformat()}"

    return '"' + hashlib.sha256(f"{part(personal)}|{part(team)}".encode()).hexdigest()[:32] + '"'


def usable(row: StoredLayout | None) -> LayoutDocument | None:
    if row is None:
        return None
    try:
        return LayoutDocument.model_validate(row.document)
    except ValidationError:
        return None


def resolved(screen: str, personal: StoredLayout | None, team: StoredLayout | None) -> Resolved:
    team_document = usable(team)
    personal_document = usable(personal)
    if personal_document is not None:
        source, document, row = "personal", personal_document, personal
    elif team_document is not None:
        source, document, row = "team", team_document, team
    else:
        source, document, row = "builtin", None, None
    layout = ResolvedLayout.model_validate(
        {
            "screen": screen,
            "source": source,
            "document": document,
            "team_default_exists": team_document is not None,
            "updated_at": None if row is None else row.updated_at,
            "updated_by": None
            if row is None
            else LayoutEditor(user_id=row.updated_by, name=row.updated_by_name),
        }
    )
    return Resolved(layout=layout, etag=etag(personal, team))


def known(screen: str) -> None:
    if screen not in SCREENS:
        raise NotFoundError


class LayoutService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        # The user setting is what the policy `layouts_owner` reads (owner decision D-09).
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def resolve(self, access: WorkspaceAccess, screen: str) -> Resolved:
        known(screen)
        async with self._transaction(access) as db:
            personal, team = await repository.stored_layouts(
                db, access.workspace_id, access.user_id, screen
            )
        return resolved(screen, personal, team)
