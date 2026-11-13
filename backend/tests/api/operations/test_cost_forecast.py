"""The cost forecast (WP-30 T2; docs/19 section 3.11.2, plan decision D10): the windows a project's
live AI schedules open in a month, times the price book's price of one full run. A read-only
estimate; it starts nothing."""

from __future__ import annotations

import httpx

from idraft.api.resources import Resources
from tests.api.ai.support import seed_prompts
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import keyword_project
from tests.api.operations.collection_support import (
    ENGINES,
    Scene,
    another_project,
    make_scene,
)
from tests.api.operations.cost_support import url
from tests.collectors.support import make_schedule
from tests.conftest import PostgresServer

MONDAY, THURSDAY = 1, 4
# docs/07 section 7.1: a standard queue task on any of the three AI endpoints.
TASK_PRICE = "0.0012"
CHATGPT = "ai_optimization/chat_gpt/llm_scraper"


async def _weekly(
    pg: PostgresServer, scene: Scene, weekday: int, *, is_active: bool = True
) -> None:
    await make_schedule(
        pg,
        scene.project,
        workload="ai_prompt",
        cadence="weekly",
        weekday=weekday,
        timezone="UTC",
        window_start_local="03:00",
        is_active=is_active,
    )


async def _forecast(
    api: httpx.AsyncClient, scene: Scene, month: str = "2026-11", **params: str
) -> httpx.Response:
    return await api.get(
        url(scene.workspace, "costs/forecast"),
        params={"month": month, **params},
        headers=scene.caller.headers,
    )


async def _scene(
    resources: Resources, pg: PostgresServer, prompts: int, *, role: str = "analyst"
) -> Scene:
    scene = await make_scene(resources, pg, role=role, engines=ENGINES)
    await seed_prompts(pg, scene.workspace, scene.project.id, prompts)
    return scene


async def test_forecast_is_windows_in_the_month_times_the_price_of_one_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 72)
    await _weekly(migrated, scene, MONDAY)
    await _weekly(migrated, scene, THURSDAY)

    response = await _forecast(api, scene)

    # November 2026 starts on a Sunday: Mondays on the 2nd, 9th, 16th, 23rd and 30th, Thursdays
    # on the 5th, 12th, 19th and 26th, so 9 windows. One run asks 72 prompts on 3 engines, 216
    # tasks at $0.0012 each, $0.2592. Nine runs: $2.3328.
    assert response.status_code == 200, response.text
    assert response.json()["data"] == [
        {
            "project_id": str(scene.project.id),
            "workload": "ai_prompt",
            "estimated_cost_usd": "2.332800",
            "method": "price_book_x_schedules",
            "is_estimate": True,
        }
    ]


async def test_a_month_counts_its_own_windows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 10)
    await _weekly(migrated, scene, MONDAY)

    five = await _forecast(api, scene, "2026-11")
    four = await _forecast(api, scene, "2026-12")

    # One run: 10 prompts on 3 engines, 30 tasks, $0.036. November has five Mondays, December
    # (the 7th, 14th, 21st and 28th) four.
    assert five.json()["data"][0]["estimated_cost_usd"] == "0.180000"
    assert four.json()["data"][0]["estimated_cost_usd"] == "0.144000"


async def test_a_paused_schedule_adds_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 10)
    await _weekly(migrated, scene, MONDAY)
    await _weekly(migrated, scene, THURSDAY, is_active=False)

    response = await _forecast(api, scene)

    # Only the five Mondays: 5 runs of $0.036.
    assert response.json()["data"][0]["estimated_cost_usd"] == "0.180000"


async def test_forecast_only_lists_projects_with_ai_schedules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 10)
    await _weekly(migrated, scene, MONDAY)
    quiet = await another_project(migrated, scene)
    rank_only = await another_project(migrated, scene)
    deleted = await another_project(migrated, scene)
    paused = await another_project(migrated, scene)
    for other in (quiet, rank_only, deleted, paused):
        await seed_prompts(migrated, other.workspace, other.project.id, 3)
    await make_schedule(
        migrated, rank_only.project, workload="seo_rank", cadence="weekly", weekday=MONDAY
    )
    await _weekly(migrated, deleted, MONDAY)
    await execute(
        migrated,
        # Only `deleted_at`: the schedule stays active, so the deletion alone must leave it out.
        "UPDATE ops.schedules SET deleted_at = now() WHERE project_id = $1",
        deleted.project.id,
    )
    await _weekly(migrated, paused, MONDAY, is_active=False)

    response = await _forecast(api, scene)

    assert [row["project_id"] for row in response.json()["data"]] == [str(scene.project.id)]


async def test_a_run_with_no_price_leaves_the_project_out_not_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 10)
    await _weekly(migrated, scene, MONDAY)
    # The price book is shared by every test of this worker, which runs one test at a time: the
    # ChatGPT price is closed for this test and opened again after.
    await execute(
        migrated,
        "UPDATE ops.provider_price_book SET valid_to = '2026-01-01' WHERE endpoint = $1",
        CHATGPT,
    )
    try:
        unpriced = await _forecast(api, scene)
    finally:
        await execute(
            migrated,
            "UPDATE ops.provider_price_book SET valid_to = NULL WHERE endpoint = $1",
            CHATGPT,
        )
    priced = await _forecast(api, scene)

    assert unpriced.status_code == 200
    # Left out: an unknown price is not a forecast of 0.
    assert unpriced.json()["data"] == []
    assert [row["estimated_cost_usd"] for row in priced.json()["data"]] == ["0.180000"]


async def test_forecast_is_flagged_an_estimate(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 3)
    await _weekly(migrated, scene, MONDAY)

    (row,) = (await _forecast(api, scene)).json()["data"]

    assert (row["is_estimate"], row["method"], row["workload"]) == (
        True,
        "price_book_x_schedules",
        "ai_prompt",
    )


async def test_a_member_limited_to_a_project_sees_only_its_forecast(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await _scene(resources, migrated, 3)
    other = await another_project(migrated, scene)
    await seed_prompts(migrated, other.workspace, other.project.id, 3)
    for each in (scene, other):
        await _weekly(migrated, each, MONDAY)
    limited = await member(
        resources, migrated, scene.workspace, "analyst", project_ids=[scene.project.id]
    )
    limited_scene = Scene(scene.workspace, scene.project, limited)
    everyone = await _forecast(api, scene)

    mine = await _forecast(api, limited_scene)
    foreign = await _forecast(api, limited_scene, **{"filter[project_id]": str(other.project.id)})
    missing = await _forecast(
        api,
        scene,
        **{
            "filter[project_id]": str(
                await keyword_project(migrated, await make_workspace(migrated))
            )
        },
    )

    assert len(everyone.json()["data"]) == 2
    assert [row["project_id"] for row in mine.json()["data"]] == [str(scene.project.id)]
    assert problem(foreign) == problem(missing) == (404, "not_found")
