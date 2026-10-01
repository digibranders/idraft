"""S-01: how a SERP task is billed, and whether its tag comes back (docs/01 section 12,
docs/06 section 11).

400 standard tasks: 100 keywords at depth 10 and 100, each with and without the asynchronous AI
Overview. Records the cost at submission and in the result, whether `tasks_ready` and `id_list`
echo the tag, and captures one answer of each call as a test fixture.

    uv run python -m spikes.s01_billing_and_tags --cap 5 --keywords keywords.txt
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sightline.providers.contract import CanonicalRequest
from sightline.providers.dataforseo.serp import ENDPOINT, SERP_ORGANIC, SerpOrganicParams, task_body
from sightline.providers.dataforseo.tags import make_tag
from spikes.common import (
    INSTALLATION,
    Budget,
    Live,
    Sent,
    arguments,
    capture,
    each_costs,
    fetch_all,
    first_result,
    live,
    median,
    read_keywords,
    run,
    say,
    submit_all,
    task_cost,
    wait_ready,
    worst_case,
    write_report,
)

KEYWORDS = 100
DEPTHS = (10, 100)
WITHOUT_OVERVIEW = "serp/google/organic#without-async-overview"


def _without_async_overview(request: CanonicalRequest, tag: str) -> dict[str, object]:
    return {**task_body(request, tag), "load_async_ai_overview": False}


ENDPOINTS = {
    SERP_ORGANIC: ENDPOINT,
    WITHOUT_OVERVIEW: replace(ENDPOINT, build=_without_async_overview),
}


def _scrub_account(body: Any) -> Any:
    """`user_data` describes the account: its login and its money are replaced by stand-ins,
    so the fixture keeps the shape and says nothing of the account."""
    for task in body.get("tasks") or []:
        for result in task.get("result") or []:
            if not isinstance(result, dict):
                continue
            if "login" in result:
                result["login"] = "owner@example.com"
            if "money" in result:
                result["money"] = _stand_in(result["money"])
    return body


def _stand_in(value: Any) -> Any:
    """The same structure, with every number replaced by 1."""
    if isinstance(value, dict):
        return {key: _stand_in(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stand_in(item) for item in value]
    if isinstance(value, int | float) and not isinstance(value, bool):
        return 1
    return value


def _only_this_run(body: Any) -> Any:
    """`tasks_ready` lists every finished task of the account: only this run's are kept."""
    for task in body.get("tasks") or []:
        result = [
            item
            for item in task.get("result") or []
            if isinstance(item, dict) and str(item.get("tag", "")).startswith(f"i:{INSTALLATION}:")
        ]
        task["result"] = result
        task["result_count"] = len(result)
    return body


# When the list of posted tasks is read after the last post: how soon it lists them decides
# how long the resolver must wait (`UNKNOWN_GRACE`, 15 minutes).
LIST_AFTER = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=15))


async def _list_lag(api: Live, sent: list[Sent], since: datetime) -> list[str]:
    """How many sent tasks `id_list` lists at each checkpoint, and how far its posting time is
    from the time we sent them (the clock offset the resolver's window allows for)."""
    lines = [
        "| After the last post | Listed | Posted minus sent, median (s) | Largest (s) |",
        "|---|---|---|---|",
    ]
    last = max(task.posted_at for task in sent if task.posted_at is not None)
    ours = {task.provider_task_id: task for task in sent if task.provider_task_id}
    for after in LIST_AFTER:
        wait = (last + after - datetime.now(UTC)).total_seconds()
        if wait > 0:
            await asyncio.sleep(wait)
        listed = await api.provider.find_submitted(SERP_ORGANIC, since, datetime.now(UTC))
        gaps = [
            (entry.posted_at - posted).total_seconds()
            for entry in listed
            if entry.provider_task_id in ours
            and entry.posted_at is not None
            and (posted := ours[entry.provider_task_id].posted_at) is not None
        ]
        found = sum(1 for entry in listed if entry.provider_task_id in ours)
        lines.append(
            f"| {after} | {found} of {len(ours)} | {median(gaps):.0f} | "
            f"{max(gaps, default=float('nan')):.0f} |"
        )
    return lines


