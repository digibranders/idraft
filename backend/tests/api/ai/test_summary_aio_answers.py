"""Google AI Overview answers on the prompts summary: a prompt's answer for the engine
`google_ai_overview` is the newest valid observation, inside the window, of the keyword the
prompt speaks for (`aio_summary`), counted as any other engine's answer. Observations are
seeded as copies of the world's ChatGPT answer, moved to the engine and the keyword."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from tests.api.ai.screenshot_support import ShotWorld
from tests.api.ai.summary_support import day
from tests.api.ai.test_summary_aio import _track
from tests.api.ai.test_summary_linked import _data, _link, _prompt
from tests.api.auth.support import execute, fetchrow
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer

AIO = "google_ai_overview"
CHATGPT = "chatgpt_web"
OUTCOMES = ("mentioned_and_cited", "mentioned_only", "cited_only", "neither")


async def _tracked_id(pg: PostgresServer, world: ShotWorld, text: str) -> uuid.UUID:
    row = await fetchrow(
        pg,
        "SELECT tk.id FROM seo.tracked_keywords tk JOIN seo.keywords k ON k.id = tk.keyword_id "
        "WHERE tk.workspace_id = $1 AND k.text = $2 ORDER BY tk.created_at LIMIT 1",
        world.workspace.id,
        text,
    )
    tracked_id: uuid.UUID = row["id"]
    return tracked_id


async def _overview(
    pg: PostgresServer,
    world: ShotWorld,
    tracked_keyword_id: uuid.UUID,
    days_ago: float,
    *,
    mentioned: bool = True,
    cited: bool = False,
) -> int:
    """One valid overview answer of the tracked keyword `days_ago` days old, with its fact row."""
    at = datetime.now(UTC).replace(microsecond=0) - timedelta(days=days_ago)
    row = await fetchrow(
        pg,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, tracked_keyword_id, query_text, "
        "provider_code, provider_endpoint, status, answer_text, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT $2::timestamptz, ($2::timestamptz)::date, workspace_id, project_id, "
        "'google_ai_overview', 'serp_ai', NULL, "
        "$3, 'managed soc', provider_code, provider_endpoint, 'complete', answer_text, false, "
        "raw_payload_id, adapter_version, normalizer_version, canonicalizer_version "
        "FROM ai.observations WHERE id = $1 RETURNING id",
        world.observation_id,
        at,
        tracked_keyword_id,
    )
    await execute(
        pg,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "tracked_keyword_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list) "
        "VALUES ($1, $2::timestamptz, (SELECT derivation_id FROM ai.observation_facts "
        "WHERE observation_id = $3 LIMIT 1), $4, $5, ($2::timestamptz)::date, "
        "'google_ai_overview', 'serp_ai', NULL, $6, 0, true, $7, "
        "$8, 0, 0, $9, false)",
        row["id"],
        at,
        world.observation_id,
        world.workspace.id,
        world.project.id,
        tracked_keyword_id,
        mentioned,
        cited,
        1 if mentioned else 0,
    )
    observation_id: int = row["id"]
    return observation_id


async def _speaks_for(
    pg: PostgresServer, world: ShotWorld, prompt_id: uuid.UUID, text: str
) -> None:
    """Link another prompt to the existing keyword `text`."""
    keyword = await fetchrow(
        pg,
        "SELECT id FROM seo.keywords WHERE workspace_id = $1 AND text = $2",
        world.workspace.id,
        text,
    )
    await execute(
        pg,
        "INSERT INTO core.keyword_prompt_links (workspace_id, project_id, keyword_id, prompt_id, "
        "link_type, is_primary, status) VALUES ($1, $2, $3, $4, 'generated', true, 'active')",
        world.workspace.id,
        world.project.id,
        keyword["id"],
        prompt_id,
    )


def _engines(row: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {engine["engine_code"]: engine for engine in row["engines"]}


def _outcomes(engine: dict[str, Any]) -> list[int]:
    return [engine["outcomes"][name]["numerator"] for name in OUTCOMES]


async def _tracked_world(pg: PostgresServer, world: ShotWorld, state: str) -> uuid.UUID:
    """The world's prompt linked to the tracked keyword "managed soc"; returns its tracked id."""
    await _link(pg, world, await _prompt(pg, world), "managed soc", primary=True)
    await _track(pg, world, "managed soc", state)
    return await _tracked_id(pg, world, "managed soc")


