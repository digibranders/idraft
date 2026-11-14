"""Budgets: list, add, change and delete (docs/19-api-specification.md section 3.11.2; WP-30 plan
decision D9). A budget is a monthly limit in US dollars for the workspace or one project and one
budget group; the planner judges work against it. Nothing here starts a run or spends: writing
a budget stores a limit, and only `budgets:manage` may.

A member limited to some projects reaches the budgets of those projects only. A budget out of
their reach is `404`, the same answer as for an id that names nothing. Each write is audited in
the transaction of the change.
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from decimal import Decimal
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.operations import budgets_repository as repository
from idraft.api.operations.costs_repository import BudgetRecord
from idraft.api.problems import NotFoundError, invalid_field
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.budgets import BudgetCreate, BudgetUpdate
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction

_CENT: Final = Decimal("0.01")
_TARGET: Final = "budget"


@dataclass(frozen=True, slots=True)
class BudgetPage:
    budgets: list[BudgetRecord]
    total: int


def _snapshot(record: BudgetRecord) -> audit.Snapshot:
    return {
        "project_id": None if record.project_id is None else str(record.project_id),
        # A budget with no group covers everything, as the API shows it.
        "workload": record.workload or "all",
        "limit_usd": format(record.limit_usd, "f"),
        "soft_limit_pct": record.soft_limit_pct,
        "action_on_hard": record.action_on_hard,
    }


class BudgetService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def page(
        self, access: WorkspaceAccess, *, project_id: UUID | None, offset: int, limit: int
    ) -> BudgetPage:
        """A page of the budgets the caller reaches, oldest first."""
        if project_id is not None and not access.sees(project_id):
            raise NotFoundError
        async with self._transaction(access) as db:
            if project_id is not None and not await repository.live_project_exists(
                db, access.workspace_id, project_id
            ):
                raise NotFoundError
            found, total = await repository.list_page(
                db,
                access.workspace_id,
                access.project_ids,
                project_id=project_id,
                offset=offset,
                limit=limit,
            )
        return BudgetPage(found, total)

    async def create(
        self, access: WorkspaceAccess, body: BudgetCreate, info: RequestInfo
    ) -> BudgetRecord:
        # Out of reach before the project is looked up, so a member learns nothing of projects
        # or of the workspace's own budgets beyond their scope.
        if access.project_ids is not None and (
            body.project_id is None or body.project_id not in access.project_ids
        ):
            raise NotFoundError
        values: dict[str, object] = {
            "project_id": body.project_id,
            # The group `all` is stored as no group.
            "workload": None if body.workload == "all" else body.workload,
            "limit_usd": body.limit_usd.quantize(_CENT),
        }
        # The columns' own defaults (80 percent, pause) fill what is left out.
        if body.soft_limit_pct is not None:
            values["soft_limit_pct"] = body.soft_limit_pct
        if body.action_on_hard is not None:
            values["action_on_hard"] = body.action_on_hard
        async with self._transaction(access) as db:
            if body.project_id is not None and not await repository.live_project_exists(
                db, access.workspace_id, body.project_id
            ):
                raise invalid_field(
                    "project_id",
                    code="project_unknown",
                    message="The workspace has no such project.",
                )
            made = await repository.insert_budget(db, access.workspace_id, values)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="budget.created",
                target_type=_TARGET,
                target_id=made.id,
                info=info,
                after=_snapshot(made),
            )
        return made

    async def update(
        self, access: WorkspaceAccess, budget_id: UUID, body: BudgetUpdate, info: RequestInfo
    ) -> BudgetRecord:
        values: dict[str, object] = {}
        if body.limit_usd is not None:
            values["limit_usd"] = body.limit_usd.quantize(_CENT)
        if body.soft_limit_pct is not None:
            values["soft_limit_pct"] = body.soft_limit_pct
        if body.action_on_hard is not None:
            values["action_on_hard"] = body.action_on_hard
        async with self._transaction(access) as db:
            current = await repository.get_budget(
                db, access.workspace_id, access.project_ids, budget_id, lock=True
            )
            if current is None:
                raise NotFoundError
            changed = await repository.update_budget(db, access.workspace_id, budget_id, values)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="budget.updated",
                target_type=_TARGET,
                target_id=budget_id,
                info=info,
                before=_snapshot(current),
                after=_snapshot(changed),
            )
        return changed

    async def delete(self, access: WorkspaceAccess, budget_id: UUID, info: RequestInfo) -> None:
        async with self._transaction(access) as db:
            current = await repository.get_budget(
                db, access.workspace_id, access.project_ids, budget_id, lock=True
            )
            if current is None:
                raise NotFoundError
            await repository.delete_budget(db, access.workspace_id, budget_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="budget.deleted",
                target_type=_TARGET,
                target_id=budget_id,
                info=info,
                before=_snapshot(current),
            )
