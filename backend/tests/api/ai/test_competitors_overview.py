"""The Overview competitor table (contract C5, route 7): the AI half, one row per tracked entity
with its share of voice and mention rate per engine, the same values as `ai/competitors`. The SEO
members are declared in the shape and never returned (decision D13: SEO share of voice is built
nowhere). The seeded world is that of `test_prompts_summary`; see `test_competitors_core` for the
numbers (ChatGPT: own Mentioned 1.4 of 3 prompts and Share of voice 2.5 of 4, rival 0.4 of 3 and
1.5 of 4)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import competitors_body, counts, get_competitors
from tests.api.ai.metrics_support import OVERVIEW_COMPETITORS, get_overview
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    OWN_PAGE,
    Answer,
    Summary,
    answer_in_another_project,
    ingested,
)
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import OWN_NAME, RIVAL_NAME
from tests.collectors.rank_support import _entity
from tests.collectors.test_fetching import MemoryStore

seeded = summary_support.seeded


async def _overview(world: Summary, api: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    response = await get_overview(world, api, OVERVIEW_COMPETITORS, **params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _row(body: dict[str, Any], entity: uuid.UUID) -> dict[str, Any]:
    found: dict[str, Any] = next(
        row for row in body["data"]["rows"] if row["entity"]["entity_id"] == str(entity)
    )
    return found


def _ai(row: dict[str, Any], engine: str) -> dict[str, Any]:
    found: dict[str, Any] = next(item for item in row["ai"] if item["engine_code"] == engine)
    return found


async def test_BE_REPORTS_03_one_row_per_tracked_entity_with_share_of_voice_and_mention_per_engine(  # noqa: N802
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """The AI half of the table. The SEO half is the named remainder of the row (D13)."""
    body = await _overview(seeded, api)

    rows = body["data"]["rows"]
    # The tracked set, own first then the competitors, with the entity's reference.
    assert [row["entity"]["canonical_name"] for row in rows] == [OWN_NAME, RIVAL_NAME]
    assert [row["entity"]["role"] for row in rows] == ["own", "competitor"]
    assert {row["entity"]["entity_type"] for row in rows} == {"brand"}
    for row in rows:
        assert [item["engine_code"] for item in row["ai"]] == [CHATGPT, GEMINI]
        for item in row["ai"]:
            assert set(item) == {"engine_code", "share_of_voice", "mention_rate"}
            entity = row["entity"]["entity_id"]
            assert item["share_of_voice"]["metric"] == "ai.share_of_voice"
            assert item["mention_rate"]["metric"] == "ai.mention_rate"
            assert (
                item["share_of_voice"]["entity_id"] == item["mention_rate"]["entity_id"] == entity
            )
            assert item["mention_rate"]["engine_code"] == item["engine_code"]
    own, rival = _row(body, seeded.own), _row(body, seeded.rival)
    assert counts(_ai(own, CHATGPT)["mention_rate"]) == (pytest.approx(1.4), 3, 8)
    assert counts(_ai(own, CHATGPT)["share_of_voice"]) == (2.5, 4, 8)
    assert counts(_ai(rival, CHATGPT)["mention_rate"]) == (pytest.approx(0.4), 3, 8)
    assert counts(_ai(rival, CHATGPT)["share_of_voice"]) == (1.5, 4, 8)
    assert counts(_ai(rival, GEMINI)["share_of_voice"]) == (0.5, 1, 1)
    assert [item["name"] for item in body["meta"]["entities"]] == [RIVAL_NAME, OWN_NAME]
    assert body["meta"]["engine_codes"] == [CHATGPT, GEMINI]


async def test_the_values_equal_the_ai_competitors_read(
    api: httpx.AsyncClient,
    migrated: Any,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """Value for value, for every scope the two routes share, with compare and with a third entity;
    the meta is the same too."""
    await _entity(migrated, seeded.project, "Alpha Corp", "alpha.example", "competitor")
    await ingested(
        seeded,
        migrated,
        worker_db,
        import_store,
        [Answer("brand", OWN_ONLY, (OWN_PAGE,), 1)],
    )

    for params in (
        {},
        {"compare": "previous_period"},
        {"compare": "previous_year"},
        {"include_branded": "true"},
        {"branded_only": "true"},
        {"filter[engine_code_in]": GEMINI},
        {"filter[country_iso]": "FR"},
        {"filter[term]": str(seeded.topics["soc"])},
        {"from": summary_support.day(40), "to": summary_support.day(10)},
    ):
        competitors = await competitors_body(seeded, api, **params)
        body = await _overview(seeded, api, **params)

        assert [row["entity"] for row in body["data"]["rows"]] == [
            row["entity"] for row in competitors["data"]
        ], params
        for row, wide in zip(body["data"]["rows"], competitors["data"], strict=True):
            assert [item["engine_code"] for item in row["ai"]] == [
                item["engine_code"] for item in wide["by_engine"]
            ], params
            for item, entry in zip(row["ai"], wide["by_engine"], strict=True):
                assert item["share_of_voice"] == entry["share_of_voice"], params
                assert item["mention_rate"] == entry["mention_rate"], params
        assert body["meta"] == competitors["meta"], params


async def test_the_seo_block_is_absent(api: httpx.AsyncClient, seeded: Summary) -> None:
    """Declared optional and never returned: SEO share of voice is built nowhere (D13). Not a
    placeholder, not a null, not an empty object."""
    for params in ({}, {"compare": "previous_period"}, {"include_branded": "true"}):
        body = await _overview(seeded, api, **params)

        assert set(body["data"]) == {"rows"}, params
        for row in body["data"]["rows"]:
            assert set(row) == {"entity", "ai"}, params
        assert "seo" not in str(body.keys())
        assert "seo" not in body["meta"]


async def test_overview_competitors_follow_scope_and_compare(
    api: httpx.AsyncClient,
    migrated: Any,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("brand", OWN_ONLY, (OWN_PAGE,), 1)]
    )

    default = await _overview(seeded, api)
    branded = await _overview(seeded, api, include_branded="true")
    france = await _overview(seeded, api, **{"filter[country_iso]": "FR"})
    gemini = await _overview(seeded, api, **{"filter[engine_code_in]": GEMINI})
    compared = await _overview(seeded, api, compare="previous_period")

    own = _row(default, seeded.own)
    assert counts(_ai(own, CHATGPT)["mention_rate"]) == (pytest.approx(1.4), 3, 8)
    assert counts(_ai(_row(branded, seeded.own), CHATGPT)["mention_rate"]) == (
        pytest.approx(2.4),
        4,
        10,
    )
    assert (
        _ai(_row(branded, seeded.own), CHATGPT)["mention_rate"]["filters"]["include_branded"]
        is True
    )
    # No prompt in that market: counts of zero and no value, never a rate of 0.
    for row in france["data"]["rows"]:
        for item in row["ai"]:
            assert counts(item["mention_rate"]) == (0, 0, 0)
            assert item["mention_rate"]["value"] is None
    assert [item["engine_code"] for item in _row(gemini, seeded.own)["ai"]] == [GEMINI]
    # Compare: `previous` on both values, the window and the answers it holds in the meta.
    previous = _ai(_row(compared, seeded.own), CHATGPT)
    assert counts(previous["mention_rate"]["previous"]) == (1, 1, 1)
    assert counts(previous["share_of_voice"]["previous"]) == (1, 1, 1)
    assert _ai(_row(compared, seeded.own), GEMINI)["mention_rate"]["previous"] is None
    assert compared["meta"]["previous_answers"] == 1
    assert compared["meta"]["compare_window"]["to"] < compared["meta"]["window"]["from"]
    assert "previous" not in _ai(own, CHATGPT)["mention_rate"]
    assert "compare_window" not in default["meta"]


async def test_overview_competitors_has_no_lost_prompts_and_no_sources(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await _overview(seeded, api)

    for row in body["data"]["rows"]:
        assert "top_sources" not in row
        for item in row["ai"]:
            for key in (
                "citation_share",
                "recommendation_rate",
                "lost_prompts",
                "is_top_competitor",
            ):
                assert key not in item, key


async def test_another_projects_answers_are_not_counted(
    api: httpx.AsyncClient,
    migrated: Any,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    before = await get_overview(
        seeded, api, OVERVIEW_COMPETITORS, compare="previous_period", include_branded="true"
    )
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET own_mentioned = false, "
        "competitor_mentions = ARRAY[$2]::uuid[] WHERE project_id <> $1",
        seeded.project.id,
        seeded.rival,
    )

    after = await get_overview(
        seeded, api, OVERVIEW_COMPETITORS, compare="previous_period", include_branded="true"
    )

    assert after.status_code == 200
    assert after.json() == before.json()


async def test_a_deleted_project_is_not_found(
    api: httpx.AsyncClient, migrated: Any, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    assert problem(await get_overview(seeded, api, OVERVIEW_COMPETITORS)) == (404, "not_found")


async def test_a_member_of_another_workspace_does_not_see_the_rows(
    api: httpx.AsyncClient, resources: Resources, migrated: Any, seeded: Summary
) -> None:
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await api.get(
        project_url(seeded.workspace, seeded.project.id, "overview", "competitors"),
        headers=outsider.headers,
    )

    assert problem(response) == (404, "not_found")
    assert (await get_competitors(seeded, api)).status_code == 200
