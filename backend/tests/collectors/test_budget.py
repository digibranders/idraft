"""The budget check (docs/27-cost-model.md section 10.3). As `app_worker`."""

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import budget, ledger
from sightline.collectors.budget import BudgetVerdict, SpendMemo
from sightline.domain.tasks import partition_month
from sightline.domain.workloads import TaskWorkload
from tests.api.auth.support import execute, fetch
from tests.collectors.support import (
    NOW,
    Project,
    another_project,
    make_budget,
    make_tenant,
    new_run,
    seed_run,
    spend,
)
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


async def _check(
    sessions: Ledger,
    project: Project,
    estimate: str | None = None,
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
    *,
    now: datetime = NOW,
    memo: SpendMemo | None = None,
) -> BudgetVerdict:
    """With an estimate, the question asked when a run is planned; without, when tasks are
    about to be sent."""
    async with sessions() as db, db.begin():
        return await budget.check(
            db,
            workspace_id=project.workspace_id,
            project_id=project.id,
            workload=workload,
            estimate=None if estimate is None else Decimal(estimate),
            now=now,
            memo=memo,
        )


async def _cost(pg: PostgresServer, project: Project, run_id: UUID, total: str) -> None:
    """The run's one task has cost `total` so far, as the ledger records a submission: on the
    task and as cost events."""
    (before,) = await fetch(
        pg,
        "SELECT coalesce(sum(cost_usd), 0) AS cost FROM ops.collection_tasks WHERE run_id = $1",
        run_id,
    )
    await execute(
        pg,
        "UPDATE ops.collection_tasks SET cost_usd = $2 WHERE run_id = $1",
        run_id,
        Decimal(total),
    )
    await spend(pg, project, str(Decimal(total) - before["cost"]), run_id=run_id)


