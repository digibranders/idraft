"""S-15: how long a standard SERP task takes, by hour of day in UTC (docs/06 section 11).

One run sends a small batch (20 tasks at depth 10) and records, for each task, the time from
submission until `tasks_ready` lists it. Each run adds its rows to `docs/spikes/S-15.csv` and
rewrites the report from every row so far. Run it once an hour for a day, for example from cron:

    0 * * * * cd backend && uv run python -m spikes.s15_turnaround --cap 0.05 --keywords k.txt
"""

from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime

from sightline.providers.dataforseo.serp import SERP_ORGANIC, SerpOrganicParams
from spikes.common import (
    REPORTS,
    Budget,
    Sent,
    arguments,
    fetch_all,
    live,
    median,
    percentile,
    read_keywords,
    run,
    say,
    submit_all,
    wait_ready,
    worst_case,
    write_report,
)

TASKS = 20
LOG = REPORTS / "S-15.csv"


async def main() -> None:
    options = arguments(__doc__ or "S-15", keywords=TASKS)
    budget = Budget(cap=options.cap)
    keywords = read_keywords(options.keywords, TASKS)
    sent = [
        Sent(
            number=index + 1,
            label="turnaround",
            params=SerpOrganicParams(
                keyword=keyword, location_code=2840, language_code="en", depth=10
            ),
        )
        for index, keyword in enumerate(keywords)
    ]
    budget.allow(worst_case(10, async_overview=True) * TASKS)
    async with live() as api:
        await submit_all(
            api.provider, SERP_ORGANIC, sent, budget, lambda _: worst_case(10, async_overview=True)
        )
        await wait_ready(api.provider, SERP_ORGANIC, sent)
        # Collected, which is free, so they leave the account's `tasks_ready` list: it holds at
        # most 1,000 ids a call, and production reads it too.
        await fetch_all(api.provider, SERP_ORGANIC, sent)

    REPORTS.mkdir(parents=True, exist_ok=True)
    new = not LOG.exists()
    with LOG.open("a", newline="") as log:
        writer = csv.writer(log)
        if new:
            writer.writerow(["posted_at", "hour_utc", "seconds_to_ready"])
        for task in sent:
            if task.posted_at is None:
                continue
            waited = (
                ""
                if task.ready_at is None
                else f"{(task.ready_at - task.posted_at).total_seconds():.0f}"
            )
            writer.writerow([task.posted_at.isoformat(), task.posted_at.hour, waited])

    by_hour: dict[int, list[float]] = defaultdict(list)
    never: dict[int, int] = defaultdict(int)
    with LOG.open(newline="") as log:
        for row in csv.DictReader(log):
            hour = datetime.fromisoformat(row["posted_at"]).hour
            if row["seconds_to_ready"]:
                by_hour[hour].append(float(row["seconds_to_ready"]))
            else:
                never[hour] += 1
    sections = [
        "## Minutes from submission to ready, by hour of submission (UTC)",
        "",
        "| Hour | Tasks | p50 | p95 | Not ready within 2 hours |",
        "|---|---|---|---|---|",
    ]
    for hour in sorted(set(by_hour) | set(never)):
        waits = by_hour[hour]
        sections.append(
            f"| {hour:02d} | {len(waits) + never[hour]} | {median(waits) / 60:.1f} | "
            f"{percentile(waits, 0.95) / 60:.1f} | {never[hour]} |"
        )
    sections += [
        "",
        f"Rows in `{LOG.name}`. Doc 21 sizes collection windows from these figures.",
    ]
    path = write_report("S-15", "Standard queue turnaround by hour", budget, sections)
    say(f"report: {path}")


if __name__ == "__main__":
    run(main)
