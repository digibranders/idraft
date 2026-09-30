"""Workspace audit entries (docs/24-security.md section 12)."""

import uuid

import pytest
from sqlalchemy.exc import DBAPIError

from sightline.api import audit
from sightline.api.request_info import RequestInfo
from sightline.api.resources import Resources
from sightline.db.engine import workspace_transaction
from tests.api.auth.support import fetch, make_user, make_workspace
from tests.conftest import PostgresServer

INFO = RequestInfo(ip="203.0.113.7", user_agent="pytest", request_id="req_audit_test")


async def test_an_entry_names_the_workspace_the_actor_and_the_request(
    resources: Resources, migrated: PostgresServer
) -> None:
    workspace, actor = await make_workspace(migrated), await make_user(migrated)
    target = uuid.uuid4()

    async with workspace_transaction(resources.sessions, workspace.id, user_id=actor.id) as db:
        await audit.record(
            db,
            workspace_id=workspace.id,
            actor_id=actor.id,
            action="project.updated",
            target_type="project",
            target_id=target,
            info=INFO,
            before={"name": "Old"},
            after={"name": "New", "status": None},
        )

    (row,) = await fetch(migrated, "SELECT * FROM ops.audit_logs WHERE target_id = $1", str(target))
    assert row["workspace_id"] == workspace.id
    assert (row["actor_type"], row["actor_id"]) == ("user", str(actor.id))
    assert (row["action"], row["target_type"]) == ("project.updated", "project")
    assert (row["before"], row["after"]) == ('{"name": "Old"}', '{"name": "New", "status": null}')
    assert (str(row["ip"]), row["user_agent"], row["request_id"]) == (
        "203.0.113.7",
        "pytest",
        "req_audit_test",
    )
    assert row["occurred_at"] is not None


async def test_an_entry_cannot_be_written_into_another_workspace(
    resources: Resources, migrated: PostgresServer
) -> None:
    mine, theirs = await make_workspace(migrated), await make_workspace(migrated)
    actor, target = await make_user(migrated), uuid.uuid4()

    with pytest.raises(DBAPIError, match="row-level security"):
        async with workspace_transaction(resources.sessions, mine.id, user_id=actor.id) as db:
            await audit.record(
                db,
                workspace_id=theirs.id,
                actor_id=actor.id,
                action="project.updated",
                target_type="project",
                target_id=target,
                info=INFO,
            )

    assert (
        await fetch(migrated, "SELECT 1 FROM ops.audit_logs WHERE target_id = $1", str(target))
        == []
    )
