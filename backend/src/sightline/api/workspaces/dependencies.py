"""Who the caller is inside the workspace named in the path (docs/19 section 2.2).

Checks run in this order, and each answers before the next is looked at: session (401),
membership (404), project scope (404), a suspended workspace on a write (403), permission (403),
fresh session (403). FastAPI runs a dependency that raises before it reports body errors, so a
well-formed request for another workspace is answered 404 whatever its body holds. Two answers
come earlier and depend on nothing about the workspace: a body that is not JSON (400) and, for a
signed-in caller, a query parameter the route does not have (422).

A 403 says nothing about the resource: someone without the permission gets it for a project
that exists, one that does not and one of another workspace alike.

The membership is read from the database on every request and never cached: a removed member, a
disabled user and a changed role take effect on the next request.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import structlog
from fastapi import Depends, Path, Request
from sqlalchemy import select

from sightline.api.access import AccessRule, declare
from sightline.api.auth.dependencies import CurrentSession
from sightline.api.auth.sessions import REAUTH_URL
from sightline.api.permissions import Permission, Role
from sightline.api.problems import (
    ForbiddenError,
    FreshSessionRequiredError,
    NotFoundError,
    WorkspaceSuspendedError,
)
from sightline.api.resources import Resources, get_resources
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import user_transaction
from sightline.db.tables import memberships, users, workspaces


@contextmanager
def _in_workspace(request: Request, workspace_id: UUID) -> Iterator[None]:
    """Name the workspace in every log line of this request, as the session names the user."""
    request.state.workspace_id = str(workspace_id)
    tokens = structlog.contextvars.bind_contextvars(workspace_id=str(workspace_id))
    try:
        yield
    finally:
        structlog.contextvars.reset_contextvars(**tokens)


_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _project_in_path(request: Request) -> UUID | None:
    raw = request.path_params.get("project_id")
    if raw is None:
        return None
    try:
        return UUID(str(raw))
    except ValueError:
        # Not an id at all, so it names nothing the caller can see.
        raise NotFoundError from None


@declare(AccessRule("member"))
async def workspace_member(
    workspace_id: Annotated[UUID, Path()],
    request: Request,
    session: CurrentSession,
    resources: Annotated[Resources, Depends(get_resources)],
) -> AsyncIterator[WorkspaceAccess]:
    """The caller's membership of the path workspace. 404 when there is none to see.

    The project scope is checked here for a path parameter named `project_id`, which is what
    every project route calls it (tests/api/test_route_access.py). A route that takes a project
    id anywhere else, in the query or the body, must check `access.sees(...)` itself.
    """
    statement = (
        select(memberships.c.role, memberships.c.project_ids, workspaces.c.status)
        .join(workspaces, workspaces.c.id == memberships.c.workspace_id)
        .join(users, users.c.id == memberships.c.user_id)
        .where(
            memberships.c.workspace_id == workspace_id,
            memberships.c.user_id == session.user_id,
            workspaces.c.status != "deleting",
            users.c.disabled_at.is_(None),
        )
    )
    # Named before the lookup, so the log line of a refused attempt says what was tried.
    with _in_workspace(request, workspace_id):
        async with user_transaction(resources.sessions, session.user_id) as db:
            row = (await db.execute(statement)).one_or_none()
        if row is None:
            raise NotFoundError
        access = WorkspaceAccess(
            session=session,
            workspace_id=workspace_id,
            role=Role(row.role),
            project_ids=None if row.project_ids is None else frozenset(row.project_ids),
        )
        project_id = _project_in_path(request)
        if project_id is not None and not access.sees(project_id):
            raise NotFoundError
        if row.status == "suspended" and request.method not in _READ_METHODS:
            raise WorkspaceSuspendedError
        yield access


MemberAccess = Annotated[WorkspaceAccess, Depends(workspace_member)]


def require_permission(
    permission: Permission, *, fresh: bool = False, every_project: bool = False
) -> Callable[[WorkspaceAccess], WorkspaceAccess]:
    """A dependency for a route that needs `permission` in the path workspace.

    With `every_project`, the member must not be limited to some of the workspace's projects.
    With `fresh`, the session must also have re-entered a credential in the last 10 minutes.
    """

    @declare(AccessRule("permission", permission, fresh=fresh, every_project=every_project))
    def check(access: MemberAccess) -> WorkspaceAccess:
        if not access.holds(permission):
            raise ForbiddenError
        if every_project and access.project_ids is not None:
            raise ForbiddenError("Not available to a member who is limited to some projects.")
        if fresh and not access.session.is_fresh(datetime.now(UTC)):
            raise FreshSessionRequiredError(reauth_url=REAUTH_URL)
        return access

    return check
