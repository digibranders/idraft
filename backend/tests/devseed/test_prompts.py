"""The 72 prompts go through bulk-create: identity by text, language and country, `is_branded`
from the brand's aliases, one version each. A second run makes nothing; a drifted prompt is put
back; prompts past the quota stop the seed before anything is written."""

from __future__ import annotations

import uuid
from collections import Counter

import pytest

from idraft.api.problems import QuotaExceededError
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.devseed.context import SeedError, Sessions, seed_access
from idraft.devseed.engines import ensure_engines
from idraft.devseed.project import ensure_entities
from idraft.devseed.prompts import PromptChanges, check_prompt_quota, ensure_prompts, prompt_quota
from idraft.devseed.topics import ensure_topics
from tests.api.ai.support import ai_project, seed_prompts, set_prompt_quota
from tests.api.auth.support import Workspace, execute, fetch, fetchrow
from tests.conftest import PostgresServer
from tests.devseed.support import COUNTRY_IDS, FIXTURE, audit_count, owner_workspace, seeded_project

_PROMPTS = (
    "SELECT p.country_iso, p.is_branded, p.importance, p.is_active, v.text "
    "FROM ai.prompts p JOIN ai.prompt_versions v ON v.id = p.current_version_id "
    "WHERE p.project_id = $1"
)
_COUNTS = (
    "SELECT (SELECT count(*) FROM ai.prompts WHERE project_id = $1) AS prompts, "
    "(SELECT count(*) FROM ai.prompt_versions v JOIN ai.prompts p ON p.id = v.prompt_id "
    " WHERE p.project_id = $1) AS versions, "
    "(SELECT count(*) FROM ai.prompt_terms t JOIN ai.prompts p ON p.id = t.prompt_id "
    " WHERE p.project_id = $1) AS terms"
)


async def _ready(
    pg: PostgresServer, sessions: Sessions
) -> tuple[WorkspaceAccess, Workspace, uuid.UUID, dict[str, uuid.UUID]]:
    access, workspace, project_id = await seeded_project(pg, sessions)
    await ensure_entities(sessions, access, project_id, FIXTURE.brand, FIXTURE.competitors)
    term_ids, _ = await ensure_topics(sessions, access, project_id, FIXTURE.topics)
    await ensure_engines(sessions, access, project_id, FIXTURE.engines, COUNTRY_IDS)
    return access, workspace, project_id, term_ids


async def test_the_prompts_are_made_through_bulk_create(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id, term_ids = await _ready(migrated, sessions)

    changes = await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)

    assert changes == PromptChanges(created=72, updated=0, unchanged=0)
    rows = await fetch(migrated, _PROMPTS, project_id)
    assert len(rows) == 72
    assert all(row["is_active"] for row in rows)
    assert Counter(row["country_iso"] for row in rows) == {"IN": 55, "AE": 12, "SA": 5}
    assert {row["text"] for row in rows if row["is_branded"]} == {
        part.text for part in FIXTURE.prompts if part.branded
    }
    counts = await fetchrow(migrated, _COUNTS, project_id)
    assert counts["terms"] == sum(len(set(part.topics)) for part in FIXTURE.prompts)
    assert counts["versions"] == 72
    created = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'prompt.created'",
        workspace.id,
    )
    assert created["n"] == 72

    before_audit = await audit_count(migrated, workspace)
    before_rows = tuple(await fetchrow(migrated, _COUNTS, project_id))
    again = await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)
    assert again == PromptChanges(created=0, updated=0, unchanged=72)
    assert await audit_count(migrated, workspace) == before_audit
    assert tuple(await fetchrow(migrated, _COUNTS, project_id)) == before_rows


