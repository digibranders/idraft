"""Google AI Overview on the prompts summary (`include=ai_overview`): per prompt, through its
linked keyword, from the latest rank check of the keyword; and the counts behind the platform
figure. Nothing is collected for it, and a keyword nobody tracks says `not_tracked`."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from tests.api.ai.screenshot_support import ShotWorld
from tests.api.ai.test_summary_linked import _data, _link, _prompt
from tests.api.auth.support import execute, fetchrow
from tests.api.keywords.support import LOCATION
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

CHECKED = datetime(2026, 11, 20, 8, 0, tzinfo=UTC)


async def _track(
    pg: PostgresServer,
    world: ShotWorld,
    text: str,
    state: str | None,
    *,
    position: int | None = None,
    device: str = "desktop",
    project_id: uuid.UUID | None = None,
    active: bool = True,
) -> None:
    """Track the keyword `text` (made by `_link`) with a latest check of verdict `state`."""
    project = project_id or world.project.id
    keyword = await fetchrow(
        pg,
        "SELECT id FROM seo.keywords WHERE workspace_id = $1 AND text = $2",
        world.workspace.id,
        text,
    )
    tracked = await fetchrow(
        pg,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, is_active) VALUES ($1, $2, $3, $4, 'en', $5, $6) RETURNING id",
        world.workspace.id,
        project,
        keyword["id"],
        LOCATION,
        device,
        active,
    )
    if state is None:
        return
    await execute(
        pg,
        "INSERT INTO seo.tracked_keyword_state (tracked_keyword_id, workspace_id, project_id, "
        "last_observed_at, aio_state, aio_citation_position) VALUES ($1, $2, $3, $4, $5, $6)",
        tracked["id"],
        world.workspace.id,
        project,
        CHECKED,
        state,
        position,
    )


async def _aio(api: httpx.AsyncClient, world: ShotWorld) -> dict[str, Any]:
    return await _data(api, world, include="ai_overview")


async def test_a_prompt_without_a_link_or_a_rank_check_says_why(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    data = await _aio(api, recent_world)
    cell = data["prompts"][0]["ai_overview"]
    assert cell["source_state"] == "no_linked_keyword"
    assert (cell["shown"], cell["cited_own"]) == (None, None)
    await _link(migrated, recent_world, await _prompt(migrated, recent_world), "managed soc")
    cell = (await _aio(api, recent_world))["prompts"][0]["ai_overview"]
    assert cell["source_state"] == "not_tracked"
    assert (cell["shown"], cell["checks"]) == (None, 0)


async def test_a_cited_overview_and_an_absent_one(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt = await _prompt(migrated, recent_world)
    await _link(migrated, recent_world, prompt, "managed soc", primary=True)
    await _track(migrated, recent_world, "managed soc", "present_cited", position=3)
    await _track(migrated, recent_world, "managed soc", "present_not_cited", device="mobile")
    data = await _aio(api, recent_world)
    assert data["prompts"][0]["ai_overview"] == {
        "source_state": "ok",
        "keyword": "managed soc",
        "shown": True,
        "cited_own": True,
        "cited_position": 3,
        "observed_at": "2026-11-20T08:00:00Z",
        "checks": 2,
    }
    assert data["ai_overview"]["tracked"] == 1
    assert data["ai_overview"]["shown"] == 1
    assert data["ai_overview"]["cited_own"] == 1
    await execute(migrated, "UPDATE seo.tracked_keyword_state SET aio_state = 'absent'")
    data = await _aio(api, recent_world)
    cell = data["prompts"][0]["ai_overview"]
    assert cell["source_state"] == "no_surface"
    assert (cell["shown"], cell["cited_own"]) == (False, False)
    totals = data["ai_overview"]
    assert (totals["tracked"], totals["shown"], totals["cited_own"]) == (1, 0, 0)


async def test_a_check_that_could_not_read_the_page_says_nothing(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    await _link(migrated, recent_world, await _prompt(migrated, recent_world), "managed soc")
    await _track(migrated, recent_world, "managed soc", "not_loaded")
    data = await _aio(api, recent_world)
    assert data["prompts"][0]["ai_overview"]["source_state"] == "not_tracked"
    assert data["ai_overview"]["tracked"] == 0


async def test_a_tracked_link_beats_a_louder_untracked_one_and_stray_rows_do_not_count(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt = await _prompt(migrated, recent_world)
    await _link(migrated, recent_world, prompt, "loud untracked", 9000, primary=True)
    await _link(migrated, recent_world, prompt, "quiet tracked", 5)
    await _link(migrated, recent_world, prompt, "inactive", 5)
    await _track(migrated, recent_world, "quiet tracked", "present_not_cited")
    await _track(migrated, recent_world, "inactive", "present_cited", active=False)
    other = await make_project(migrated, recent_world.workspace.id)
    await _link(migrated, recent_world, prompt, "other project", 5)
    await _track(migrated, recent_world, "other project", "present_cited", project_id=other)
    cell = (await _aio(api, recent_world))["prompts"][0]["ai_overview"]
    assert cell["keyword"] == "quiet tracked"
    assert cell["cited_own"] is False


async def test_the_block_is_left_out_unless_asked_for(
    api: httpx.AsyncClient, recent_world: ShotWorld
) -> None:
    data = await _data(api, recent_world, include="total")
    assert "ai_overview" not in data
    assert "ai_overview" not in data["prompts"][0]
