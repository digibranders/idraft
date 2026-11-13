"""Statement counts of the budget list, the forecast and the unit costs (WP-30 T2): each is a fixed
number of grouped statements, the same whatever the number of answers, prompts, schedules or
budgets. A loop that asks the database once per row makes these tests fail. Every statement names
the workspace as a bound value of its own, as well as row-level security."""

from __future__ import annotations

import re

import httpx

from idraft.api.resources import Resources
from tests.api.ai.sources_support import statements
from tests.api.ai.support import seed_prompts
from tests.api.entities.support import member
from tests.api.operations.collection_support import (
    ENGINES,
    Scene,
    another_project,
    make_scene,
    new_prompt,
)
from tests.api.operations.cost_support import costed_answer, created, daily_cost, this_month, url
from tests.collectors.support import make_schedule
from tests.conftest import PostgresServer

TENANT_TABLES = (
    "ops.budgets",
    "ops.schedules",
    "ops.cost_daily",
    "ai.observations",
    "ai.prompts",
    "ai.project_engines",
    "seo.tracked_keywords",
    "core.projects",
)
WORKSPACE_FILTER = re.compile(r"\bworkspace_id = \$\d+")
PROJECT_FILTER = re.compile(r"\bproject_id (?:= \$\d+|IN \()")
# Everything the request sends: the session and membership checks, the transaction's scope, the
# clock and the reads.
UNIT_COSTS_MAX = 12
FORECAST_MAX = 16
BUDGET_LIST_MAX = 6


def _tenant_reads(seen: list[str]) -> list[str]:
    return [sql for sql in seen if any(table in sql for table in TENANT_TABLES)]


def _unscoped(reads: list[str]) -> list[str]:
    """The reads that do not name the workspace, or the project where the table has one, as a
    bound value of their own."""
    return [
        sql
        for sql in reads
        if not WORKSPACE_FILTER.search(sql)
        or (
            not any(table in sql for table in ("core.projects", "ops.budgets"))
            and not PROJECT_FILTER.search(sql)
        )
    ]


async def _read(api: httpx.AsyncClient, resources: Resources, scene: Scene, path: str) -> list[str]:
    with statements(resources) as seen:
        response = await api.get(
            url(scene.workspace, path),
            params=None if path == "budgets" else {"month": this_month()},
            headers=scene.caller.headers,
        )
    assert response.status_code == 200, response.text
    return seen


async def test_unit_cost_statements_do_not_grow_with_answers_or_prompts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    small = await make_scene(resources, migrated, role="analyst", engines=ENGINES)
    large = await make_scene(resources, migrated, role="analyst", engines=ENGINES)
    for scene, answers, prompts in ((small, 2, 1), (large, 24, 9)):
        first = await new_prompt(migrated, scene, "Which SOC provider is best?")
        for index in range(prompts - 1):
            await new_prompt(migrated, scene, f"Prompt {index}")
        for index in range(answers):
            await costed_answer(
                migrated, scene, first, "0.001", engine=ENGINES[index % len(ENGINES)]
            )
        await daily_cost(migrated, scene.project, "ai_prompt", "0.10")
    # More projects add rows, not reads: the large workspace has three, the small one has one.
    await another_project(migrated, large)
    await another_project(migrated, large)
    # A first read of each caller warms its session cache, so each counted read starts alike.
    await _read(api, resources, small, "costs/unit-costs")
    await _read(api, resources, large, "costs/unit-costs")

    few = await _read(api, resources, small, "costs/unit-costs")
    many = await _read(api, resources, large, "costs/unit-costs")

    assert len(few) == len(many)
    assert len(many) <= UNIT_COSTS_MAX
    assert _unscoped(_tenant_reads(many)) == []
    # The projects, the grouped answers, the grouped spend and the counts: a read that went
    # missing would pass the checks above.
    assert len(_tenant_reads(many)) == 4


async def test_forecast_statements_do_not_grow_with_prompts_or_schedules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    small = await make_scene(resources, migrated, role="analyst", engines=ENGINES)
    large = await make_scene(resources, migrated, role="analyst", engines=ENGINES)
    await seed_prompts(migrated, small.workspace, small.project.id, 2)
    await seed_prompts(migrated, large.workspace, large.project.id, 40)
    await make_schedule(migrated, small.project, workload="ai_prompt", cadence="weekly", weekday=1)
    for weekday in range(7):
        await make_schedule(
            migrated, large.project, workload="ai_prompt", cadence="weekly", weekday=weekday
        )
    await make_schedule(migrated, large.project, workload="ai_prompt", cadence="daily")
    await _read(api, resources, small, "costs/forecast")
    await _read(api, resources, large, "costs/forecast")

    few = await _read(api, resources, small, "costs/forecast")
    many = await _read(api, resources, large, "costs/forecast")

    assert len(few) == len(many)
    assert len(many) <= FORECAST_MAX
    assert _unscoped(_tenant_reads(many)) == []
    # The schedules read and the planner's own reads for the one project.
    assert any("ops.schedules" in sql for sql in many)
    assert any("ai.prompts" in sql for sql in many)


async def test_budget_list_is_one_statement_beyond_setup(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    few = await make_scene(resources, migrated, role="analyst")
    many = await make_scene(resources, migrated, role="analyst")
    for scene, groups in (
        (few, ("all",)),
        (
            many,
            ("seo_rank", "ai_prompt", "keyword_research", "ai_benchmark", "extraction_llm", "all"),
        ),
    ):
        owner = (await member(resources, migrated, scene.workspace, "owner")).headers
        for group in groups:
            await created(api, scene.workspace, owner, workload=group)
    await _read(api, resources, few, "budgets")
    await _read(api, resources, many, "budgets")

    one = await _read(api, resources, few, "budgets")
    six = await _read(api, resources, many, "budgets")

    assert len(one) == len(six)
    assert len(six) <= BUDGET_LIST_MAX
    reads = _tenant_reads(six)
    # The rows and their total come in one statement.
    assert len(reads) == 1
    assert _unscoped(reads) == []
