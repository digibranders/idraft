"""Plan D2 from a real ingest: one bulk run asks three prompts on three engines as one manual
run; the worker plans, sends and reads it over the real DataForSEO adapter (the mock transport
of `test_ai_end_to_end`, serving the answers captured from the provider), and the source and
fan-out routes count what ingest wrote. A budget of 0 blocks a bulk run as it blocks Run now.
Capturing `tests/fixtures/dataforseo/captured` again changes nothing here: every expected value
is read from the tables or the fixture."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import fetch
from tests.api.conftest import api, auth_app, import_store, mailbox, resources
from tests.collectors.rank_support import Ledger
from tests.collectors.support import make_budget
from tests.collectors.test_ai_end_to_end import (
    Scene,
    make_scene,
    pipeline,
    run_rows,
    task_count,
    turn_engines_on,
)
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

__all__ = ["api", "auth_app", "import_store", "mailbox", "resources"]


async def _bulk(api: httpx.AsyncClient, scene: Scene) -> httpx.Response:
    return await api.post(
        scene.url("ai", "runs"),
        json={"prompt_ids": [str(prompt.id) for prompt in scene.prompts]},
        headers=scene.owner.headers,
    )


async def test_one_bulk_run_to_the_sources_and_the_fanout_queries(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Ledger
) -> None:
    scene = await make_scene(resources, migrated)
    await turn_engines_on(api, scene)

    asked = await _bulk(api, scene)

    assert asked.status_code == 202, asked.text
    assert (asked.json()["meta"]["prompts"], asked.json()["meta"]["answers"]) == (3, 9)
    async with pipeline(worker_db) as worker:
        await worker.run(datetime.now(UTC))
        assert worker.gateway.tasks_posted == 9
    # One run made all nine tasks.
    (run,) = await run_rows(migrated, scene)
    assert run["tasks_total"] == 9
    assert await task_count(migrated, scene) == 9

    # The sources, against a count over the citations ingest wrote.
    expected = await fetch(
        migrated,
        "SELECT d.registrable_domain, c.domain_role, "
        "count(DISTINCT (c.observation_id, c.url_id)) AS units, "
        "count(DISTINCT c.observation_id) AS answers "
        "FROM ai.citations c JOIN core.domains d ON d.id = c.domain_id "
        "WHERE c.project_id = $1 GROUP BY d.registrable_domain, c.domain_role",
        scene.project.id,
    )
    assert expected, "ingest wrote no citations, so there is nothing to compare"
    sources = await api.get(
        scene.url("ai", "sources", "domains"), params={"limit": 200}, headers=scene.owner.headers
    )
    assert sources.status_code == 200, sources.text
    body = sources.json()
    shown = {
        (row["registrable_domain"], row["domain_role"]): (
            row["citation_units"],
            row["observations"],
        )
        for row in body["data"]
    }
    assert shown == {
        (row["registrable_domain"], row["domain_role"]): (row["units"], row["answers"])
        for row in expected
    }
    assert body["meta"]["answers"] == 9
    assert body["meta"]["citation_units"] == sum(row["units"] for row in expected)

    # The fan-out: each ChatGPT answer is the captured one, so each query was issued three times.
    captured = json.loads((FIXTURES / "captured" / "chatgpt_scraper_answer.json").read_text())
    issued = captured["tasks"][0]["result"][0]["fan_out_queries"]
    fanout = await api.get(
        scene.url("ai", "fanout-queries"), params={"min_support": 1}, headers=scene.owner.headers
    )
    assert fanout.status_code == 200, fanout.text
    rows = fanout.json()["data"]
    assert {row["normalized_text"] for row in rows} == {
        " ".join(query.split()).lower() for query in issued
    }
    assert {(row["observations"], row["prompts"]) for row in rows} == {(3, 3)}
    meta = fanout.json()["meta"]
    assert (meta["answers"], meta["answers_with_fanout"], meta["answers_truncated"]) == (3, 3, 0)
    assert meta["engines_without_fanout"] == ["gemini_web", "google_ai_mode"]
    top = await fetch(
        migrated,
        "SELECT d.registrable_domain, count(DISTINCT (c.observation_id, c.url_id)) AS units "
        "FROM ai.citations c JOIN core.domains d ON d.id = c.domain_id "
        "WHERE c.project_id = $1 AND c.engine_code = 'chatgpt_web' "
        "GROUP BY d.registrable_domain, c.domain_role, c.role_entity_id "
        "ORDER BY units DESC, d.registrable_domain, c.domain_role, c.role_entity_id NULLS FIRST "
        "LIMIT 5",
        scene.project.id,
    )
    assert top
    assert rows
    for row in rows:
        assert [
            (cited["registrable_domain"], cited["citation_units"]) for cited in row["cited_domains"]
        ] == [(found["registrable_domain"], found["units"]) for found in top]


async def test_a_budget_of_zero_blocks_a_bulk_run_and_nothing_is_sent(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, worker_db: Ledger
) -> None:
    """The emergency brake of the first-run guide holds a bulk run as it holds Run now, and the
    run keeps the estimate it was blocked on: nine tasks at 0.0012."""
    scene = await make_scene(resources, migrated)
    await turn_engines_on(api, scene)
    budget_id = await make_budget(
        migrated, scene.project, "0", workload="ai_prompt", for_project=True
    )

    asked = await _bulk(api, scene)
    async with pipeline(worker_db) as worker:
        await worker.run(datetime.now(UTC))
        assert worker.gateway.requests == []

    assert asked.status_code == 202, asked.text
    (run,) = await run_rows(migrated, scene)
    assert (run["status"], run["status_reason"], run["blocked_by_budget_id"]) == (
        "budget_blocked",
        "budget_exceeded",
        budget_id,
    )
    (estimate,) = await fetch(
        migrated, "SELECT estimated_cost_usd FROM ops.collection_runs WHERE id = $1", run["id"]
    )
    assert estimate["estimated_cost_usd"] == Decimal("0.0108")
    assert await task_count(migrated, scene) == 0