async def test_the_fixture_keys_are_never_stored(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id, term_ids = await _ready(migrated, sessions)
    await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)

    columns = await fetch(
        migrated,
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'ai' AND table_name IN ('prompts', 'prompt_versions')",
    )
    assert not [row["column_name"] for row in columns if "key" in row["column_name"]]
    stored = {row["text"] for row in await fetch(migrated, _PROMPTS, project_id)}
    assert not stored & {part.key for part in FIXTURE.prompts}
    leaked = await fetch(
        migrated,
        "SELECT 1 FROM ops.audit_logs WHERE workspace_id = $1 AND (before::text ~ $2 "
        "OR after::text ~ $2)",
        workspace.id,
        r'"p[0-9]{2}"',
    )
    assert leaked == []


async def test_a_prompt_that_drifted_is_brought_back_in_line(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, _, project_id, term_ids = await _ready(migrated, sessions)
    await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)
    first, second = FIXTURE.prompts[0], FIXTURE.prompts[1]
    assert first.importance != 1
    await execute(
        migrated,
        "UPDATE ai.prompts p SET importance = 1 FROM ai.prompt_versions v "
        "WHERE v.id = p.current_version_id AND p.project_id = $1 AND v.text = $2",
        project_id,
        first.text,
    )
    await execute(
        migrated,
        "UPDATE ai.prompts p SET is_active = false FROM ai.prompt_versions v "
        "WHERE v.id = p.current_version_id AND p.project_id = $1 AND v.text = $2",
        project_id,
        second.text,
    )

    changes = await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)

    assert changes == PromptChanges(created=0, updated=2, unchanged=70)
    by_text = {row["text"]: row for row in await fetch(migrated, _PROMPTS, project_id)}
    assert by_text[first.text]["importance"] == first.importance
    assert by_text[second.text]["is_active"]


async def test_prompts_past_the_quota_stop_the_seed_before_anything_is_written(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    user, workspace = await owner_workspace(migrated)
    other = await ai_project(migrated, workspace)
    await seed_prompts(migrated, workspace, other, 40)
    await set_prompt_quota(migrated, workspace, 100)
    access = seed_access(user.id, workspace.id)
    before = await audit_count(migrated, workspace)

    with pytest.raises(SeedError, match="40 of 100 active prompts and the fixture needs 72 more"):
        await check_prompt_quota(sessions, access, None, "en", FIXTURE.prompts)

    assert await audit_count(migrated, workspace) == before
    assert await prompt_quota(sessions, access) == (100, 40)
    await set_prompt_quota(migrated, workspace, 112)
    await check_prompt_quota(sessions, access, None, "en", FIXTURE.prompts)


async def test_the_quota_counts_an_archived_prompt_that_would_come_back(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id, term_ids = await _ready(migrated, sessions)
    await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)
    await set_prompt_quota(migrated, workspace, 72)
    # Everything is in the project and active: nothing is needed, so a full quota is fine.
    await check_prompt_quota(sessions, access, project_id, "en", FIXTURE.prompts)
    await execute(
        migrated,
        "UPDATE ai.prompts p SET is_active = false FROM ai.prompt_versions v "
        "WHERE v.id = p.current_version_id AND p.project_id = $1 AND v.text = $2",
        project_id,
        FIXTURE.prompts[0].text,
    )
    await check_prompt_quota(sessions, access, project_id, "en", FIXTURE.prompts)
    await set_prompt_quota(migrated, workspace, 71)

    with pytest.raises(SeedError, match="71 of 71 active prompts and the fixture needs 1 more"):
        await check_prompt_quota(sessions, access, project_id, "en", FIXTURE.prompts)


async def test_bulk_create_still_refuses_past_the_quota_and_writes_nothing(
    migrated: PostgresServer, sessions: Sessions
) -> None:
    access, workspace, project_id, term_ids = await _ready(migrated, sessions)
    await set_prompt_quota(migrated, workspace, 50)
    before = await audit_count(migrated, workspace)

    with pytest.raises(QuotaExceededError):
        await ensure_prompts(sessions, access, project_id, "en", FIXTURE.prompts, term_ids)

    assert await fetch(migrated, _PROMPTS, project_id) == []
    assert await audit_count(migrated, workspace) == before