async def main() -> None:
    options = arguments(__doc__ or "S-01", keywords=KEYWORDS)
    budget = Budget(cap=options.cap)
    keywords = read_keywords(options.keywords, KEYWORDS)
    variants: dict[tuple[int, bool], list[Sent]] = {}
    number = 0
    for depth in DEPTHS:
        for overview in (True, False):
            tasks = []
            for keyword in keywords:
                number += 1
                params = SerpOrganicParams(
                    keyword=keyword, location_code=2840, language_code="en", depth=depth
                )
                tasks.append(Sent(number=number, label=f"{depth}/{overview}", params=params))
            variants[(depth, overview)] = tasks
    budget.allow(
        sum(
            (
                worst_case(depth, async_overview=overview) * len(tasks)
                for (depth, overview), tasks in variants.items()
            ),
            Decimal(0),
        )
    )

    async with live(ENDPOINTS) as api:
        answer = await api.client.call("GET", "/v3/appendix/user_data", family="user_data")
        capture("user_data", answer.content, scrub=_scrub_account)
        started = datetime.now(UTC) - timedelta(minutes=1)
        captured = await _capture_one_post(api, keywords[0], budget)
        for (depth, overview), tasks in variants.items():
            endpoint = SERP_ORGANIC if overview else WITHOUT_OVERVIEW
            say(f"sending {len(tasks)} tasks at depth {depth}, async overview {overview}")
            await submit_all(
                api.provider,
                endpoint,
                tasks,
                budget,
                each_costs(depth, async_overview=overview),
            )
        every = [task for tasks in variants.values() for task in tasks]
        lag = await _list_lag(api, every, started)
        # The captured task is waited for and collected with the rest, so it leaves the
        # account's `tasks_ready` list; it is not counted in the results.
        echoed = await wait_ready(api.provider, SERP_ORGANIC, [captured, *every])
        echoed.pop(str(captured.provider_task_id), None)
        listed = await api.provider.find_submitted(SERP_ORGANIC, started, datetime.now(UTC))
        ready_answer = await api.client.call(
            "GET", "/v3/serp/google/organic/tasks_ready", family="tasks_ready"
        )
        capture("tasks_ready", ready_answer.content, scrub=_only_this_run)
        await fetch_all(api.provider, SERP_ORGANIC, [captured, *every])

    for task in every:
        if task.result is not None and task.result.body is not None:
            capture("task_get_advanced", task.result.body)
            break
    by_tag = {entry.provider_task_id: entry for entry in listed}
    sections = [
        "## Cost by variant",
        "",
        "| Depth | Async AI Overview | Tasks | Cost at submission (each) | Cost in result (each) |",
        "|---|---|---|---|---|",
    ]
    for (depth, overview), tasks in variants.items():
        submitted = sorted({task.submit_cost for task in tasks if task.submit_cost is not None})
        in_result = sorted({cost for task in tasks if (cost := task_cost(task.body)) is not None})
        at_submission = ", ".join(map(str, submitted)) or "none"
        in_results = ", ".join(map(str, in_result)) or "none"
        sections.append(
            f"| {depth} | {'yes' if overview else 'no'} | {len(tasks)} | "
            f"{at_submission} | {in_results} |"
        )
    async_present: dict[str, int] = defaultdict(int)
    for task in every:
        for item in first_result(task.body).get("items") or []:
            if item.get("type") == "ai_overview":
                async_present[task.label] += 1
                break
    sent = [task for task in every if task.provider_task_id]
    tag_in_list = [task for task in sent if task.provider_task_id in by_tag]
    tag_matched = [
        task
        for task in tag_in_list
        if by_tag[str(task.provider_task_id)].echo.task_id == str(task.number)
    ]
    sections += [
        "",
        "## Tags",
        "",
        f"- `tasks_ready` listed {len(echoed)} of {len(sent)} sent tasks; "
        f"{sum(echoed.values())} echoed the tag they were sent with.",
        f"- `id_list` listed {len(tag_in_list)} of {len(sent)}; {len(tag_matched)} with the tag "
        "under `metadata.tag`. The resolver (`RESOLVE_UNKNOWN_SUBMISSIONS`) may be turned on only "
        "if every one did.",
        "",
        "## How soon `id_list` lists a posted task",
        "",
        *lag,
        "",
        "The resolver looks from a minute before a submission to 15 minutes after it. Turn it on "
        "only if every task was listed at 5 minutes, and posted minus sent stayed inside minus "
        "60 and plus 420 seconds (the handler's 8 minute limit leaves 7 minutes of margin).",
        "",
        "## AI Overview present, by variant",
        "",
        *[f"- {label}: {count}" for label, count in sorted(async_present.items())],
        "",
        "## Notes",
        "",
        *[f"- task {task.number} ({task.label}): {note}" for task in every for note in task.notes],
        "",
        "Fixtures captured in `backend/tests/fixtures/dataforseo/captured/`. Compare the costs "
        "above with doc 06 section 6.2: additive (one base price more) or multiplier (twice).",
    ]
    path = write_report("S-01", "SERP billing and tag echo", budget, sections)
    say(f"report: {path}")
    if budget.spent > budget.cap:
        say(f"warning: spent ${budget.spent}, over the cap")


async def _capture_one_post(api: Live, keyword: str, budget: Budget) -> Sent:
    """One task sent through the client itself, so its answer is kept as it came. Returned so
    it is waited for and collected with the others."""
    estimate = worst_case(10, async_overview=True)
    budget.allow(estimate)
    params = SerpOrganicParams(keyword=keyword, location_code=2840, language_code="en", depth=10)
    request = CanonicalRequest(
        task_id="1", run_id=uuid.uuid4(), attempt=1, priority="standard", params=params
    )
    tag = make_tag(INSTALLATION, 1, 1, request.run_id)
    answer = await api.client.call(
        "POST",
        "/v3/serp/google/organic/task_post",
        sending=True,
        body=[task_body(request, tag)],
    )
    budget.charge(task_cost(json.loads(answer.content)), fallback=estimate)
    capture("task_post", answer.content)
    first = answer.tasks[0] if answer.tasks else None
    return Sent(
        number=1,
        label="captured",
        params=params,
        provider_task_id=None if first is None else first.id,
        posted_at=datetime.now(UTC),
    )


if __name__ == "__main__":
    run(main)
