"""Unit costs (WP-30 T2; docs/19 section 3.11.2, plan decision D11): what one answer, one provider
request, one active prompt or one tracked keyword cost in a month. Money is a `Decimal`, divided
once and rounded once to the micro-dollar; a figure with nothing to divide by is null, never 0."""

from __future__ import annotations

from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import keyword_project, tracked_id
from tests.api.operations.collection_support import (
    ENGINES,
    Scene,
    another_project,
    make_scene,
    new_prompt,
)
from tests.api.operations.cost_support import costed_answer, daily_cost, this_month, url
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer

ALL_ENGINES_NULL = {"chatgpt_web": None, "gemini_web": None, "google_ai_mode": None}


async def _unit_costs(api: httpx.AsyncClient, scene: Scene, **params: str) -> httpx.Response:
    return await api.get(
        url(scene.workspace, "costs/unit-costs"),
        params={"month": this_month(), **params},
        headers=scene.caller.headers,
    )


async def _row(api: httpx.AsyncClient, scene: Scene) -> dict[str, Any]:
    response = await _unit_costs(api, scene)
    assert response.status_code == 200, response.text
    (row,) = [r for r in response.json()["data"] if r["project_id"] == str(scene.project.id)]
    found: dict[str, Any] = row
    return found


async def _scene(resources: Resources, pg: PostgresServer) -> Scene:
    return await make_scene(resources, pg, role="analyst", engines=ENGINES)


async def test_cost_per_answer_is_the_sum_of_costs_over_the_answers_with_a_cost_to_the_micro(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    for cost in ("0.001", "0.001", "0.002"):
        await costed_answer(migrated, scene, prompt, cost)
    await costed_answer(migrated, scene, prompt, "0.0012", engine="gemini_web")

    row = await _row(api, scene)

    # ChatGPT: 0.004 over 3 answers is 0.0013333..., one division and one rounding, 0.001333.
    # Gemini: exactly 0.0012. Together 0.0052 over 4 answers is exactly 0.0013, from the sums
    # and not from the two rounded figures (whose mean is 0.0012665).
    assert row["per_engine"] == {
        "chatgpt_web": "0.001333",
        "gemini_web": "0.001200",
        "google_ai_mode": None,
    }
    assert row["per_ai_observation"] == "0.001300"


async def test_an_engine_with_no_answers_has_null_not_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)

    empty = await _row(api, scene)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    await costed_answer(migrated, scene, prompt, "0.002", engine="gemini_web")
    one = await _row(api, scene)

    assert empty["per_engine"] == ALL_ENGINES_NULL
    assert empty["per_ai_observation"] is None
    assert one["per_engine"] == {**ALL_ENGINES_NULL, "gemini_web": "0.002000"}
    assert one["per_ai_observation"] == "0.002000"


async def test_answers_without_a_cost_are_not_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    await costed_answer(migrated, scene, prompt, "0.004")
    await costed_answer(migrated, scene, prompt, None)
    await costed_answer(migrated, scene, prompt, None)

    row = await _row(api, scene)

    # A mean over the one answer with a cost, not 0.004 over three.
    assert row["per_engine"] == {**ALL_ENGINES_NULL, "chatgpt_web": "0.004000"}
    assert row["ai_answers_by_engine"] == {"chatgpt_web": 1, "gemini_web": 0, "google_ai_mode": 0}


async def test_superseded_answers_are_not_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    await costed_answer(migrated, scene, prompt, "0.002")
    await costed_answer(migrated, scene, prompt, "0.100", superseded=True)

    row = await _row(api, scene)

    assert row["per_engine"] == {**ALL_ENGINES_NULL, "chatgpt_web": "0.002000"}
    assert row["ai_answers_by_engine"] == {"chatgpt_web": 1, "gemini_web": 0, "google_ai_mode": 0}


async def test_ai_answers_by_engine_are_the_counts_behind_each_figure(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    for _ in range(3):
        await costed_answer(migrated, scene, prompt, "0.001")
    for status in ("complete", "partial"):
        await costed_answer(migrated, scene, prompt, "0.002", engine="gemini_web", status=status)

    row = await _row(api, scene)

    # Every engine is named, with the answers its figure is the mean of, or 0 for none.
    assert row["ai_answers_by_engine"] == {"chatgpt_web": 3, "gemini_web": 2, "google_ai_mode": 0}
    assert set(row["per_engine"]) == set(row["ai_answers_by_engine"])


async def test_per_active_prompt_is_ai_spend_over_active_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    for index in range(3):
        await new_prompt(migrated, scene, f"Active prompt {index}")
    await add_prompt(migrated, scene.project, "Archived prompt", active=False)
    await daily_cost(migrated, scene.project, "ai_prompt", "0.30", endpoint="x")
    await daily_cost(migrated, scene.project, "extraction_llm", "0.41", endpoint="y")

    row = await _row(api, scene)

    # $0.30 over the three active prompts; the archived one is not divided by.
    assert row["per_active_prompt_month"] == "0.100000"
    assert row["extraction_llm_usd"] == "0.410000"
    # No rank spend recorded and no tracked keyword: unknown, not 0.
    assert (row["per_tracked_keyword_month"], row["per_serp_check"]) == (None, None)


async def test_rank_spend_is_divided_by_active_keywords_and_requests(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, role="editor", engines=ENGINES)
    for keyword in ("soc as a service", "managed detection"):
        await tracked_id(api, scene.workspace, scene.project.id, scene.caller, keyword)
    await daily_cost(migrated, scene.project, "seo_rank", "0.06", requests=3)

    row = await _row(api, scene)

    assert row["per_tracked_keyword_month"] == "0.030000"
    assert row["per_serp_check"] == "0.020000"
    # Nothing was spent on prompts, and there are none: unknown, not 0.
    assert row["per_active_prompt_month"] is None
    assert row["extraction_llm_usd"] is None


async def test_a_member_limited_to_a_project_sees_only_its_row(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    other = await another_project(migrated, scene)
    limited = await member(
        resources, migrated, scene.workspace, "billing", project_ids=[scene.project.id]
    )
    limited_scene = Scene(scene.workspace, scene.project, limited)

    everyone = await _unit_costs(api, scene)
    mine = await _unit_costs(api, limited_scene)
    narrowed = await _unit_costs(api, scene, **{"filter[project_id]": str(other.project.id)})

    assert {row["project_id"] for row in everyone.json()["data"]} == {
        str(scene.project.id),
        str(other.project.id),
    }
    assert [row["project_id"] for row in mine.json()["data"]] == [str(scene.project.id)]
    assert [row["project_id"] for row in narrowed.json()["data"]] == [str(other.project.id)]


async def test_a_foreign_project_filter_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated)
    other = await another_project(migrated, scene)
    limited = await member(
        resources, migrated, scene.workspace, "billing", project_ids=[scene.project.id]
    )
    foreign = await keyword_project(migrated, await make_workspace(migrated))

    elsewhere = await _unit_costs(api, scene, **{"filter[project_id]": str(foreign)})
    hidden = await _unit_costs(
        api,
        Scene(scene.workspace, scene.project, limited),
        **{"filter[project_id]": str(other.project.id)},
    )

    assert problem(elsewhere) == problem(hidden) == (404, "not_found")