async def test_a_prompt_gets_the_overview_answer_of_its_keyword_with_its_outcome(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    tracked = await _tracked_world(migrated, recent_world, "present_not_cited")
    await _overview(migrated, recent_world, tracked, 2)

    data = await _data(
        api,
        recent_world,
        include="ai_overview,total",
        **{"filter[engine_code_in]": f"{CHATGPT},{AIO}"},
    )

    engines = _engines(data["prompts"][0])
    assert set(engines) == {CHATGPT, AIO}
    overview = engines[AIO]
    assert (overview["mentioned"]["numerator"], overview["mentioned"]["denominator"]) == (1, 1)
    assert _outcomes(overview) == [0, 1, 0, 0]
    assert _outcomes(engines[CHATGPT]) == [0, 1, 0, 0]
    assert _engines(data["total"])[AIO]["mentioned"]["denominator"] == 1
    # The cell of the keyword's latest check is unchanged.
    assert data["prompts"][0]["ai_overview"]["source_state"] == "ok"
    assert data["ai_overview"]["tracked"] == 1


async def test_two_prompts_that_share_a_keyword_each_get_the_answer(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    tracked = await _tracked_world(migrated, recent_world, "present_cited")
    second = await add_prompt(migrated, recent_world.project, "Which firms offer a managed SOC?")
    await _speaks_for(migrated, recent_world, second.id, "managed soc")
    await _overview(migrated, recent_world, tracked, 2, mentioned=True, cited=True)

    data = await _data(api, recent_world, include="total", **{"filter[engine_code_in]": AIO})

    assert len(data["prompts"]) == 2
    for row in data["prompts"]:
        overview = _engines(row)[AIO]
        assert _outcomes(overview) == [1, 0, 0, 0]
    # n is the number of prompts with an answer, not the number of checks.
    assert _engines(data["total"])[AIO]["mentioned"]["denominator"] == 2


async def test_no_answer_is_not_a_neither(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    # An absent overview stores no observation; a keyword never checked has none either.
    await _tracked_world(migrated, recent_world, "absent")
    data = await _data(api, recent_world, include="total")
    assert set(_engines(data["prompts"][0])) == {CHATGPT}
    assert set(_engines(data["total"])) == {CHATGPT}

    await execute(migrated, "DELETE FROM seo.tracked_keyword_state")
    data = await _data(api, recent_world)
    assert set(_engines(data["prompts"][0])) == {CHATGPT}


async def test_the_answer_is_the_newest_valid_one_inside_the_window(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    tracked = await _tracked_world(migrated, recent_world, "present_not_cited")
    await _overview(migrated, recent_world, tracked, 10, mentioned=True, cited=False)
    await _overview(migrated, recent_world, tracked, 3, mentioned=True, cited=True)

    newest = _engines(
        (await _data(api, recent_world, **{"filter[engine_code_in]": AIO}))["prompts"][0]
    )[AIO]
    assert (newest["mentioned"]["denominator"], _outcomes(newest)) == (1, [1, 0, 0, 0])

    # A window that closes before the newer answer reads the older one.
    older = _engines(
        (
            await _data(
                api, recent_world, **{"from": day(20), "to": day(5), "filter[engine_code_in]": AIO}
            )
        )["prompts"][0]
    )[AIO]
    assert (older["mentioned"]["denominator"], _outcomes(older)) == (1, [0, 1, 0, 0])

    # A window with neither answer in it has none.
    empty = await _data(
        api, recent_world, **{"from": day(2), "to": day(0), "filter[engine_code_in]": AIO}
    )
    assert AIO not in _engines(empty["prompts"][0])


async def test_the_period_compared_with_reads_its_own_answer(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    tracked = await _tracked_world(migrated, recent_world, "present_not_cited")
    await _overview(migrated, recent_world, tracked, 10, mentioned=False, cited=False)
    await _overview(migrated, recent_world, tracked, 3, mentioned=True, cited=True)

    data = await _data(
        api,
        recent_world,
        compare="previous_period",
        **{"from": day(6), "to": day(0), "filter[engine_code_in]": AIO},
    )

    overview = _engines(data["prompts"][0])[AIO]
    assert _outcomes(overview) == [1, 0, 0, 0]
    assert overview["previous"]["mentioned"]["denominator"] == 1
    assert overview["previous"]["mentioned"]["numerator"] == 0


async def test_the_engine_filter_and_the_other_engines_are_untouched(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    tracked = await _tracked_world(migrated, recent_world, "present_not_cited")
    await _overview(migrated, recent_world, tracked, 2)

    only_chatgpt = await _data(api, recent_world, **{"filter[engine_code_in]": CHATGPT})
    assert set(_engines(only_chatgpt["prompts"][0])) == {CHATGPT}
    only_overview = await _data(api, recent_world, **{"filter[engine_code_in]": AIO})
    assert set(_engines(only_overview["prompts"][0])) == {AIO}
    unfiltered = _engines((await _data(api, recent_world))["prompts"][0])
    # Without the filter only the platforms asked per prompt answer; the Overview must be named
    assert AIO not in unfiltered
    both = _engines(
        (await _data(api, recent_world, **{"filter[engine_code_in]": f"{CHATGPT},{AIO}"}))[
            "prompts"
        ][0]
    )
    assert both[CHATGPT]["mentioned"]["denominator"] == 1
