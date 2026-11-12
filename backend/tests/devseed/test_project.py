"""The project is made once by slug and kept in line; the brand and the competitors are made or
completed by name, with their roles, and a second run writes nothing."""

from __future__ import annotations

import pytest

from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService
from idraft.api.schemas.entities import AliasInput
from idraft.devseed.context import SEED_INFO, SeedError, Sessions, seed_access
from idraft.devseed.project import EntityChanges, ensure_entities, ensure_project
from tests.api.auth.support import execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import (
    COUNTRY_IDS,
    FIXTURE,
    audit_count,
    gulf_locations,
    owner_workspace,
    seeded_project,
)

_PROJECT = (
    "SELECT p.name, p.slug, p.timezone, p.default_language_code, p.default_location_id, d.host "
    "FROM core.projects p JOIN core.domains d ON d.id = p.primary_domain_id WHERE p.id = $1"
)
_EXPECTED = (
    "Eventus Security",
    "eventus-security",
    "Asia/Kolkata",
    "en",
    2356,
    "eventussecurity.com",
)


async def test_the_project_is_made_once_with_the_fixtures_settings(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    access = seed_access(user.id, workspace.id)

    project_id, created = await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])

    assert created
    assert tuple(await fetchrow(migrated, _PROJECT, project_id)) == _EXPECTED
    before = await audit_count(migrated, workspace)
    assert await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"]) == (
        project_id,
        False,
    )
    assert await audit_count(migrated, workspace) == before


async def test_a_project_that_drifted_is_brought_back_in_line(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await execute(
        migrated,
        "UPDATE core.projects SET name = 'Old name', timezone = 'UTC' WHERE id = $1",
        project_id,
    )
    before = await audit_count(migrated, workspace)

    await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])

    assert tuple(await fetchrow(migrated, _PROJECT, project_id)) == _EXPECTED
    assert await audit_count(migrated, workspace) == before + 1


async def test_an_archived_project_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    await execute(
        migrated, "UPDATE core.projects SET status = 'archived' WHERE id = $1", project_id
    )

    with pytest.raises(SeedError, match="is archived"):
        await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])


async def test_the_brand_and_competitors_are_made_with_their_roles(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)

    changes = await ensure_entities(
        sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors
    )

    assert changes == EntityChanges(
        created=9, aliases_added=0, domains_added=0, updated=0, roles_given=9
    )
    roles = await fetch(
        migrated,
        "SELECT e.canonical_name, pe.role, pe.is_primary, pe.track_seo, pe.track_ai "
        "FROM core.project_entities pe JOIN core.entities e ON e.id = pe.entity_id "
        "WHERE pe.project_id = $1 AND pe.removed_at IS NULL "
        "ORDER BY pe.role DESC, e.canonical_name",
        project_id,
    )
    assert tuple(roles[0]) == ("Eventus Security", "own", True, True, True)
    assert [tuple(row)[1:] for row in roles[1:]] == [("competitor", False, False, True)] * 8
    aliases = await fetch(
        migrated,
        "SELECT a.alias FROM core.entity_aliases a JOIN core.entities e ON e.id = a.entity_id "
        "WHERE e.workspace_id = $1 AND e.canonical_name = 'Eventus Security'",
        workspace.id,
    )
    assert {row["alias"] for row in aliases} == {"Eventus", "Eventus Security Solutions"}
    darkwatch = await fetchrow(
        migrated,
        "SELECT is_ambiguous, disambiguation_hints FROM core.entities "
        "WHERE workspace_id = $1 AND canonical_name = 'Darkwatch SOC'",
        workspace.id,
    )
    assert tuple(darkwatch) == (True, ["soc", "security", "mdr"])
    hosts = await fetch(
        migrated,
        "SELECT d.host FROM core.entity_domains ed JOIN core.domains d ON d.id = ed.domain_id "
        "WHERE ed.workspace_id = $1",
        workspace.id,
    )
    assert {row["host"] for row in hosts} == {
        host for part in [FIXTURE.brand, *FIXTURE.competitors] for host in part.domains
    }

    before = await audit_count(migrated, workspace)
    again = await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
    assert again == EntityChanges(
        created=0, aliases_added=0, domains_added=0, updated=0, roles_given=0
    )
    assert await audit_count(migrated, workspace) == before


async def test_an_entity_the_workspace_has_is_completed_not_duplicated(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await EntityService(sessions=sessions).create(
        access,
        entity_type="brand",
        canonical_name="eventus security",
        parent_entity_id=None,
        description=None,
        is_ambiguous=False,
        disambiguation_hints=[],
        aliases=[AliasInput(alias="Eventus")],
        domains=[],
        info=SEED_INFO,
    )

    changes = await ensure_entities(
        sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors
    )

    assert (changes.created, changes.aliases_added, changes.domains_added) == (8, 1, 1)
    assert changes.roles_given == 9
    named = await fetch(
        migrated,
        "SELECT canonical_name FROM core.entities "
        "WHERE workspace_id = $1 AND lower(canonical_name) = 'eventus security'",
        workspace.id,
    )
    assert [row["canonical_name"] for row in named] == ["eventus security"]


async def test_a_brand_with_another_role_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    row = await EntityService(sessions=sessions).create(
        access,
        entity_type="brand",
        canonical_name="Eventus Security",
        parent_entity_id=None,
        description=None,
        is_ambiguous=False,
        disambiguation_hints=[],
        aliases=[],
        domains=[],
        info=SEED_INFO,
    )
    await ProjectEntityService(sessions=sessions).add(
        access,
        project_id,
        entity_id=row.entity.id,
        values={
            "role": "competitor",
            "is_primary": False,
            "track_seo": False,
            "track_ai": True,
            "color_index": None,
        },
        info=SEED_INFO,
    )

    with pytest.raises(SeedError, match="has the competitor role"):
        await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
