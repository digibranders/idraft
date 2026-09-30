"""The names the code uses are the names the database accepts.

A workload, a channel or a status is a string in a CHECK constraint and an enum or a literal in
the code. Nothing but this test stops one from being renamed without the other.
"""

import re
from typing import get_args

import pytest

from sightline.collectors import ledger
from sightline.collectors.ledger import CostSource, Priority, Trigger
from sightline.domain.retries import RetryStatus
from sightline.domain.schedules import Cadence
from sightline.domain.workloads import BudgetGroup, CostChannel, CostWorkload, TaskWorkload
from tests.conftest import PostgresServer
from tests.db.support import connection

_VALUE = re.compile(r"'([^']*)'::text")


async def _allowed(pg: PostgresServer, table: str, column: str) -> set[str]:
    """The values the CHECK constraint on `column` lists."""
    async with connection(pg) as db:
        definitions = await db.fetch(
            "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint "
            "WHERE conrelid = $1::regclass AND contype = 'c'",
            table,
        )
    lists = [
        set(_VALUE.findall(row["definition"]))
        for row in definitions
        if row["definition"].startswith(f"CHECK (({column} = ANY (ARRAY[")
    ]
    assert len(lists) == 1, (table, column, [row["definition"] for row in definitions])
    return lists[0]


@pytest.mark.parametrize(
    ("table", "column", "names"),
    [
        ("ops.schedules", "workload", set(TaskWorkload)),
        ("ops.collection_runs", "workload", set(TaskWorkload)),
        ("ops.collection_tasks", "workload", set(TaskWorkload)),
        ("ops.provider_cost_events", "workload", set(CostWorkload)),
        ("ops.provider_cost_events", "channel", set(CostChannel)),
        ("ops.provider_cost_events", "cost_source", set(get_args(CostSource))),
        ("ops.budgets", "workload", set(BudgetGroup)),
        ("ops.schedules", "priority", set(get_args(Priority))),
        ("ops.collection_runs", "trigger", set(get_args(Trigger))),
    ],
)
async def test_the_code_and_the_database_list_the_same_names(
    migrated: PostgresServer, table: str, column: str, names: set[str]
) -> None:
    assert {str(name) for name in names} == await _allowed(migrated, table, column)


async def test_the_database_knows_one_cadence_the_rules_do_not(migrated: PostgresServer) -> None:
    # `cron` is reserved in the schema and has no rule yet; the planner leaves such a schedule.
    assert await _allowed(migrated, "ops.schedules", "cadence") == {*Cadence, "cron"}


async def test_every_status_the_ledger_writes_is_a_status_a_task_may_have(
    migrated: PostgresServer,
) -> None:
    statuses = await _allowed(migrated, "ops.collection_tasks", "status")
    written = {
        *ledger.TERMINAL_STATUSES,
        *get_args(RetryStatus),
        "pending",
        "submit_unknown",
        "submitted",
    }
    assert len(written) == 8
    assert written <= statuses
