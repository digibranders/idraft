"""The three lists of workload names and how they map (docs/04-data-model.md section 11.4.1).

A schedule, run or task has a task workload. A cost event has a cost workload: the task's own, or
one of the extra kinds of spend that belong to no task. A budget has a group, and enforcement
maps a cost workload to its group with the table below.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType


class TaskWorkload(StrEnum):
    SEO_RANK = "seo_rank"
    AI_PROMPT = "ai_prompt"
    AI_MODE_KEYWORD = "ai_mode_keyword"
    KEYWORD_METRICS = "keyword_metrics"
    DISCOVERY = "discovery"
    AI_BENCHMARK = "ai_benchmark"
    GSC_SYNC = "gsc_sync"
    BING_SYNC = "bing_sync"
    GA4_SYNC = "ga4_sync"
    CLOUDFLARE_SYNC = "cloudflare_sync"


class CostWorkload(StrEnum):
    SEO_RANK = "seo_rank"
    AI_PROMPT = "ai_prompt"
    AI_MODE_KEYWORD = "ai_mode_keyword"
    KEYWORD_METRICS = "keyword_metrics"
    DISCOVERY = "discovery"
    AI_BENCHMARK = "ai_benchmark"
    GSC_SYNC = "gsc_sync"
    BING_SYNC = "bing_sync"
    GA4_SYNC = "ga4_sync"
    CLOUDFLARE_SYNC = "cloudflare_sync"
    # Spend that belongs to no task of its own.
    AI_OVERVIEW = "ai_overview"
    EXTRACTION_LLM = "extraction_llm"
    KEYWORD_RESEARCH = "keyword_research"
    FIRST_PARTY = "first_party"


class BudgetGroup(StrEnum):
    SEO_RANK = "seo_rank"
    AI_PROMPT = "ai_prompt"
    KEYWORD_RESEARCH = "keyword_research"
    AI_BENCHMARK = "ai_benchmark"
    EXTRACTION_LLM = "extraction_llm"
    FIRST_PARTY = "first_party"
    ALL = "all"


_GROUP_OF: Mapping[CostWorkload, BudgetGroup] = MappingProxyType(
    {
        CostWorkload.SEO_RANK: BudgetGroup.SEO_RANK,
        # The AI Overview surcharge is part of what a rank check costs.
        CostWorkload.AI_OVERVIEW: BudgetGroup.SEO_RANK,
        CostWorkload.AI_PROMPT: BudgetGroup.AI_PROMPT,
        CostWorkload.AI_MODE_KEYWORD: BudgetGroup.AI_PROMPT,
        CostWorkload.KEYWORD_METRICS: BudgetGroup.KEYWORD_RESEARCH,
        CostWorkload.DISCOVERY: BudgetGroup.KEYWORD_RESEARCH,
        CostWorkload.KEYWORD_RESEARCH: BudgetGroup.KEYWORD_RESEARCH,
        CostWorkload.AI_BENCHMARK: BudgetGroup.AI_BENCHMARK,
        CostWorkload.EXTRACTION_LLM: BudgetGroup.EXTRACTION_LLM,
        CostWorkload.GSC_SYNC: BudgetGroup.FIRST_PARTY,
        CostWorkload.BING_SYNC: BudgetGroup.FIRST_PARTY,
        CostWorkload.GA4_SYNC: BudgetGroup.FIRST_PARTY,
        CostWorkload.CLOUDFLARE_SYNC: BudgetGroup.FIRST_PARTY,
        CostWorkload.FIRST_PARTY: BudgetGroup.FIRST_PARTY,
    }
)


def budget_group(workload: CostWorkload | TaskWorkload) -> BudgetGroup:
    """The budget group spend on this workload counts against. Every task workload is also a
    cost workload of the same name."""
    return _GROUP_OF[CostWorkload(workload.value)]


def cost_workloads(group: BudgetGroup) -> frozenset[CostWorkload]:
    """The cost workloads a budget of this group covers. `all` covers every one."""
    if group is BudgetGroup.ALL:
        return frozenset(CostWorkload)
    return frozenset(workload for workload, mapped in _GROUP_OF.items() if mapped is group)
