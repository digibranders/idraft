"""The seed's actor is an active owner of the named workspace, found as the API role finds
memberships; the three countries must be active locations."""

from __future__ import annotations

import re

import pytest

from idraft.api.permissions import Role
from idraft.devseed.context import SeedError, Sessions, country_locations, find_owner
from tests.api.auth.support import add_member, execute, make_user, make_workspace
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


async def test_the_newest_of_several_owners_is_the_actor(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    _, workspace = await owner_workspace(migrated)
    newer = await make_user(migrated)
    await add_member(migrated, workspace, newer, "owner")

    assert (await find_owner(sessions, workspace.slug)).user_id == newer.id


async def test_an_owner_of_another_workspace_who_is_only_admin_here_is_not_the_actor(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    owner, workspace = await owner_workspace(migrated)
    # Newer than the owner, so first in line, and an owner (of the other workspace) at that.
    visitor = await make_user(migrated)
    other = await make_workspace(migrated, name="Other")
    await add_member(migrated, other, visitor, "owner")
    await add_member(migrated, workspace, visitor, "admin")

    assert (await find_owner(sessions, workspace.slug)).user_id == owner.id


async def test_a_workspace_with_admins_but_no_owner_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    workspace = await make_workspace(migrated)
    admin = await make_user(migrated)
    await add_member(migrated, workspace, admin, "admin")

    with pytest.raises(SeedError, match=workspace.slug):
        await find_owner(sessions, workspace.slug)


@pytest.mark.parametrize("status", ["suspended", "deleting"])
async def test_a_missing_suspended_or_deleting_workspace_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions, status: str
) -> None:
    with pytest.raises(SeedError, match="No active workspace 'no-such-workspace'"):
        await find_owner(sessions, "no-such-workspace")

    _, workspace = await owner_workspace(migrated)
    await execute(
        migrated, "UPDATE auth.workspaces SET status = $2 WHERE id = $1", workspace.id, status
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
        with pytest.raises(SeedError) as caught:
            await country_locations(sessions, ["IN", "AE", "SA"])
        # Only SA is listed: IN and AE are there and active.
        assert re.search(r"active country location for SA\. ", str(caught.value))
        assert "sync_locations" in str(caught.value)
        await execute(migrated, "UPDATE core.locations SET is_active = false WHERE id = 2356")
        with pytest.raises(SeedError, match=r"active country location for IN, SA\. "):
            await country_locations(sessions, ["SA", "IN", "AE"])
    finally:
        await gulf_locations(migrated)
