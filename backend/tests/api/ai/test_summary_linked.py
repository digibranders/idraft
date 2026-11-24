"""`linked_keyword` on a prompt row and `linked_keywords` on the rows that add prompts up
(`include=facts`): the keyword a prompt is linked to and its monthly searches at the prompt's
place. A keyword with no metrics yet has a null volume, never a 0."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from tests.api.ai.screenshot_support import ShotWorld
from tests.api.auth.support import execute, fetchrow
from tests.api.keywords.support import LOCATION
from tests.conftest import PostgresServer


async def _prompt(pg: PostgresServer, world: ShotWorld) -> uuid.UUID:
    row = await fetchrow(
        pg, "SELECT id FROM ai.prompts WHERE project_id = $1 LIMIT 1", world.project.id
    )
    prompt_id: uuid.UUID = row["id"]
    return prompt_id


async def _link(
    pg: PostgresServer,
    world: ShotWorld,
    prompt_id: uuid.UUID,
    text: str,
    volume: int | None = None,
    *,
    primary: bool = False,
    status: str = "active",
) -> None:
    """A linked keyword; without a `volume` it has no metrics row."""
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $2, $2, 'en') RETURNING id",
        world.workspace.id,
        text,
    )
    await execute(
        pg,
        "INSERT INTO core.keyword_prompt_links (workspace_id, project_id, keyword_id, prompt_id, "
        "link_type, is_primary, status) VALUES ($1, $2, $3, $4, 'generated', $5, $6)",
        world.workspace.id,
        world.project.id,
        keyword["id"],
        prompt_id,
        primary,
        status,
    )
    if volume is None:
        return
    fetched_at = datetime.now(UTC)
    snapshot = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
        "language_code, source, fetched_at, search_volume, is_material_change) "
        "VALUES ($1, $2, $3, 'en', 'dataforseo_labs', $4, $5, true) RETURNING id",
        world.workspace.id,
        keyword["id"],
        LOCATION,
        fetched_at,
        volume,
    )
    await execute(
        pg,
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, fetched_at) "
        "VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, $5, $6)",
        keyword["id"],
        LOCATION,
        world.workspace.id,
        snapshot["id"],
        volume,
        fetched_at,
    )


async def _data(api: httpx.AsyncClient, world: ShotWorld, **params: str) -> dict[str, Any]:
    response = await api.get(
        world.url("prompts-summary"), params=params, headers=world.reader.headers
    )
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def test_a_prompt_without_a_link_has_a_null_linked_keyword(
    api: httpx.AsyncClient, recent_world: ShotWorld
) -> None:
    data = await _data(api, recent_world, include="facts,total")
    assert data["prompts"][0]["linked_keyword"] is None
    assert data["topics"][0]["linked_keywords"] == []
    assert data["total"]["linked_keywords"] == []


async def test_a_linked_keyword_without_metrics_has_a_null_volume_and_zero_stays_zero(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt_id = await _prompt(migrated, recent_world)
    await _link(migrated, recent_world, prompt_id, "managed soc", primary=True)
    pending = await _data(api, recent_world, include="facts")
    assert pending["prompts"][0]["linked_keyword"] == {
        "keyword": "managed soc",
        "search_volume": None,
        "measured": False,
    }
    await execute(migrated, "DELETE FROM core.keyword_prompt_links")
    await _link(migrated, recent_world, prompt_id, "managed soc zero", 0, primary=True)
    zero = await _data(api, recent_world, include="facts")
    assert zero["prompts"][0]["linked_keyword"]["search_volume"] == 0


async def test_a_keyword_measured_without_a_volume_is_told_apart_from_one_not_yet_measured(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt_id = await _prompt(migrated, recent_world)
    await _link(migrated, recent_world, prompt_id, "managed soc service providers india", 5)
    await execute(
        migrated,
        "UPDATE seo.keyword_metrics_current SET search_volume = NULL; "
        "UPDATE seo.keyword_metric_snapshots SET search_volume = NULL",
    )
    data = await _data(api, recent_world, include="facts")
    assert data["prompts"][0]["linked_keyword"] == {
        "keyword": "managed soc service providers india",
        "search_volume": None,
        "measured": True,
    }


async def test_the_keyword_with_the_most_searches_wins_and_lists_count_each_keyword_once(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt_id = await _prompt(migrated, recent_world)
    await _link(migrated, recent_world, prompt_id, "soc provider", 40, primary=True)
    await _link(migrated, recent_world, prompt_id, "managed soc", 1190)
    await _link(migrated, recent_world, prompt_id, "no metrics yet")
    await _link(migrated, recent_world, prompt_id, "rejected one", 9000, status="rejected")
    data = await _data(api, recent_world, include="facts,total", group_by="country")
    assert data["prompts"][0]["linked_keyword"] == {
        "keyword": "managed soc",
        "search_volume": 1190,
        "measured": True,
    }
    for row in (data["topics"][0], data["total"], data["by_country"][0]):
        assert row["linked_keywords"] == [
            {
                "keyword": "managed soc",
                "search_volume": 1190,
                "measured": True,
            }
        ]


async def test_linked_keywords_are_left_out_unless_facts_are_asked_for(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    await _link(migrated, recent_world, await _prompt(migrated, recent_world), "managed soc", 5)
    data = await _data(api, recent_world, include="total")
    assert "linked_keyword" not in data["prompts"][0]
    assert "linked_keywords" not in data["topics"][0]
    assert "linked_keywords" not in data["total"]
