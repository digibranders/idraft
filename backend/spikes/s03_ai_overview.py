"""S-03: how many AI Overviews are missed without asynchronous loading (docs/01 section 12).

500 keywords, desktop, depth 10, sent twice in the same hour: once without
`load_async_ai_overview` and once with it. Records the share of answers with an AI Overview in
each run, with 95% Wilson intervals, the share of those loaded asynchronously, and what the
tasks cost.

    uv run python -m spikes.s03_ai_overview --cap 2 --keywords keywords.txt
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any

from idraft.providers.contract import CanonicalRequest
from idraft.providers.dataforseo.serp import ENDPOINT, SERP_ORGANIC, SerpOrganicParams, task_body
from spikes.common import (
    Budget,
    Sent,
    arguments,
    each_costs,
    fetch_all,
    first_result,
    live,
    read_keywords,
    run,
    say,
    submit_all,
    task_cost,
    wait_ready,
    wilson,
    worst_case,
    write_report,
)

KEYWORDS = 500
WITHOUT = "serp/google/organic#without-async-overview"


def _without_async_overview(request: CanonicalRequest, tag: str) -> dict[str, object]:
    return {**task_body(request, tag), "load_async_ai_overview": False}


def _overview(body: Any) -> dict[str, Any] | None:
    for item in first_result(body).get("items") or []:
        if isinstance(item, dict) and item.get("type") == "ai_overview":
            return item
    return None


async def main() -> None:
    options = arguments(__doc__ or "S-03", keywords=KEYWORDS)
    budget = Budget(cap=options.cap)
    keywords = read_keywords(options.keywords, KEYWORDS)
    runs: dict[bool, list[Sent]] = {}
    for loaded in (False, True):
        runs[loaded] = [
            Sent(
                number=len(keywords) * int(loaded) + index + 1,
                label="async" if loaded else "plain",
                params=SerpOrganicParams(
                    keyword=keyword, location_code=2840, language_code="en", depth=10
                ),
            )
            for index, keyword in enumerate(keywords)
        ]
    budget.allow(
        worst_case(10, async_overview=False) * KEYWORDS
        + worst_case(10, async_overview=True) * KEYWORDS
    )

    endpoints = {SERP_ORGANIC: ENDPOINT, WITHOUT: replace(ENDPOINT, build=_without_async_overview)}
    async with live(endpoints) as api:
        for loaded, tasks in runs.items():
            say(f"sending {len(tasks)} tasks, async overview {loaded}")
            await submit_all(
                api.provider,
                SERP_ORGANIC if loaded else WITHOUT,
                tasks,
                budget,
                each_costs(10, async_overview=loaded),
            )
        every = [task for tasks in runs.values() for task in tasks]
        await wait_ready(api.provider, SERP_ORGANIC, every)
        await fetch_all(api.provider, SERP_ORGANIC, every)

    sections = [
        "## AI Overview presence",
        "",
        "| Run | Answers | With an AI Overview | Share (95% interval) | Loaded asynchronously | "
        "Mean cost at submission | Mean cost in result |",
        "|---|---|---|---|---|---|---|",
    ]
    for loaded, tasks in runs.items():
        answered = [task for task in tasks if task.body is not None]
        overviews = [item for task in answered if (item := _overview(task.body)) is not None]
        low, high = wilson(len(overviews), len(answered))
        asynchronous = sum(1 for item in overviews if item.get("asynchronous_ai_overview"))
        submitted = [task.submit_cost for task in tasks if task.submit_cost is not None]
        in_result = [cost for task in answered if (cost := task_cost(task.body)) is not None]
        share = len(overviews) / max(len(answered), 1)
        sections.append(
            f"| {'with' if loaded else 'without'} async loading | {len(answered)} | "
            f"{len(overviews)} | {share:.1%} ({low:.1%} to {high:.1%}) | {asynchronous} | "
            f"{_mean(submitted)} | {_mean(in_result)} |"
        )
    sections += [
        "",
        "Doc 06 section 3.1 sends `load_async_ai_overview: true` on every task. Keep it if the "
        "run with it finds materially more AI Overviews; the async share feeds the cost model "
        "(doc 06 section 6.2, doc 27).",
    ]
    path = write_report("S-03", "AI Overview with and without async loading", budget, sections)
    say(f"report: {path}")


def _mean(values: list[Decimal]) -> str:
    return "none" if not values else f"{sum(values) / len(values):.6f}"


if __name__ == "__main__":
    run(main)
