"""The project is made once by slug and kept in line; the brand and the competitors are made or
completed by name, with their roles, and a second run writes nothing."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from idraft.api.entities.project_service import ProjectEntityService
from idraft.api.entities.service import EntityService
from idraft.api.schemas.entities import AliasInput, DomainInput
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.devseed.context import SEED_INFO, SeedError, Sessions, seed_access
from idraft.devseed.project import EntityChanges, ensure_entities, ensure_project
from idraft.devseed.topics import ensure_topics
from tests.api.auth.support import execute, fetch, fetchrow
from tests.api.keywords.support import group as keyword_group
from tests.conftest import PostgresServer
from tests.devseed.support import (
    COUNTRY_IDS,
    FIXTURE,
    audit_count,
    gulf_locations,
    owner_workspace,
    seeded_project,
    written,
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


async def test_a_missing_default_location_is_filled_and_a_name_case_is_left(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await execute(
        migrated,
        "UPDATE core.projects SET default_location_id = NULL, name = 'EVENTUS SECURITY' "
        "WHERE id = $1",
        project_id,
    )
    before = await audit_count(migrated, workspace)

    await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])

    row = tuple(await fetchrow(migrated, _PROJECT, project_id))
    assert row == ("EVENTUS SECURITY", *_EXPECTED[1:])
    assert await audit_count(migrated, workspace) == before + 1


async def test_a_value_a_person_set_stops_the_seed_and_nothing_is_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await execute(
        migrated,
        "UPDATE core.projects SET name = 'Old name', timezone = 'UTC', "
        "default_location_id = $2 WHERE id = $1",
        project_id,
        COUNTRY_IDS["AE"],
    )
    before = await written(migrated, workspace)
    row = tuple(await fetchrow(migrated, _PROJECT, project_id))

    with pytest.raises(SeedError) as stopped:
        await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])

    message = str(stopped.value)
    assert "name is 'Old name' in the project and 'Eventus Security' in the fixture" in message
    assert "timezone is 'UTC' in the project and 'Asia/Kolkata' in the fixture" in message
    assert "default_location_id is 2784 in the project and 2356 in the fixture" in message
    assert await written(migrated, workspace) == before
    assert tuple(await fetchrow(migrated, _PROJECT, project_id)) == row


async def test_a_project_with_keyword_data_is_left_exactly_as_it_was(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
    await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    keyword = await fetchrow(
        migrated,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, 'managed soc', 'managed soc', 'en') RETURNING id",
        workspace.id,
    )
    tracked = await fetchrow(
        migrated,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device) VALUES ($1, $2, $3, $4, 'en', 'desktop') RETURNING id",
        workspace.id,
        project_id,
        keyword["id"],
        COUNTRY_IDS["IN"],
    )
    group_id = await keyword_group(migrated, workspace, project_id, "Managed SOC")
    await execute(
        migrated,
        "INSERT INTO seo.keyword_group_members (group_id, tracked_keyword_id, project_id, "
        "workspace_id) VALUES ($1, $2, $3, $4)",
        uuid.UUID(group_id),
        tracked["id"],
        project_id,
        workspace.id,
    )
    snapshot = (
        "SELECT (SELECT count(*) FROM seo.keywords WHERE workspace_id = $1), "
        "(SELECT count(*) FROM seo.tracked_keywords WHERE workspace_id = $1), "
        "(SELECT count(*) FROM seo.keyword_groups WHERE workspace_id = $1), "
        "(SELECT count(*) FROM seo.keyword_group_members WHERE workspace_id = $1), "
        "(SELECT md5(p::text) FROM core.projects p WHERE p.id = $2), "
        "(SELECT md5(t::text) FROM seo.tracked_keywords t WHERE t.id = $3)"
    )
    before = tuple(await fetchrow(migrated, snapshot, workspace.id, project_id, tracked["id"]))
    written_before = await written(migrated, workspace)

    await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])
    await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
    await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    after = tuple(await fetchrow(migrated, snapshot, workspace.id, project_id, tracked["id"]))
    assert after == before
    assert await written(migrated, workspace) == written_before


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


async def _make(
    sessions: Sessions,
    access: WorkspaceAccess,
    name: str,
    *,
    entity_type: str = "brand",
    domains: tuple[str, ...] = (),
    is_ambiguous: bool = False,
    hints: tuple[str, ...] = (),
) -> uuid.UUID:
    row = await EntityService(sessions=sessions).create(
        access,
        entity_type=entity_type,
        canonical_name=name,
        parent_entity_id=None,
        description=None,
        is_ambiguous=is_ambiguous,
        disambiguation_hints=list(hints),
        aliases=[],
        domains=[DomainInput(domain=domain) for domain in domains],
        info=SEED_INFO,
    )
    return row.entity.id


async def _give(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: uuid.UUID,
    entity_id: uuid.UUID,
    role: str,
    *,
    primary: bool = False,
) -> None:
    values: dict[str, Any] = {
        "role": role,
        "is_primary": primary,
        "track_seo": primary,
        "track_ai": True,
        "color_index": None,
    }
    await ProjectEntityService(sessions=sessions).add(
        access, project_id, entity_id=entity_id, values=values, info=SEED_INFO
    )


async def _run(sessions: Sessions, access: WorkspaceAccess, project_id: uuid.UUID) -> EntityChanges:
    return await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)


async def test_a_brand_with_another_role_stops_the_seed_before_any_write(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    brand = await _make(sessions, access, "Eventus Security")
    await _give(sessions, access, project_id, brand, "competitor")
    before = await written(migrated, workspace)

    with pytest.raises(SeedError, match="has the competitor role"):
        await _run(sessions, access, project_id)

    assert await written(migrated, workspace) == before


async def test_a_competitor_with_another_role_stops_the_seed_before_any_write(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    darkwatch = await _make(sessions, access, "Darkwatch SOC")
    await _give(sessions, access, project_id, darkwatch, "watch")
    before = await written(migrated, workspace)

    with pytest.raises(SeedError, match="Darkwatch SOC: it has the watch role"):
        await _run(sessions, access, project_id)

    assert await written(migrated, workspace) == before


async def test_every_wrong_role_is_listed_in_one_error(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    brand = await _make(sessions, access, "Eventus Security")
    await _give(sessions, access, project_id, brand, "watch")
    nexaguard = await _make(sessions, access, "Nexaguard")
    await _give(sessions, access, project_id, nexaguard, "own")
    before = await written(migrated, workspace)

    with pytest.raises(SeedError) as stopped:
        await _run(sessions, access, project_id)

    message = str(stopped.value)
    assert "Eventus Security: it has the watch role" in message
    assert "Nexaguard: it has the own role" in message
    assert await written(migrated, workspace) == before


async def test_another_primary_own_entity_is_not_demoted(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    other = await _make(sessions, access, "Other Brand")
    await _give(sessions, access, project_id, other, "own", primary=True)
    before = await written(migrated, workspace)

    with pytest.raises(SeedError, match="Other Brand: it is the project's primary own entity"):
        await _run(sessions, access, project_id)

    assert await written(migrated, workspace) == before
    primary = await fetchrow(
        migrated,
        "SELECT entity_id FROM core.project_entities WHERE project_id = $1 AND is_primary",
        project_id,
    )
    assert primary["entity_id"] == other


async def test_a_role_the_project_removed_is_not_brought_back(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await _run(sessions, access, project_id)
    ironfort = await fetchrow(
        migrated,
        "SELECT id FROM core.entities "
        "WHERE workspace_id = $1 AND canonical_name = 'Ironfort Cyber'",
        workspace.id,
    )
    await ProjectEntityService(sessions=sessions).remove(
        access, project_id, ironfort["id"], SEED_INFO
    )
    before = await written(migrated, workspace)

    with pytest.raises(SeedError, match="the project removed this competitor role"):
        await _run(sessions, access, project_id)

    assert await written(migrated, workspace) == before


async def test_an_entity_of_another_type_with_the_brands_name_is_not_the_brand(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    product = await _make(sessions, access, "eventus security", entity_type="product")

    changes = await _run(sessions, access, project_id)

    assert changes.created == 9
    rows = await fetch(
        migrated,
        "SELECT id, entity_type FROM core.entities "
        "WHERE workspace_id = $1 AND lower(canonical_name) = 'eventus security' "
        "ORDER BY entity_type",
        workspace.id,
    )
    assert [(row["id"], row["entity_type"]) for row in rows] == [
        (rows[0]["id"], "brand"),
        (product, "product"),
    ]
    role = await fetchrow(
        migrated,
        "SELECT entity_id FROM core.project_entities WHERE project_id = $1 AND is_primary",
        project_id,
    )
    assert role["entity_id"] == rows[0]["id"]


async def test_a_brand_a_person_made_ambiguous_keeps_it(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await _make(
        sessions, access, "Eventus Security", is_ambiguous=True, hints=("security", "events")
    )

    changes = await _run(sessions, access, project_id)

    assert changes.updated == 0
    kept = await fetchrow(
        migrated,
        "SELECT is_ambiguous, disambiguation_hints FROM core.entities "
        "WHERE workspace_id = $1 AND canonical_name = 'Eventus Security'",
        workspace.id,
    )
    assert tuple(kept) == (True, ["security", "events"])


async def test_a_competitor_keeps_the_fixtures_ambiguity(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    await _make(sessions, access, "Darkwatch SOC", is_ambiguous=False, hints=("old",))

    changes = await _run(sessions, access, project_id)

    assert changes.updated == 1
    darkwatch = await fetchrow(
        migrated,
        "SELECT is_ambiguous, disambiguation_hints FROM core.entities "
        "WHERE workspace_id = $1 AND canonical_name = 'Darkwatch SOC'",
        workspace.id,
    )
    assert tuple(darkwatch) == (True, ["soc", "security", "mdr"])


async def test_hints_are_normalised_as_the_api_does_and_a_second_run_changes_nothing(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    darkwatch = next(part for part in FIXTURE.competitors if part.name == "Darkwatch SOC")
    padded = darkwatch.model_copy(update={"disambiguation_hints": ["  soc ", "mdr  "]})
    competitors = [padded if part is darkwatch else part for part in FIXTURE.competitors]

    await ensure_entities(sessions, access, project_id, FIXTURE.brand, competitors)
    before = await written(migrated, workspace)
    again = await ensure_entities(sessions, access, project_id, FIXTURE.brand, competitors)

    stored = await fetchrow(
        migrated,
        "SELECT disambiguation_hints FROM core.entities "
        "WHERE workspace_id = $1 AND canonical_name = 'Darkwatch SOC'",
        workspace.id,
    )
    assert stored["disambiguation_hints"] == ["soc", "mdr"]
    assert again.updated == 0
    assert await written(migrated, workspace) == before


async def test_a_hint_the_api_would_refuse_stops_the_seed_before_any_write(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    darkwatch = next(part for part in FIXTURE.competitors if part.name == "Darkwatch SOC")
    long_hint = darkwatch.model_copy(update={"disambiguation_hints": ["x" * 101]})
    competitors = [long_hint if part is darkwatch else part for part in FIXTURE.competitors]
    before = await written(migrated, workspace)

    with pytest.raises(SeedError, match=r"Darkwatch SOC.*disambiguation_hints"):
        await ensure_entities(sessions, access, project_id, FIXTURE.brand, competitors)

    assert await written(migrated, workspace) == before


async def test_a_domain_another_entity_of_the_project_claims_is_reported_not_hidden(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    brand = await _make(sessions, access, "Eventus Security")
    await _give(sessions, access, project_id, brand, "own", primary=True)
    rival = await _make(sessions, access, "Rival Co", domains=("eventussecurity.com",))
    await _give(sessions, access, project_id, rival, "competitor")

    changes = await _run(sessions, access, project_id)

    assert changes.domains_added == 1
    assert len(changes.domain_conflicts) == 1
    assert "eventussecurity.com was added to Eventus Security" in changes.domain_conflicts[0]
    before = await written(migrated, workspace)
    assert (await _run(sessions, access, project_id)).domain_conflicts == ()
    assert await written(migrated, workspace) == before


async def test_the_writes_are_audited_as_the_owner_with_the_seeds_user_agent(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    await gulf_locations(migrated)
    access = seed_access(user.id, workspace.id)
    project_id, _ = await ensure_project(sessions, access, FIXTURE.project, COUNTRY_IDS["IN"])
    await _run(sessions, access, project_id)
    await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    entries = await fetch(
        migrated,
        "SELECT split_part(action, '.', 1) AS kind, actor_type, actor_id, user_agent "
        "FROM ops.audit_logs WHERE workspace_id = $1 GROUP BY 1, 2, 3, 4",
        workspace.id,
    )
    kinds = {row["kind"] for row in entries}
    assert {"project", "entity", "project_entity", "vocabulary", "term"} <= kinds
    assert {(row["actor_type"], row["actor_id"], row["user_agent"]) for row in entries} == {
        ("user", str(user.id), SEED_INFO.user_agent)
    }


async def test_a_failure_midway_is_finished_by_the_next_run(
    migrated: PostgresServer, sessions: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    real_add = ProjectEntityService.add
    calls = 0

    async def flaky(self: ProjectEntityService, *args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("the connection dropped")
        return await real_add(self, *args, **kwargs)

    monkeypatch.setattr(ProjectEntityService, "add", flaky)
    with pytest.raises(RuntimeError, match="connection dropped"):
        await _run(sessions, access, project_id)
    # Three entities and two roles are there; the third role is not.
    _, entity_count, _, _, role_count, _ = await written(migrated, workspace)
    assert (entity_count, role_count) == (3, 2)

    again = await _run(sessions, access, project_id)

    assert again == EntityChanges(
        created=6, aliases_added=0, domains_added=0, updated=0, roles_given=7
    )
    _, entity_count, _, _, role_count, _ = await written(migrated, workspace)
    assert (entity_count, role_count) == (9, 9)
