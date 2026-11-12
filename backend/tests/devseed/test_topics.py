"""The topics are one hierarchical project vocabulary with the fixture's slugs, matched by path:
a second run makes nothing, and a term deleted since is made again."""

from __future__ import annotations

import pytest

from idraft.devseed.context import SeedError, Sessions
from idraft.devseed.fixture import topic_paths
from idraft.devseed.topics import ensure_topics
from tests.api.auth.support import execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import FIXTURE, audit_count, seeded_project


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
