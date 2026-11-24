"""Links between prompts and keywords: reading, making and removing them. A link names a
keyword (`seo.keywords`, no rank tracking) and a prompt of the project; the prompt's search
volume is read through it (docs/04-data-model.md section 9)."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any
from uuid import UUID

from sqlalchemy import Row, Select, and_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.ai import prompt_repository as prompts
from idraft.api.ai.engine_service import live_project
from idraft.api.problems import DuplicateError, NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.ai_links import (
    KeywordPromptLink,
    KeywordPromptLinkCreate,
    LinkedKeywordRef,
    LinkedPromptRef,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.db.tables import keyword_prompt_links as links
from idraft.db.tables import keywords

# Rows of one list read.
LIST_LIMIT = 200


def _view(row: Row[Any]) -> KeywordPromptLink:
    return KeywordPromptLink(
        link_id=row.id,
        keyword=LinkedKeywordRef(
            keyword_id=row.keyword_id, text=row.text, language_code=row.language_code
        ),
        prompt=LinkedPromptRef(prompt_id=row.prompt_id),
        link_type=row.link_type,
        confidence=None if row.confidence is None else float(row.confidence),
        is_primary=row.is_primary,
        status=row.status,
        created_at=row.created_at,
    )


def _selected() -> Select[Any]:
    k = keywords.c
    return select(links, k.text, k.language_code).join(
        keywords, and_(k.id == links.c.keyword_id, k.workspace_id == links.c.workspace_id)
    )


class LinkService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        prompt_id: UUID | None,
        keyword_id: UUID | None,
        limit: int,
    ) -> list[KeywordPromptLink]:
        statement = (
            _selected()
            .where(
                links.c.workspace_id == access.workspace_id,
                links.c.project_id == project_id,
                links.c.status.in_(("active", "suggested")),
            )
            .order_by(links.c.created_at.desc(), links.c.id.desc())
            .limit(min(limit, LIST_LIMIT))
        )
        if prompt_id is not None:
            statement = statement.where(links.c.prompt_id == prompt_id)
        if keyword_id is not None:
            statement = statement.where(links.c.keyword_id == keyword_id)
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            return [_view(row) for row in await db.execute(statement)]

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: KeywordPromptLinkCreate,
        info: RequestInfo,
    ) -> KeywordPromptLink:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            prompt = await prompts.get_prompt(
                db, access.workspace_id, project_id, body.prompt_id, lock=True
            )
            known = await db.scalar(
                select(keywords.c.id).where(
                    keywords.c.id == body.keyword_id,
                    keywords.c.workspace_id == access.workspace_id,
                )
            )
            if prompt is None or known is None:
                raise NotFoundError
            has_primary = await db.scalar(
                select(links.c.id).where(
                    links.c.prompt_id == body.prompt_id,
                    links.c.is_primary,
                    links.c.status == "active",
                )
            )
            primary = body.is_primary if body.is_primary is not None else has_primary is None
            if primary:
                await db.execute(
                    update(links)
                    .where(links.c.prompt_id == body.prompt_id, links.c.is_primary)
                    .values(is_primary=False)
                )
            link_id = await db.scalar(
                insert(links)
                .values(
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    keyword_id=body.keyword_id,
                    prompt_id=body.prompt_id,
                    link_type="manual",
                    is_primary=primary,
                    status="active",
                    created_by=access.user_id,
                )
                .on_conflict_do_nothing(index_elements=["project_id", "keyword_id", "prompt_id"])
                .returning(links.c.id)
            )
            if link_id is None:
                raise DuplicateError("The prompt is already linked to this keyword.")
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.keyword_linked",
                target_type="prompt",
                target_id=body.prompt_id,
                info=info,
                after={"keyword_id": str(body.keyword_id), "is_primary": primary},
            )
            row = (await db.execute(_selected().where(links.c.id == link_id))).one()
        return _view(row)

    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, link_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            await live_project(db, access, project_id)
            removed = (
                await db.execute(
                    links.delete()
                    .where(
                        links.c.id == link_id,
                        links.c.workspace_id == access.workspace_id,
                        links.c.project_id == project_id,
                    )
                    .returning(links.c.prompt_id, links.c.keyword_id)
                )
            ).one_or_none()
            if removed is None:
                raise NotFoundError
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="prompt.keyword_unlinked",
                target_type="prompt",
                target_id=removed.prompt_id,
                info=info,
                before={"keyword_id": str(removed.keyword_id)},
            )
