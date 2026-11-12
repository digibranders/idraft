"""Helpers of the dev seed tests: an owner and their workspace, the fixture's three countries and
an audit count."""

from __future__ import annotations

import uuid
from typing import Final

from idraft.api.workspaces.access import WorkspaceAccess
from idraft.devseed.context import Sessions, seed_access
from idraft.devseed.fixture import DEFAULT_FIXTURE, load_fixture
from idraft.devseed.project import ensure_project
from tests.api.auth.support import (
    User,
    Workspace,
    add_member,
    execute,
    fetchrow,
    make_user,
    make_workspace,
)
from tests.conftest import PostgresServer

FIXTURE: Final = load_fixture(DEFAULT_FIXTURE)
# Google Ads geo target ids, which are the location ids (docs/04 section 5.2).
COUNTRY_IDS: Final = {"IN": 2356, "AE": 2784, "SA": 2682}


async def owner_workspace(pg: PostgresServer) -> tuple[User, Workspace]:
    user = await make_user(pg)
    workspace = await make_workspace(pg, name="Digibranders")
    await add_member(pg, workspace, user, "owner")
    return user, workspace


async def gulf_locations(pg: PostgresServer) -> None:
    """India, the UAE and Saudi Arabia as active countries. Locations are global, so a row an
    earlier test changed is set back."""
    await execute(
        pg,
        "INSERT INTO core.locations (id, name, country_iso, location_type) VALUES "
        "(2356, 'India', 'IN', 'Country'), (2784, 'United Arab Emirates', 'AE', 'Country'), "
        "(2682, 'Saudi Arabia', 'SA', 'Country') ON CONFLICT (id) DO UPDATE SET "
        "is_active = true, country_iso = excluded.country_iso, "
        "location_type = excluded.location_type",
    )


async def audit_count(pg: PostgresServer, workspace: Workspace) -> int:
    row = await fetchrow(
        pg, "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1", workspace.id
    )
    return int(row["n"])


async def written(pg: PostgresServer, workspace: Workspace) -> tuple[int, ...]:
    """What a seed run adds to: audit entries, entities, aliases, domain claims, project roles
    and taxonomy terms of the workspace. Equal before and after means nothing was written."""
    row = await fetchrow(
        pg,
        "SELECT (SELECT count(*) FROM ops.audit_logs WHERE workspace_id = $1), "
        "(SELECT count(*) FROM core.entities WHERE workspace_id = $1), "
        "(SELECT count(*) FROM core.entity_aliases WHERE workspace_id = $1), "
        "(SELECT count(*) FROM core.entity_domains WHERE workspace_id = $1), "
        "(SELECT count(*) FROM core.project_entities WHERE workspace_id = $1), "
        "(SELECT count(*) FROM core.taxonomy_terms WHERE workspace_id = $1)",
        workspace.id,
    )
    return tuple(int(value) for value in row)


async def seeded_project(
    pg: PostgresServer, sessions: Sessions
) -> tuple[WorkspaceAccess, Workspace, uuid.UUID]:
    """An owner, their workspace, the three countries and the fixture's project."""
    user, workspace = await owner_workspace(pg)
    await gulf_locations(pg)
    access = seed_access(user.id, workspace.id)
    project_id, _ = await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])
    return access, workspace, project_id
