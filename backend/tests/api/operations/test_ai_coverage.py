"""The AI coverage of a run (WP-30 T1; contract C3): per engine the tasks planned, the answers
stored, the valid ones and the others by status, and every planned task with no answer."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from idraft.api.operations.ai_coverage import valid_rate
from idraft.api.resources import Resources
from tests.api.entities.support import problem
from tests.api.operations.collection_support import (
    Scene,
    add_answer,
    add_run,
    add_task,
    another_project,
    make_scene,
    new_prompt,
)
from tests.conftest import PostgresServer


async def _coverage(api: httpx.AsyncClient, scene: Scene, run_id: uuid.UUID) -> dict[str, Any]:
    response = await api.get(scene.url("runs", run_id, "ai-coverage"), headers=scene.caller.headers)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def _engine(data: dict[str, Any], code: str) -> dict[str, Any]:
    found: dict[str, Any] = next(e for e in data["by_engine"] if e["engine_code"] == code)
    return found


async def test_a_run_reports_planned_observed_valid_and_invalid_by_status_per_engine(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("chatgpt_web", "gemini_web"))
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    for engine, status in (
        ("chatgpt_web", "complete"),
        ("chatgpt_web", "complete"),
        ("chatgpt_web", "empty"),
        ("gemini_web", "error"),
    ):
        task = await add_task(migrated, scene, run, prompt, engine=engine)
        await add_answer(
            migrated, scene, prompt, run_id=run, task_id=task, engine=engine, status=status
        )
    await add_task(migrated, scene, run, prompt, engine="gemini_web", status="failed")

    data = await _coverage(api, scene, run)

    assert [e["engine_code"] for e in data["by_engine"]] == ["chatgpt_web", "gemini_web"]
    chatgpt = _engine(data, "chatgpt_web")
    assert (chatgpt["planned"], chatgpt["observed"], chatgpt["valid"], chatgpt["partial"]) == (
        3,
        3,
        2,
        0,
    )
    assert chatgpt["invalid_by_status"] == {"empty": 1, "refused": 0, "error": 0}
    gemini = _engine(data, "gemini_web")
    assert (gemini["planned"], gemini["observed"], gemini["valid"], gemini["partial"]) == (
        2,
        1,
        0,
        0,
    )
    assert gemini["invalid_by_status"] == {"empty": 0, "refused": 0, "error": 1}


async def test_partial_counts_as_valid_and_refused_empty_error_do_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    for status in ("complete", "complete", "partial", "empty", "refused", "error"):
        task = await add_task(migrated, scene, run, prompt)
        await add_answer(migrated, scene, prompt, run_id=run, task_id=task, status=status)

    chatgpt = _engine(await _coverage(api, scene, run), "chatgpt_web")

    assert chatgpt["planned"] == 6
    assert chatgpt["observed"] == 6
    assert chatgpt["valid"] == 3
    assert chatgpt["partial"] == 1
    assert chatgpt["invalid_by_status"] == {"empty": 1, "refused": 1, "error": 1}
    assert chatgpt["valid_rate"]["numerator"] == 3
    assert chatgpt["valid_rate"]["denominator"] == 6
    assert chatgpt["valid_rate"]["value"] == 0.5


async def test_cancelled_and_skipped_cached_tasks_are_not_planned(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    for _ in range(2):
        task = await add_task(migrated, scene, run, prompt)
        await add_answer(migrated, scene, prompt, run_id=run, task_id=task)
    await add_task(migrated, scene, run, prompt, status="cancelled")
    await add_task(migrated, scene, run, prompt, status="skipped_cached")

    data = await _coverage(api, scene, run)

    assert _engine(data, "chatgpt_web")["planned"] == 2
    assert data["missing"] == []


async def test_a_superseded_answer_is_not_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    only_old = await add_task(migrated, scene, run, prompt, replicate=1)
    await add_answer(migrated, scene, prompt, run_id=run, task_id=only_old, superseded=True)
    replaced = await add_task(migrated, scene, run, prompt, replicate=2)
    await add_answer(migrated, scene, prompt, run_id=run, task_id=replaced, superseded=True)
    await add_answer(migrated, scene, prompt, run_id=run, task_id=replaced)

    data = await _coverage(api, scene, run)

    chatgpt = _engine(data, "chatgpt_web")
    assert (chatgpt["planned"], chatgpt["observed"], chatgpt["valid"]) == (2, 1, 1)
    assert [m["replicate_index"] for m in data["missing"]] == [1]


async def test_a_planned_task_with_no_answer_is_missing_with_its_task_status(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene, status="running")
    for status in ("pending", "submitted", "failed", "dead"):
        await add_task(migrated, scene, run, prompt, status=status)
    task = await add_task(migrated, scene, run, prompt)
    await add_answer(migrated, scene, prompt, run_id=run, task_id=task)

    data = await _coverage(api, scene, run)

    assert sorted(m["task_status"] for m in data["missing"]) == [
        "dead",
        "failed",
        "pending",
        "submitted",
    ]
    assert {m["prompt_id"] for m in data["missing"]} == {str(prompt.id)}
    assert _engine(data, "chatgpt_web")["planned"] == 5
    assert _engine(data, "chatgpt_web")["observed"] == 1


async def test_missing_is_in_prompt_engine_location_replicate_order(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("chatgpt_web", "gemini_web"))
    first = await new_prompt(migrated, scene, "First question about SOC?")
    second = await new_prompt(migrated, scene, "Second question about SOC?")
    run = await add_run(migrated, scene, status="running")
    # Made in an order that is none of the sort orders.
    made = [
        (second, "gemini_web", None, 1),
        (first, "gemini_web", 2840, 2),
        (second, "chatgpt_web", 2840, 1),
        (first, "chatgpt_web", None, 1),
        (first, "gemini_web", 2840, 1),
        (first, "chatgpt_web", 2840, 2),
        (first, "chatgpt_web", 2840, 1),
    ]
    for prompt, engine, location, replicate in made:
        await add_task(
            migrated,
            scene,
            run,
            prompt,
            engine=engine,
            location_id=location,
            replicate=replicate,
            status="pending",
        )

    data = await _coverage(api, scene, run)

    # Prompt ids are time ordered, so `first` sorts before `second`; a missing location last.
    assert [
        (m["prompt_id"], m["engine_code"], m["location_id"], m["replicate_index"])
        for m in data["missing"]
    ] == [
        (str(first.id), "chatgpt_web", 2840, 1),
        (str(first.id), "chatgpt_web", 2840, 2),
        (str(first.id), "chatgpt_web", None, 1),
        (str(first.id), "gemini_web", 2840, 1),
        (str(first.id), "gemini_web", 2840, 2),
        (str(second.id), "chatgpt_web", 2840, 1),
        (str(second.id), "gemini_web", None, 1),
    ]


async def test_an_engine_with_no_planned_task_is_absent(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("chatgpt_web", "gemini_web"))
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    task = await add_task(migrated, scene, run, prompt)
    await add_answer(migrated, scene, prompt, run_id=run, task_id=task)
    await add_task(migrated, scene, run, prompt, engine="gemini_web", status="cancelled")
    empty_run = await add_run(migrated, scene)

    data = await _coverage(api, scene, run)

    assert [e["engine_code"] for e in data["by_engine"]] == ["chatgpt_web"]
    assert await _coverage(api, scene, empty_run) == {"by_engine": [], "missing": []}


async def test_valid_rate_is_valid_of_planned_and_null_when_nothing_is_planned(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    for status in ("complete", "complete", "complete", "refused"):
        task = await add_task(migrated, scene, run, prompt)
        await add_answer(migrated, scene, prompt, run_id=run, task_id=task, status=status)
    # A task the run planned that never got an answer is in the denominator.
    await add_task(migrated, scene, run, prompt, status="failed")

    cell = _engine(await _coverage(api, scene, run), "chatgpt_web")["valid_rate"]

    assert cell == {
        "value": 0.6,
        "numerator": 3,
        "denominator": 5,
        "n_observations": 4,
        "pooled": None,
    }
    nothing = valid_rate(0, 0, 0)
    assert nothing.value is None
    assert (nothing.numerator, nothing.denominator, nothing.n_observations) == (0, 0, 0)


async def test_a_rank_run_is_not_an_ai_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    run = await add_run(migrated, scene, workload="seo_rank")

    response = await api.get(scene.url("runs", run, "ai-coverage"), headers=scene.caller.headers)

    assert problem(response) == (422, "not_an_ai_run")


async def test_a_run_of_another_project_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    other = await another_project(migrated, scene)
    foreign_run = await add_run(migrated, other)
    own_run = await add_run(migrated, scene)

    foreign = await api.get(
        scene.url("runs", foreign_run, "ai-coverage"), headers=scene.caller.headers
    )
    own = await api.get(scene.url("runs", own_run, "ai-coverage"), headers=scene.caller.headers)
    unknown = await api.get(
        scene.url("runs", uuid.uuid4(), "ai-coverage"), headers=scene.caller.headers
    )

    assert problem(foreign) == (404, "not_found")
    assert own.status_code == 200
    assert problem(unknown) == (404, "not_found")


async def test_a_run_of_another_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    stranger = await make_scene(resources, migrated)
    foreign_run = await add_run(migrated, stranger)

    response = await api.get(
        scene.url("runs", foreign_run, "ai-coverage"), headers=scene.caller.headers
    )

    assert problem(response) == (404, "not_found")


async def test_a_viewer_reads_and_billing_is_forbidden(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    viewer = await make_scene(resources, migrated, role="viewer")
    billing = await make_scene(resources, migrated, role="billing")
    viewer_run = await add_run(migrated, viewer)
    billing_run = await add_run(migrated, billing)

    allowed = await api.get(
        viewer.url("runs", viewer_run, "ai-coverage"), headers=viewer.caller.headers
    )
    refused = await api.get(
        billing.url("runs", billing_run, "ai-coverage"), headers=billing.caller.headers
    )

    assert allowed.status_code == 200
    assert problem(refused) == (403, "forbidden")
