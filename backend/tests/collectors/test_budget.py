"""The budget check (docs/27-cost-model.md section 10.3). As `app_worker`."""

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import budget
from sightline.collectors.budget import BudgetVerdict
from sightline.domain.workloads import TaskWorkload
from tests.collectors.support import NOW, Project, make_budget, make_tenant, spend
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]


async def _check(
    sessions: Ledger,
    project: Project,
    estimate: str = "0",
    workload: TaskWorkload = TaskWorkload.SEO_RANK,
) -> BudgetVerdict:
    async with sessions() as db, db.begin():
        return await budget.check(
            db,
            workspace_id=project.workspace_id,
            project_id=project.id,
            workload=workload,
            estimate=Decimal(estimate),
            now=NOW,
        )


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
    second = Project(workspace_id=first.workspace_id, id=await _another_project(migrated, first))
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


async def _another_project(pg: PostgresServer, project: Project):  # type: ignore[no-untyped-def]
    from tests.api.workspaces.support import make_project

    return await make_project(pg, project.workspace_id)


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
    ("spent", "estimate", "past"), [("7", "0.99", False), ("7", "1", True), ("8", "0", True)]
)
async def test_the_soft_limit_is_reported_and_stops_nothing(
    worker_db: Ledger, migrated: PostgresServer, spent: str, estimate: str, past: bool
) -> None:
    project = await make_tenant(migrated)
    limit = await make_budget(migrated, project, "10.00", soft_limit_pct=80)
    await spend(migrated, project, spent)

    verdict = await _check(worker_db, project, estimate)

    assert verdict.allowed
    assert verdict.past_soft_limit == ((limit,) if past else ())
