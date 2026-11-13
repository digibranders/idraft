"""Statement counts of the AI collection reads (WP-30 T1): each block is one grouped statement,
so the count is the same whatever the number of tasks, days or engines. A loop that asks the
database once per task, day or engine makes these tests fail."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.ai.sources_support import statements
from tests.api.operations.collection_support import (
    ENGINES,
    Scene,
    add_run,
    add_task,
    add_tasks_with_answers,
    days_ago,
    make_scene,
    new_prompt,
)
from tests.conftest import PostgresServer

# Everything the request sends: the session and membership checks, the transaction's scope, and
# the reads. A coverage read is the run, the grouped counts and the missing list.
COVERAGE_MAX = 8
# The project zone, the enabled engines and the three grouped reads of the window.
DAILY_MAX = 10


async def _coverage_statements(
    api: httpx.AsyncClient, resources: Resources, scene: Scene, run_id: uuid.UUID
) -> int:
    with statements(resources) as seen:
        response = await api.get(
            scene.url("runs", run_id, "ai-coverage"), headers=scene.caller.headers
        )
    assert response.status_code == 200, response.text
    return len(seen)


async def _daily_statements(
    api: httpx.AsyncClient, resources: Resources, scene: Scene, days: int, **params: str
) -> int:
    with statements(resources) as seen:
        response = await api.get(
            scene.url("ai/collection/daily"),
            params={
                "from": days_ago(days - 1).isoformat(),
                "to": days_ago(0).isoformat(),
                **params,
            },
            headers=scene.caller.headers,
        )
    assert response.status_code == 200, response.text
    return len(seen)


async def test_coverage_statements_do_not_grow_with_the_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("chatgpt_web", "gemini_web"))
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    small = await add_run(migrated, scene)
    await add_tasks_with_answers(migrated, scene, small, prompt, 4)
    large = await add_run(migrated, scene)
    await add_tasks_with_answers(migrated, scene, large, prompt, 30)
    await add_tasks_with_answers(migrated, scene, large, prompt, 8, engine="gemini_web")
    for engine in ("chatgpt_web", "gemini_web"):
        await add_task(migrated, scene, large, prompt, engine=engine, status="failed")
    # A first read warms the session cache, so each counted read starts alike.
    await _coverage_statements(api, resources, scene, small)

    few = await _coverage_statements(api, resources, scene, small)
    many = await _coverage_statements(api, resources, scene, large)

    assert few == many
    assert many <= COVERAGE_MAX


async def test_daily_statements_do_not_grow_with_days_or_engines(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    one = await make_scene(resources, migrated, engines=("chatgpt_web",))
    three = await make_scene(resources, migrated, engines=ENGINES)
    for scene, engines in ((one, ENGINES[:1]), (three, ENGINES)):
        prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
        run = await add_run(migrated, scene)
        for engine in engines:
            await add_tasks_with_answers(migrated, scene, run, prompt, 2, engine=engine)
    # A first read of each caller warms its session cache, so each counted read starts alike.
    await _daily_statements(api, resources, one, 7)
    await _daily_statements(api, resources, three, 7)

    week = await _daily_statements(api, resources, one, 7)
    quarter = await _daily_statements(api, resources, one, 92)
    all_engines = await _daily_statements(api, resources, three, 92)
    asked = await _daily_statements(
        api, resources, three, 92, **{"filter[engine_code_in]": "gemini_web"}
    )

    assert week == quarter == all_engines
    assert quarter <= DAILY_MAX
    assert asked <= DAILY_MAX
