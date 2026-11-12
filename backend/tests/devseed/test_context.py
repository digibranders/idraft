"""The seed's actor is an active owner of the named workspace, found as the API role finds
memberships; the three countries must be active locations."""

from __future__ import annotations

import pytest

from idraft.api.permissions import Role
from idraft.devseed.context import SeedError, Sessions, country_locations, find_owner
from tests.api.auth.support import add_member, execute, make_user
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, gulf_locations, owner_workspace


async def test_the_owner_is_found_by_the_workspace_slug(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    admin = await make_user(migrated)
    await add_member(migrated, workspace, admin, "admin")

    access = await find_owner(sessions, workspace.slug)

    assert (access.user_id, access.workspace_id) == (user.id, workspace.id)
    assert (access.role, access.project_ids) == (Role.OWNER, None)


async def test_a_disabled_owner_is_passed_over(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    disabled = await make_user(migrated, disabled=True)
    await add_member(migrated, workspace, disabled, "owner")

    assert (await find_owner(sessions, workspace.slug)).user_id == user.id


async def test_a_missing_or_suspended_workspace_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    with pytest.raises(SeedError, match="No active workspace 'no-such-workspace'"):
        await find_owner(sessions, "no-such-workspace")

    _, workspace = await owner_workspace(migrated)
    await execute(
        migrated, "UPDATE auth.workspaces SET status = 'suspended' WHERE id = $1", workspace.id
    )
    with pytest.raises(SeedError, match=workspace.slug):
        await find_owner(sessions, workspace.slug)


async def test_the_three_countries_are_found(migrated: PostgresServer, sessions: Sessions) -> None:
    await gulf_locations(migrated)

    assert await country_locations(sessions, ["SA", "IN", "AE"]) == COUNTRY_IDS


async def test_a_missing_or_inactive_country_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    await gulf_locations(migrated)
    await execute(migrated, "UPDATE core.locations SET is_active = false WHERE id = 2682")
    try:
        with pytest.raises(SeedError, match="SA") as caught:
            await country_locations(sessions, ["IN", "AE", "SA"])
        assert "sync_locations" in str(caught.value)
    finally:
        await gulf_locations(migrated)