async def test_work_with_no_budget_is_allowed(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    await spend(migrated, project, "1000")

    verdict = await _check(worker_db, project, "500")

    assert verdict == BudgetVerdict(blocked_by=None)
    assert verdict.allowed


async def test_a_run_is_blocked_when_it_would_take_spend_past_the_limit(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00")
    await spend(migrated, project, "6")

    within = await _check(worker_db, project, "4")
    over = await _check(worker_db, project, "4.01")

    # Exactly the limit is still within it.
    assert within.allowed
    assert (over.blocked_by, over.allowed) == (limit, False)


async def test_a_batch_is_held_back_once_the_limit_is_reached(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """At dispatch there is no estimate: the question is whether the budget is used up."""
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00")
    await spend(migrated, project, "9.99")
    assert (await _check(worker_db, project)).allowed

    await spend(migrated, project, "0.01")

    assert (await _check(worker_db, project)).blocked_by == limit


async def test_a_limit_of_zero_allows_nothing(worker_db: Ledger, migrated: PostgresServer) -> None:
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "0")
    assert (await _check(worker_db, project)).blocked_by == limit
    assert (await _check(worker_db, project, "0")).blocked_by == limit
    assert (await _check(worker_db, project, "0.0006")).blocked_by == limit


async def test_only_this_months_spend_in_the_budgets_group_counts(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    await make_budget(migrated, project, "10.00", workload="seo_rank")
    # Last month, another group, and another workspace: none of it is this budget's.
    await spend(migrated, project, "50", when=NOW.replace(day=1) - timedelta(days=1))
    await spend(migrated, project, "50", workload="ai_prompt")
    await spend(migrated, await make_tenant(migrated), "50")
    # The AI Overview surcharge is part of what rank tracking costs.
    await spend(migrated, project, "3", workload="ai_overview")
    await spend(migrated, project, "3")

    assert (await _check(worker_db, project, "4")).allowed
    assert not (await _check(worker_db, project, "4.01")).allowed
    # A budget for rank tracking says nothing about prompts.
    assert (await _check(worker_db, project, "999", TaskWorkload.AI_PROMPT)).allowed


async def test_a_budget_for_everything_counts_every_workload(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    everything = await make_budget(migrated, project, "10.00", workload="all")
    await spend(migrated, project, "4", workload="ai_prompt")
    await spend(migrated, project, "4", workload="keyword_metrics")

    assert (await _check(worker_db, project, "2")).allowed
    assert (await _check(worker_db, project, "2.01")).blocked_by == everything
    assert (
        await _check(worker_db, project, "2.01", TaskWorkload.GSC_SYNC)
    ).blocked_by == everything


async def test_a_budget_with_no_group_covers_everything(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    unnamed = await make_budget(migrated, project, "1.00", workload=None)
    await spend(migrated, project, "1", workload="ai_prompt")

    assert (await _check(worker_db, project)).blocked_by == unnamed


async def test_a_workspace_budget_and_a_project_budget_both_apply(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    first = await make_tenant(migrated)
    second = await another_project(migrated, first)
    workspace_wide = await make_budget(migrated, first, "10.00")
    for_first = await make_budget(migrated, first, "3.00", for_project=True)
    await spend(migrated, first, "2")
    await spend(migrated, second, "5")

    # The first project is inside its own budget (2 of 3) and the workspace's (7 of 10).
    assert (await _check(worker_db, first, "1")).allowed
    # Its own budget is the narrower one, so it is the one named.
    assert (await _check(worker_db, first, "1.5")).blocked_by == for_first
    # The second project has no budget of its own; the workspace's stops it at 10.
    assert (await _check(worker_db, second, "3")).allowed
    assert (await _check(worker_db, second, "3.01")).blocked_by == workspace_wide


async def test_a_budget_that_only_alerts_never_blocks(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    alerting = await make_budget(migrated, project, "1.00", action="alert_only")
    await spend(migrated, project, "5")

    verdict = await _check(worker_db, project, "5")

    assert verdict.allowed
    assert verdict.past_soft_limit == (alerting,)


@pytest.mark.parametrize(
    ("spent", "estimate", "past"),
    [
        ("7", "0.99", False),
        ("7", "1", True),
        ("8", "0", True),
        ("7.99", None, False),
        ("8", None, True),
    ],
)
async def test_the_soft_limit_is_reported_and_stops_nothing(
    worker_db: Ledger, migrated: PostgresServer, spent: str, estimate: str | None, past: bool
) -> None:
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00", soft_limit_pct=80)
    await spend(migrated, project, spent)

    verdict = await _check(worker_db, project, estimate)

    assert verdict.allowed
    assert verdict.past_soft_limit == ((limit,) if past else ())


async def test_a_run_is_judged_with_what_the_runs_under_way_will_still_spend(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """A run planned a minute ago has sent nothing yet. Judged by spend alone, the next one
    would find the budget almost untouched and both would be let through."""
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00")
    first = await seed_run(worker_db, project, 1, estimate="8")

    # 8 is spoken for: a second run of 8 does not fit, one of 2 does.
    assert (await _check(worker_db, project, "8")).blocked_by == limit
    assert (await _check(worker_db, project, "2.01")).blocked_by == limit
    assert (await _check(worker_db, project, "2")).allowed
    # Tasks of the run under way are still sent: the limit itself is not reached.
    assert (await _check(worker_db, project)).allowed

    # As the run spends, its estimate is not counted a second time.
    await _cost(migrated, project, first, "5")
    assert (await _check(worker_db, project, "2")).allowed
    assert (await _check(worker_db, project, "2.01")).blocked_by == limit
    # A run that cost more than it estimated commits nothing further.
    await _cost(migrated, project, first, "9")
    assert (await _check(worker_db, project, "1")).allowed
    assert (await _check(worker_db, project, "1.01")).blocked_by == limit


async def test_a_run_that_began_last_month_still_counts_for_what_it_has_left(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00")
    last_evening = partition_month(NOW) - timedelta(hours=1)
    await seed_run(worker_db, project, 1, estimate="8", window_start=last_evening)

    assert (await _check(worker_db, project, "8")).blocked_by == limit
    assert (await _check(worker_db, project, "2")).allowed


async def test_only_runs_the_budget_covers_are_counted_as_under_way(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    sibling = await another_project(migrated, project)
    await make_budget(migrated, project, "10.00", for_project=True)
    # Another project, another group, another workspace, and a run that has ended.
    await seed_run(worker_db, sibling, 1, estimate="9")
    await seed_run(worker_db, project, 1, estimate="9", workload=TaskWorkload.AI_PROMPT)
    await seed_run(worker_db, await make_tenant(migrated), 1, estimate="9")
    ended = await seed_run(worker_db, project, 1, estimate="9")
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'completed' WHERE id = $1", ended
    )

    assert (await _check(worker_db, project, "10")).allowed


async def test_two_runs_planned_at_once_cannot_both_take_the_same_room(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    """Planning in one workspace takes its turn. The second planner reads the budget after
    the first has started its run."""
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00")
    checked = asyncio.Event()
    verdicts: list[BudgetVerdict] = []

    async def plan(*, first: bool) -> None:
        run = new_run(project)
        async with worker_db() as db, db.begin():
            run_id = await ledger.create_run(db, run, now=NOW)
            assert run_id is not None
            verdict = await budget.check(
                db,
                workspace_id=project.workspace_id,
                project_id=project.id,
                workload=run.workload,
                estimate=Decimal("8"),
                now=NOW,
            )
            if first:
                checked.set()
                # Long enough for the second planner to reach the budget and have to wait.
                await asyncio.sleep(0.5)
            verdicts.append(verdict)
            if verdict.allowed:
                await ledger.start_run(db, run_id, tasks_total=0, estimated_cost_usd=Decimal("8"))

    async def second() -> None:
        await checked.wait()
        await plan(first=False)

    await asyncio.gather(plan(first=True), second())

    assert [verdict.blocked_by for verdict in verdicts] == [None, limit]


async def test_spend_is_read_once_in_a_tick_that_asks_about_many_projects(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    sibling = await another_project(migrated, project)
    limit = await make_budget(migrated, project, "10.00")
    await spend(migrated, project, "9")
    memo: SpendMemo = {}

    assert (await _check(worker_db, project, memo=memo)).allowed
    # Spent since, but this tick has its answer: every project is judged on the same figure.
    await spend(migrated, sibling, "5")
    assert (await _check(worker_db, sibling, memo=memo)).allowed
    assert list(memo.values()) == [Decimal("9.000000")]

    assert (await _check(worker_db, sibling, memo={})).blocked_by == limit


async def test_the_month_is_the_utc_month_whatever_zone_the_time_is_given_in(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "1.00")
    await spend(migrated, project, "1")
    india = timezone(timedelta(hours=5, minutes=30))
    # Four hours before this month ends in UTC. In India the next month has begun.
    this_month = partition_month(NOW)
    next_month = partition_month(this_month + timedelta(days=32))
    late = (next_month - timedelta(hours=4)).astimezone(india)
    assert late.month != this_month.month

    assert (await _check(worker_db, project, now=late)).blocked_by == limit
    # An hour into the next month, this month's spend is no longer counted.
    assert (await _check(worker_db, project, now=next_month + timedelta(hours=1))).allowed
    with pytest.raises(ValueError, match="aware"):
        await _check(worker_db, project, now=NOW.replace(tzinfo=None))
