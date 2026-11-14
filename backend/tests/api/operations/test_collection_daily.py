"""Daily AI collection (WP-30 T1; contract N5): per project day and engine the answers the
schedules planned, the answers stored by status, the valid ones, the runs a budget blocked and
the runs behind the day."""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.entities.support import member, problem
from tests.api.operations.collection_support import (
    ENGINES,
    Scene,
    add_answer,
    add_run,
    add_task,
    another_project,
    at,
    days_ago,
    make_scene,
    new_prompt,
    today,
)
from tests.conftest import PostgresServer

BY_STATUS = ("complete", "partial", "empty", "refused", "error")


async def _daily(
    api: httpx.AsyncClient, scene: Scene, **params: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    response = await api.get(
        scene.url("ai/collection/daily"), params=params, headers=scene.caller.headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    rows: list[dict[str, Any]] = body["data"]
    meta: dict[str, Any] = body["meta"]
    return rows, meta


def _row(rows: list[dict[str, Any]], day: date, engine: str) -> dict[str, Any]:
    found: dict[str, Any] = next(
        r for r in rows if r["date"] == day.isoformat() and r["engine_code"] == engine
    )
    return found


def _span(first: date, last: date) -> dict[str, str]:
    return {"from": first.isoformat(), "to": last.isoformat()}


async def test_every_day_and_engine_has_a_row_zero_filled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("gemini_web", "chatgpt_web"))
    first, last = days_ago(2), days_ago(0)

    rows, meta = await _daily(api, scene, **_span(first, last))

    assert [(r["date"], r["engine_code"]) for r in rows] == [
        (day.isoformat(), engine)
        for day in (first, days_ago(1), last)
        for engine in ("chatgpt_web", "gemini_web")
    ]
    for row in rows:
        assert row["scheduled"] is None
        assert row["answers"] == 0
        assert row["by_status"] == dict.fromkeys(BY_STATUS, 0)
        assert row["valid"] == 0
        assert row["budget_blocked"] == 0
        assert row["runs"] == []
    assert meta == {
        "window": {"from": first.isoformat(), "to": last.isoformat(), "timezone": "UTC"},
        "engine_codes": ["chatgpt_web", "gemini_web"],
    }


async def test_a_day_is_the_project_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    berlin = await make_scene(resources, migrated, timezone="Europe/Berlin")
    utc = await make_scene(resources, migrated)
    day = days_ago(3)
    for scene in (berlin, utc):
        prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
        await add_answer(migrated, scene, prompt, observed_at=at(day, 23, 30))

    berlin_rows, _ = await _daily(api, berlin, **_span(days_ago(4), days_ago(1)))
    utc_rows, _ = await _daily(api, utc, **_span(days_ago(4), days_ago(1)))

    # 23:30 UTC is already the next day in Berlin, in winter and in summer time.
    next_day = days_ago(2)
    assert _row(berlin_rows, day, "chatgpt_web")["answers"] == 0
    assert _row(berlin_rows, next_day, "chatgpt_web")["answers"] == 1
    assert _row(utc_rows, day, "chatgpt_web")["answers"] == 1
    assert _row(utc_rows, next_day, "chatgpt_web")["answers"] == 0


async def test_answers_are_counted_by_status_and_valid_is_complete_plus_partial(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("chatgpt_web", "gemini_web"))
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    day = days_ago(1)
    for status in ("complete", "complete", "partial", "empty", "refused", "error"):
        await add_answer(migrated, scene, prompt, status=status, observed_at=at(day, 10))
    # A replaced answer, another engine and another day are not on this row.
    await add_answer(migrated, scene, prompt, observed_at=at(day, 11), superseded=True)
    await add_answer(migrated, scene, prompt, engine="gemini_web", observed_at=at(day, 12))
    await add_answer(migrated, scene, prompt, observed_at=at(days_ago(2), 12))

    rows, _ = await _daily(api, scene, **_span(days_ago(2), day))

    row = _row(rows, day, "chatgpt_web")
    assert row["answers"] == 6
    assert row["by_status"] == {"complete": 2, "partial": 1, "empty": 1, "refused": 1, "error": 1}
    assert row["valid"] == 3
    assert _row(rows, day, "gemini_web")["answers"] == 1
    assert _row(rows, days_ago(2), "chatgpt_web")["answers"] == 1


async def test_scheduled_is_planned_tasks_and_null_when_nothing_is_known(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    run = await add_run(migrated, scene)
    day = days_ago(1)
    for status in ("ingested", "failed", "pending"):
        await add_task(migrated, scene, run, prompt, status=status, scheduled_for=at(day, 6))
    await add_task(migrated, scene, run, prompt, status="cancelled", scheduled_for=at(day, 6))
    await add_task(migrated, scene, run, prompt, status="skipped_cached", scheduled_for=at(day, 6))
    # A rank task of the day is not an AI answer the schedules planned.
    rank_run = await add_run(migrated, scene, workload="seo_rank")
    await add_task(migrated, scene, rank_run, prompt, scheduled_for=at(day, 7), workload="seo_rank")
    # A day where only a run was blocked knows no task.
    await add_run(migrated, scene, status="budget_blocked", completed_at=at(days_ago(0), 3))

    rows, _ = await _daily(api, scene, **_span(days_ago(2), days_ago(0)))

    assert _row(rows, day, "chatgpt_web")["scheduled"] == 3
    assert _row(rows, days_ago(2), "chatgpt_web")["scheduled"] is None
    assert _row(rows, days_ago(0), "chatgpt_web")["scheduled"] is None
    assert _row(rows, days_ago(0), "chatgpt_web")["budget_blocked"] == 1


async def test_a_blocked_run_counts_on_the_engines_it_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=ENGINES)
    day = days_ago(1)
    moment = at(day, 4)
    only_gemini = await add_run(
        migrated, scene, status="budget_blocked", engine_codes=["gemini_web"], completed_at=moment
    )
    unnamed = await add_run(migrated, scene, status="budget_blocked", completed_at=moment)
    # Not counted: a rank run, an AI run a budget did not block, and a block on another day.
    await add_run(
        migrated, scene, workload="seo_rank", status="budget_blocked", completed_at=moment
    )
    await add_run(migrated, scene, status="completed", completed_at=moment)
    await add_run(migrated, scene, status="budget_blocked", completed_at=at(days_ago(2), 4))

    rows, _ = await _daily(api, scene, **_span(day, day))

    assert _row(rows, day, "gemini_web")["budget_blocked"] == 2
    assert _row(rows, day, "chatgpt_web")["budget_blocked"] == 1
    assert _row(rows, day, "google_ai_mode")["budget_blocked"] == 1
    assert _row(rows, day, "gemini_web")["runs"] == [str(only_gemini), str(unnamed)]
    assert _row(rows, day, "chatgpt_web")["runs"] == [str(unnamed)]


async def test_runs_lists_the_distinct_runs_of_the_day(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    day = days_ago(1)
    older = await add_run(migrated, scene)
    newer = await add_run(migrated, scene)
    for run in (older, older, newer, older):
        await add_answer(migrated, scene, prompt, run_id=run, observed_at=at(day, 9))
    # An answer with no run names none; an answer of another day names its run there.
    await add_answer(migrated, scene, prompt, observed_at=at(day, 9))
    elsewhere = await add_run(migrated, scene)
    await add_answer(migrated, scene, prompt, run_id=elsewhere, observed_at=at(days_ago(2), 9))

    rows, _ = await _daily(api, scene, **_span(days_ago(2), day))

    assert _row(rows, day, "chatgpt_web")["runs"] == [str(older), str(newer)]
    assert _row(rows, days_ago(2), "chatgpt_web")["runs"] == [str(elsewhere)]


async def test_the_engine_filter_narrows_rows_and_meta(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=ENGINES)
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    await add_answer(migrated, scene, prompt, engine="gemini_web")

    rows, meta = await _daily(
        api,
        scene,
        **{"filter[engine_code_in]": "gemini_web,gemini_web"},
        **_span(days_ago(1), today()),
    )

    assert {r["engine_code"] for r in rows} == {"gemini_web"}
    assert len(rows) == 2
    assert meta["engine_codes"] == ["gemini_web"]
    assert _row(rows, today(), "gemini_web")["answers"] == 1


async def test_an_engine_with_an_answer_but_not_enabled_still_has_rows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, engines=("chatgpt_web",))
    prompt = await new_prompt(migrated, scene, "Which SOC provider is best?")
    await add_answer(migrated, scene, prompt, engine="gemini_web")

    rows, meta = await _daily(api, scene, **_span(today(), today()))

    assert meta["engine_codes"] == ["chatgpt_web", "gemini_web"]
    assert _row(rows, today(), "gemini_web")["answers"] == 1


async def test_a_window_over_92_days_is_too_large_with_limit_days(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)

    longest = await api.get(
        scene.url("ai/collection/daily"),
        params=_span(days_ago(91), days_ago(0)),
        headers=scene.caller.headers,
    )
    too_long = await api.get(
        scene.url("ai/collection/daily"),
        params=_span(days_ago(92), days_ago(0)),
        headers=scene.caller.headers,
    )

    assert longest.status_code == 200
    assert len(longest.json()["data"]) == 92
    assert problem(too_long) == (422, "window_too_large")
    assert too_long.json()["limit_days"] == 92


async def test_from_after_to_is_range_invalid(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated)

    response = await api.get(
        scene.url("ai/collection/daily"),
        params=_span(days_ago(0), days_ago(3)),
        headers=scene.caller.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert {(e["path"], e["code"]) for e in response.json()["errors"]} == {
        ("from", "range_invalid")
    }


async def test_the_default_window_is_28_days_ending_today(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, timezone="Pacific/Auckland")
    zone_today = today("Pacific/Auckland")

    rows, meta = await _daily(api, scene)

    assert len(rows) == 28
    assert rows[0]["date"] == days_ago(27, "Pacific/Auckland").isoformat()
    assert rows[-1]["date"] == zone_today.isoformat()
    assert meta["window"] == {
        "from": days_ago(27, "Pacific/Auckland").isoformat(),
        "to": zone_today.isoformat(),
        "timezone": "Pacific/Auckland",
    }


async def test_a_project_outside_the_members_scope_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    scene = await make_scene(resources, migrated, role="owner")
    other = await another_project(migrated, scene)
    limited = await member(
        resources, migrated, scene.workspace, "viewer", project_ids=[other.project.id]
    )

    response = await api.get(scene.url("ai/collection/daily"), headers=limited.headers)

    assert problem(response) == (404, "not_found")
