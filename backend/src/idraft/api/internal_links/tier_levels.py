"""Workspace tier settings (spec 5.1). A tier's code and colour come from its position; adding
appends the next position; deleting moves the tier's pages and rules to another tier or to
Untiered in the same transaction and closes the positions up. Every write locks the
workspace's tiers first, so two at once cannot both take position 5. Every change is audited.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.internal_links.page_tiers import close_rule_positions
from idraft.api.internal_links.problems import TierInUseError, TierLimitError
from idraft.api.problems import NotFoundError
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.internal_links import PageTierCreate, PageTierPatch
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.collectors.crawl_store import apply_rules, tiers_changed
from idraft.crawl.tiers import DEFAULT_TIERS, MAX_TIERS, tier_code
from idraft.db.engine import workspace_transaction
from idraft.db.tables import page_tier_levels, project_pages, projects, tier_rules

_levels = page_tier_levels


@dataclass(frozen=True, slots=True)
class TierLevel:
    tier_id: UUID
    position: int
    name: str
    description: str
    page_count: int
    rule_count: int
    updated_at: datetime

    @property
    def code(self) -> str:
        return tier_code(self.position)

    @property
    def label(self) -> str:
        return f"{self.code} {self.name}"


async def insert_default_tiers(db: AsyncSession, workspace_id: UUID) -> None:
    """T1 to T4 of a new workspace (decision D17); migration 0025 gave the old ones the same."""
    await db.execute(
        insert(_levels),
        [
            {"workspace_id": workspace_id, "position": position, "name": name, "description": text}
            for position, (name, text) in enumerate(DEFAULT_TIERS, start=1)
        ],
    )


async def list_levels(db: AsyncSession, workspace_id: UUID) -> list[TierLevel]:
    pages = (
        select(func.count())
        .where(
            project_pages.c.workspace_id == workspace_id, project_pages.c.tier_id == _levels.c.id
        )
        .scalar_subquery()
    )
    rules = (
        select(func.count())
        .where(tier_rules.c.workspace_id == workspace_id, tier_rules.c.tier_id == _levels.c.id)
        .scalar_subquery()
    )
    rows = await db.execute(
        select(
            _levels.c.id,
            _levels.c.position,
            _levels.c.name,
            _levels.c.description,
            _levels.c.updated_at,
            pages.label("page_count"),
            rules.label("rule_count"),
        )
        .where(_levels.c.workspace_id == workspace_id)
        .order_by(_levels.c.position)
    )
    return [
        TierLevel(
            tier_id=row.id,
            position=row.position,
            name=row.name,
            description=row.description,
            page_count=row.page_count,
            rule_count=row.rule_count,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


async def _lock_workspace(db: AsyncSession, workspace_id: UUID) -> None:
    # A row lock on no rows locks nothing, so a workspace with no tier needs a lock of its own.
    await db.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(str(workspace_id), 0)))
    )


async def _locked(db: AsyncSession, workspace_id: UUID) -> list[TierLevel]:
    await _lock_workspace(db, workspace_id)
    await db.execute(
        select(_levels.c.id).where(_levels.c.workspace_id == workspace_id).with_for_update()
    )
    return await list_levels(db, workspace_id)


async def _projects_on_tier(db: AsyncSession, workspace_id: UUID, tier_id: UUID) -> list[UUID]:
    """The projects with a page or a rule on the tier, in id order."""
    result = await db.execute(
        select(tier_rules.c.project_id)
        .where(tier_rules.c.workspace_id == workspace_id, tier_rules.c.tier_id == tier_id)
        .union(
            select(project_pages.c.project_id).where(
                project_pages.c.workspace_id == workspace_id,
                project_pages.c.tier_id == tier_id,
            )
        )
    )
    found: list[UUID] = list(result.scalars())
    return sorted(found)


async def _lock_projects(db: AsyncSession, workspace_id: UUID, project_ids: Sequence[UUID]) -> None:
    """Lock project rows in id order, as `get_project(for_update=True)` does (FOR NO KEY UPDATE).
    The crawl worker takes a project row, then its crawl, then the pages and the tier rows; a
    tier delete that took the tier rows first and the pages after would wait for the worker
    while the worker waited for it. So a delete takes the project rows before any tier row."""
    if project_ids:
        await db.execute(
            select(projects.c.id)
            .where(projects.c.workspace_id == workspace_id, projects.c.id.in_(project_ids))
            .order_by(projects.c.id)
            .with_for_update(of=projects, key_share=True)
        )


def _one(levels: Sequence[TierLevel], tier_id: UUID) -> TierLevel:
    for level in levels:
        if level.tier_id == tier_id:
            return level
    raise NotFoundError


def _query_error(name: str, code: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("query", name), "type": code, "msg": message}])


class TierLevelService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list(self, access: WorkspaceAccess) -> list[TierLevel]:
        async with self._transaction(access) as db:
            return await list_levels(db, access.workspace_id)

    async def add(
        self, access: WorkspaceAccess, body: PageTierCreate, info: RequestInfo
    ) -> TierLevel:
        async with self._transaction(access) as db:
            levels = await _locked(db, access.workspace_id)
            if len(levels) >= MAX_TIERS:
                raise TierLimitError
            tier_id: UUID = (
                await db.execute(
                    insert(_levels)
                    .values(
                        workspace_id=access.workspace_id,
                        position=len(levels) + 1,
                        name=body.name,
                        description=body.description,
                    )
                    .returning(_levels.c.id)
                )
            ).scalar_one()
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_tier.created",
                target_type="page_tier",
                target_id=tier_id,
                info=info,
                after={"name": body.name, "description": body.description},
            )
            return _one(await list_levels(db, access.workspace_id), tier_id)

    async def rename(
        self, access: WorkspaceAccess, tier_id: UUID, body: PageTierPatch, info: RequestInfo
    ) -> TierLevel:
        async with self._transaction(access) as db:
            before = _one(await _locked(db, access.workspace_id), tier_id)
            changes = body.model_dump(exclude_unset=True)
            await db.execute(
                update(_levels)
                .where(_levels.c.workspace_id == access.workspace_id, _levels.c.id == tier_id)
                .values(**changes, updated_at=func.now())
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="page_tier.updated",
                target_type="page_tier",
                target_id=tier_id,
                info=info,
                before={name: getattr(before, name) for name in changes},
                after=changes,
            )
            return _one(await list_levels(db, access.workspace_id), tier_id)

    async def delete(
        self,
        access: WorkspaceAccess,
        tier_id: UUID,
        move_to: UUID | Literal["none"] | None,
        info: RequestInfo,
    ) -> None:
        """Pages on the tier (manual or by rule) and the rules that name it move to `move_to`;
        to Untiered, manual pages become manual Untiered and the rules are deleted (a rule names
        a tier), which deletes their rule rows. A tier nothing uses needs no `move_to`."""
        async with self._transaction(access) as db:
            await _lock_workspace(db, access.workspace_id)
            locked = await _projects_on_tier(db, access.workspace_id, tier_id)
            await _lock_projects(db, access.workspace_id, locked)
            levels = await _locked(db, access.workspace_id)
            gone = _one(levels, tier_id)
            used = gone.page_count > 0 or gone.rule_count > 0
            if used and move_to is None:
                raise TierInUseError(page_count=gone.page_count, rule_count=gone.rule_count)
            if move_to == tier_id:
                raise _query_error("move_to", "move_to_self", "Move to another tier or `none`.")
            target = _one(levels, move_to).tier_id if isinstance(move_to, UUID) else None
            workspace = access.workspace_id
            # With the tier rows locked nothing can be put on the tier any more, so this is the
            # list read before them, unless a page or rule was added in between: lock those too.
            touched = await _projects_on_tier(db, workspace, tier_id)
            await _lock_projects(db, workspace, [id_ for id_ in touched if id_ not in locked])
            await db.execute(
                update(project_pages)
                .where(
                    project_pages.c.workspace_id == workspace, project_pages.c.tier_id == tier_id
                )
                .where(project_pages.c.tier_source == "manual")
                .values(tier_id=target, set_by=access.user_id, set_at=func.now())
            )
            if target is None:
                await db.execute(
                    delete(tier_rules).where(
                        tier_rules.c.workspace_id == workspace, tier_rules.c.tier_id == tier_id
                    )
                )
            else:
                await db.execute(
                    update(tier_rules)
                    .where(tier_rules.c.workspace_id == workspace, tier_rules.c.tier_id == tier_id)
                    .values(tier_id=target)
                )
                await db.execute(
                    update(project_pages)
                    .where(
                        project_pages.c.workspace_id == workspace,
                        project_pages.c.tier_id == tier_id,
                    )
                    .values(tier_id=target)
                )
            await db.execute(
                delete(_levels).where(_levels.c.workspace_id == workspace, _levels.c.id == tier_id)
            )
            await db.execute(
                update(_levels)
                .where(_levels.c.workspace_id == workspace, _levels.c.position > gone.position)
                .values(position=_levels.c.position - 1, updated_at=func.now())
            )
            for project_id in touched:
                await close_rule_positions(db, workspace, project_id)
                await apply_rules(db, workspace_id=workspace, project_id=project_id)
                await tiers_changed(db, workspace_id=workspace, project_id=project_id)
            await audit.record(
                db,
                workspace_id=workspace,
                actor_id=access.user_id,
                action="page_tier.deleted",
                target_type="page_tier",
                target_id=tier_id,
                info=info,
                before={
                    "name": gone.name,
                    "page_count": gone.page_count,
                    "rule_count": gone.rule_count,
                },
                after={"move_to": None if target is None else str(target)},
            )
