"""The topics are one hierarchical project vocabulary with the fixture's slugs, matched by path:
a second run makes nothing, and a term deleted since is made again."""

from __future__ import annotations

from typing import Any

import pytest

from idraft.api.taxonomy.service import TaxonomyService
from idraft.devseed.context import SeedError, Sessions
from idraft.devseed.fixture import topic_paths
from idraft.devseed.topics import ensure_topics
from tests.api.auth.support import execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import FIXTURE, audit_count, seeded_project, written


async def test_the_topics_are_made_as_a_two_level_vocabulary(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)

    term_ids, made = await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    paths = topic_paths(FIXTURE.topics)
    assert made == 29
    assert set(term_ids) == set(paths)
    vocabulary = await fetchrow(
        migrated,
        "SELECT id, kind, name, is_hierarchical, is_single_valued "
        "FROM core.taxonomy_vocabularies WHERE project_id = $1",
        project_id,
    )
    assert tuple(vocabulary)[1:] == ("topic", "Security topics", True, False)
    terms = await fetch(
        migrated,
        "SELECT id, path, name FROM core.taxonomy_terms WHERE vocabulary_id = $1",
        vocabulary["id"],
    )
    by_path = {row["path"]: row["id"] for row in terms}
    assert set(by_path) == set(paths.values())
    assert by_path["managed-soc-mdr/soc-monitoring"] == term_ids["soc-monitoring"]
    assert {row["name"] for row in terms if row["path"] == "managed-soc-mdr"} == {
        "Managed SOC and MDR"
    }

    before = await audit_count(migrated, workspace)
    assert await ensure_topics(sessions, access, project_id, FIXTURE.topics) == (term_ids, 0)
    assert await audit_count(migrated, workspace) == before


async def test_a_term_deleted_since_is_made_again(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    term_ids, _ = await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    await execute(
        migrated, "DELETE FROM core.taxonomy_terms WHERE id = $1", term_ids["soc-monitoring"]
    )

    again, made = await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    assert made == 1
    assert again["soc-monitoring"] != term_ids["soc-monitoring"]


async def test_a_term_a_person_renamed_or_re_slugged_is_reused(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    term_ids, _ = await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    # Renamed, slug kept; and re-slugged, name kept (its path moves with it).
    await execute(
        migrated,
        "UPDATE core.taxonomy_terms SET name = 'Our SOC service' WHERE id = $1",
        term_ids["managed-soc-mdr"],
    )
    await execute(
        migrated,
        "UPDATE core.taxonomy_terms SET slug = 'monitoring', path = 'managed-soc-mdr/monitoring' "
        "WHERE id = $1",
        term_ids["soc-monitoring"],
    )
    before = await written(migrated, workspace)

    again, made = await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    assert (again, made) == (term_ids, 0)
    assert await written(migrated, workspace) == before
    names = await fetchrow(
        migrated,
        "SELECT name FROM core.taxonomy_terms WHERE id = $1",
        term_ids["managed-soc-mdr"],
    )
    assert names["name"] == "Our SOC service"


async def test_terms_the_fixture_does_not_name_are_left_alone(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    term_ids, _ = await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    vocabulary = await fetchrow(
        migrated, "SELECT id FROM core.taxonomy_vocabularies WHERE project_id = $1", project_id
    )
    await execute(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, parent_id, name, slug, "
        "path) VALUES ($1, $2, NULL, 'Our own topic', 'our-own-topic', 'our-own-topic'), "
        "($1, $2, $3, 'A child of ours', 'ours', 'managed-soc-mdr/ours')",
        workspace.id,
        vocabulary["id"],
        term_ids["managed-soc-mdr"],
    )
    before = await written(migrated, workspace)

    assert await ensure_topics(sessions, access, project_id, FIXTURE.topics) == (term_ids, 0)

    assert await written(migrated, workspace) == before


async def test_a_failure_between_the_levels_is_finished_by_the_next_run(
    migrated: PostgresServer, sessions: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    access, workspace, project_id = await seeded_project(migrated, sessions)
    real_add = TaxonomyService.add_terms
    calls = 0

    async def flaky(self: TaxonomyService, *args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("the connection dropped")
        return await real_add(self, *args, **kwargs)

    monkeypatch.setattr(TaxonomyService, "add_terms", flaky)
    with pytest.raises(RuntimeError, match="connection dropped"):
        await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    assert (await written(migrated, workspace))[5] == len(FIXTURE.topics)

    term_ids, made = await ensure_topics(sessions, access, project_id, FIXTURE.topics)

    assert made == 29 - len(FIXTURE.topics)
    assert set(term_ids) == set(topic_paths(FIXTURE.topics))
    assert (await written(migrated, workspace))[5] == 29


async def test_a_single_valued_topic_vocabulary_stops_the_seed(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id = await seeded_project(migrated, sessions)
    await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    await execute(
        migrated,
        "UPDATE core.taxonomy_vocabularies SET is_single_valued = true WHERE project_id = $1",
        project_id,
    )

    with pytest.raises(SeedError, match="single-valued"):
        await ensure_topics(sessions, access, project_id, FIXTURE.topics)
