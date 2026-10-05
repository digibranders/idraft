"""Rules for keyword groups (docs/19-api-specification.md section 3.6.2).

Group writes in one project run one at a time (`lock_groups`), and each is audited in its
transaction. A name is unique among its siblings without case; a move under the group itself or
under one of its subgroups is `422 cycle_detected`. Deleting a group takes its subgroups and
unlinks their keywords; the keywords stay.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.keywords import group_repository as groups
from sightline.api.keywords import repository as keywords
from sightline.api.keywords.group_repository import GroupNameTakenError, GroupRecord
from sightline.api.problems import CycleDetectedError, DuplicateError, NotFoundError, invalid_field
from sightline.api.request_info import RequestInfo
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.keywords.groups import GROUP_DEPTH_MAX, PATH_BYTES_MAX


@dataclass(frozen=True, slots=True)
class GroupBranch:
    group: GroupRecord
    children: list[GroupBranch]


def arrange(found: Sequence[GroupRecord], *, tree: bool) -> list[GroupBranch]:
    """The groups in path order; in a tree, each under its parent."""
    if not tree:
        return [GroupBranch(group, []) for group in found]
    branches = {group.id: GroupBranch(group, []) for group in found}
    roots: list[GroupBranch] = []
    for group in found:
        parent = None if group.parent_id is None else branches.get(group.parent_id)
        (roots if parent is None else parent.children).append(branches[group.id])
    return roots


def _taken() -> DuplicateError:
    return DuplicateError("A group under this parent has this name.")


def _bytes(path: str) -> int:
    return len(path.encode())


def _fits(path: str, *, deepest: int, longest: int) -> None:
    """Groups are at most `GROUP_DEPTH_MAX` levels deep, and a path holds at most
    `PATH_BYTES_MAX` bytes (the database checks the same, under its index's row limit).
    `deepest` counts the `/` of the deepest path the change makes."""
    if deepest + 1 > GROUP_DEPTH_MAX:
        raise invalid_field(
            "parent_id",
            code="too_deep",
            message=f"Groups are at most {GROUP_DEPTH_MAX} levels deep.",
        )
    if longest > PATH_BYTES_MAX:
        raise invalid_field(
            "name",
            code="path_too_long",
            message=f"A group's path holds at most {PATH_BYTES_MAX} bytes; use shorter names.",
        )


def _snapshot(group: GroupRecord) -> dict[str, str | None]:
    return {
        "parent_id": None if group.parent_id is None else str(group.parent_id),
        "name": group.name,
        "path": group.path,
    }


class GroupService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def list_groups(
        self, access: WorkspaceAccess, project_id: UUID, *, tree: bool
    ) -> list[GroupBranch]:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            found = await groups.list_groups(db, access.workspace_id, project_id)
        return arrange(found, tree=tree)

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        name: str,
        parent_id: UUID | None,
        info: RequestInfo,
    ) -> GroupRecord:
        try:
            async with self._transaction(access) as db:
                await self._project(db, access, project_id)
                await groups.lock_groups(db, project_id)
                parent = None
                if parent_id is not None:
                    parent = await self._parent(db, access, project_id, parent_id)
                path = name if parent is None else f"{parent.path}/{name}"
                _fits(path, deepest=path.count("/"), longest=_bytes(path))
                group_id = await groups.insert_group(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    parent_id=parent_id,
                    name=name,
                    path=path,
                )
                created = await self._group(db, access, project_id, group_id)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="keyword_group.created",
                    target_type="keyword_group",
                    target_id=group_id,
                    info=info,
                    after={"project_id": str(project_id), **_snapshot(created)},
                )
        except GroupNameTakenError:
            raise _taken() from None
        return created

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        group_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> GroupRecord:
        """A rename or a move rewrites the paths of the group and its subtree. Nothing is
        written or logged when nothing differs."""
        try:
            async with self._transaction(access) as db:
                await self._project(db, access, project_id)
                await groups.lock_groups(db, project_id)
                current = await self._group(db, access, project_id, group_id)
                name = str(changes.get("name", current.name))
                parent_id = changes.get("parent_id", current.parent_id)
                if not isinstance(parent_id, UUID | None):  # pragma: no cover - the schema's type
                    raise TypeError("parent_id is a UUID or None")
                if (name, parent_id) == (current.name, current.parent_id):
                    return current
                parent = None
                if parent_id is not None:
                    if parent_id == current.id:
                        raise CycleDetectedError("A group cannot be its own parent.")
                    parent = await self._parent(db, access, project_id, parent_id)
                    if parent.path.startswith(f"{current.path}/"):
                        raise CycleDetectedError("The parent is under this group.")
                new_path = name if parent is None else f"{parent.path}/{name}"
                # The subtree moves with the group: its deepest and longest paths change by
                # what the group's own path changes by.
                deepest, longest = await groups.subtree_extent(
                    db, access.workspace_id, project_id, current.path
                )
                _fits(
                    new_path,
                    deepest=deepest - current.path.count("/") + new_path.count("/"),
                    longest=longest - _bytes(current.path) + _bytes(new_path),
                )
                await groups.change_group(
                    db,
                    workspace_id=access.workspace_id,
                    group_id=group_id,
                    values={"name": name, "parent_id": parent_id},
                    project_id=project_id,
                    old_path=current.path,
                    new_path=new_path,
                )
                updated = await self._group(db, access, project_id, group_id)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="keyword_group.updated",
                    target_type="keyword_group",
                    target_id=group_id,
                    info=info,
                    before=_snapshot(current),
                    after=_snapshot(updated),
                )
        except GroupNameTakenError:
            raise _taken() from None
        return updated

    async def delete(
        self, access: WorkspaceAccess, project_id: UUID, group_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            await groups.lock_groups(db, project_id)
            current = await self._group(db, access, project_id, group_id)
            await groups.delete_group(db, access.workspace_id, group_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="keyword_group.deleted",
                target_type="keyword_group",
                target_id=group_id,
                info=info,
                before={**_snapshot(current), "keyword_count": current.keyword_count},
            )

    async def add_members(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        group_id: UUID,
        tracked_ids: Collection[UUID],
        info: RequestInfo,
    ) -> int:
        """The project's live tracked keywords among `tracked_ids` join the group; how many
        were not in it."""
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            # Held, so a delete of the group waits for the members to be added.
            await self._group(db, access, project_id, group_id, hold=True)
            added = await groups.add_members(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                group_id=group_id,
                tracked_ids=tracked_ids,
            )
            await self._audit_members(
                db, access, group_id, "keyword_group.members_added", added, info
            )
        return len(added)

    async def remove_members(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        group_id: UUID,
        tracked_ids: Collection[UUID],
        info: RequestInfo,
    ) -> int:
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            await self._group(db, access, project_id, group_id)
            removed = await groups.remove_members(db, access.workspace_id, group_id, tracked_ids)
            await self._audit_members(
                db, access, group_id, "keyword_group.members_removed", removed, info
            )
        return len(removed)

    # Shared steps.

    @staticmethod
    async def _project(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> None:
        if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
            raise NotFoundError

    @staticmethod
    async def _group(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        group_id: UUID,
        *,
        hold: bool = False,
    ) -> GroupRecord:
        found = await groups.get_group(db, access.workspace_id, project_id, group_id, hold=hold)
        if found is None:
            raise NotFoundError
        return found

    @staticmethod
    async def _parent(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, parent_id: UUID
    ) -> GroupRecord:
        found = await groups.get_group(db, access.workspace_id, project_id, parent_id)
        if found is None:
            raise invalid_field(
                "parent_id", code="group_unknown", message="No such group in the project."
            )
        return found

    @staticmethod
    async def _audit_members(
        db: AsyncSession,
        access: WorkspaceAccess,
        group_id: UUID,
        action: audit.AuditAction,
        changed: Sequence[UUID],
        info: RequestInfo,
    ) -> None:
        if not changed:
            return
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action=action,
            target_type="keyword_group",
            target_id=group_id,
            info=info,
            after={"tracked_keyword_ids": sorted(map(str, changed))},
        )
