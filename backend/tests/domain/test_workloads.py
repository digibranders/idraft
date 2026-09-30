"""Workload names and their budget groups (docs/04-data-model.md section 11.4.1)."""

import pytest

from sightline.domain.workloads import (
    BudgetGroup,
    CostWorkload,
    TaskWorkload,
    budget_group,
    cost_workloads,
)


def test_every_task_workload_is_a_cost_workload_of_the_same_name() -> None:
    assert {workload.value for workload in TaskWorkload} <= {
        workload.value for workload in CostWorkload
    }


@pytest.mark.parametrize(
    ("workload", "group"),
    [
        (TaskWorkload.SEO_RANK, BudgetGroup.SEO_RANK),
        (CostWorkload.AI_OVERVIEW, BudgetGroup.SEO_RANK),
        (TaskWorkload.AI_PROMPT, BudgetGroup.AI_PROMPT),
        (TaskWorkload.AI_MODE_KEYWORD, BudgetGroup.AI_PROMPT),
        (TaskWorkload.KEYWORD_METRICS, BudgetGroup.KEYWORD_RESEARCH),
        (TaskWorkload.DISCOVERY, BudgetGroup.KEYWORD_RESEARCH),
        (CostWorkload.KEYWORD_RESEARCH, BudgetGroup.KEYWORD_RESEARCH),
        (TaskWorkload.AI_BENCHMARK, BudgetGroup.AI_BENCHMARK),
        (CostWorkload.EXTRACTION_LLM, BudgetGroup.EXTRACTION_LLM),
        (TaskWorkload.GSC_SYNC, BudgetGroup.FIRST_PARTY),
        (TaskWorkload.BING_SYNC, BudgetGroup.FIRST_PARTY),
        (TaskWorkload.GA4_SYNC, BudgetGroup.FIRST_PARTY),
        (TaskWorkload.CLOUDFLARE_SYNC, BudgetGroup.FIRST_PARTY),
        (CostWorkload.FIRST_PARTY, BudgetGroup.FIRST_PARTY),
    ],
)
def test_a_workload_counts_against_the_group_of_the_table(
    workload: TaskWorkload | CostWorkload, group: BudgetGroup
) -> None:
    assert budget_group(workload) is group


def test_every_cost_workload_has_exactly_one_group_other_than_all() -> None:
    groups = [group for group in BudgetGroup if group is not BudgetGroup.ALL]
    for workload in CostWorkload:
        covering = [group for group in groups if workload in cost_workloads(group)]
        assert covering == [budget_group(workload)], workload


def test_a_budget_for_all_covers_every_cost_workload() -> None:
    assert cost_workloads(BudgetGroup.ALL) == frozenset(CostWorkload)
    assert cost_workloads(BudgetGroup.SEO_RANK) == {
        CostWorkload.SEO_RANK,
        CostWorkload.AI_OVERVIEW,
    }
    assert cost_workloads(BudgetGroup.AI_BENCHMARK) == {CostWorkload.AI_BENCHMARK}
