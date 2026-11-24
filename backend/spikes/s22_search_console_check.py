"""S-22: which provider's Google results match Search Console?

S-20 and S-21 found that DataForSEO and cloro return different Google top 10s for the same
India keywords. Search Console is the nearest thing to a ground truth for one site: the average
position of eventussecurity.com for a query, over 28 days, India, desktop. The 15 queries below are
the ones where the site ranks in the top 10 there. Each provider is asked each query twice; the
position of the site in its organic results is read and compared with Search Console.

    uv run --env-file .env python -m spikes.s22_search_console_check dfs --raw-dir /tmp/s22
    CLORO_API_KEY=... uv run python -m spikes.s22_search_console_check cloro --raw-dir /tmp/s22
    uv run python -m spikes.s22_search_console_check analyze --raw-dir /tmp/s22
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
from decimal import Decimal
from pathlib import Path
from typing import Final

from spikes.common import run, say
from spikes.s20_provider_ab import (
    Answer,
    Item,
    collect_cloro,
    collect_dfs,
    host,
    load,
)

SITE: Final = "eventussecurity.com"
# Search Console, sc-domain:eventussecurity.com, 2026-10-24 to 2026-11-20, country IND, device
# DESKTOP: average position of the site for the query.
SEARCH_CONSOLE: Final = {
    "eventus security": 1.04,
    "eventus": 1.06,
    "recent cyber attacks in india 2026": 3.03,
    "recent cyber attacks in india": 3.87,
    "cyber attacks in india": 3.53,
    "latest cyber attack in india": 5.0,
    "sample vapt report": 3.57,
    "vsoc": 3.62,
    "cyber attack in india": 4.70,
    "major cyber attacks in india": 9.69,
    "vapt report": 7.46,
    "ai driven soc as a service": 1.73,
    "sebi cscrf framework": 6.78,
    "vapt report sample": 4.23,
    "soc analyst full form": 2.22,
}
# The same queries read in a sandbox Chromium on 2026-11-23 (google.com/search?q=...&gl=in&hl=en
# &pws=0, no CAPTCHA, no consent wall): place of the site among the organic links of the first
# page, None when it is not on it. The machine is not in India: `gl=in` sets the market only.
BROWSER: Final[dict[str, int | None]] = {
    "eventus security": 1,
    "eventus": 1,
    "recent cyber attacks in india 2026": 1,
    "recent cyber attacks in india": 1,
    "cyber attacks in india": 1,
    "latest cyber attack in india": 1,
    "sample vapt report": 2,
    "vsoc": 3,
    "cyber attack in india": 1,
    "major cyber attacks in india": 1,
    "vapt report": None,
    "ai driven soc as a service": 1,
    "sebi cscrf framework": 5,
    "vapt report sample": 2,
    "soc analyst full form": None,
}
FIRST_INDEX: Final = 100


def items() -> list[Item]:
    return [
        Item(
            f"google|p{FIRST_INDEX + n:03d}|r{repeat}",
            "google",
            FIRST_INDEX + n,
            repeat,
            query,
            "IN",
        )
        for n, query in enumerate(SEARCH_CONSOLE)
        for repeat in (1, 2)
    ]


def position(answer: Answer) -> int | None:
    """1-based place of the site among the organic results, or None when it is not there."""
    for place, url in enumerate(answer.organic, start=1):
        if host(url).endswith(SITE):
            return place
    return None


def analyze(raw_dir: Path) -> None:
    answers = [a for a in load(raw_dir) if a.ok]
    rows: list[str] = []
    stats: dict[str, dict[str, list[float]]] = {
        p: {"error": [], "found": [], "within2": [], "stable": [], "browser": []}
        for p in ("dfs", "cloro")
    }
    for query, truth in SEARCH_CONSOLE.items():
        cells: list[str] = []
        for provider in ("dfs", "cloro"):
            places = []
            for repeat in (1, 2):
                match = [
                    a
                    for a in answers
                    if a.provider == provider and a.item.text == query and a.item.repeat == repeat
                ]
                place = position(match[0]) if match else None
                places.append(place)
                stats[provider]["browser"].append(1.0 if place == BROWSER[query] else 0.0)
                stats[provider]["found"].append(1.0 if place else 0.0)
                if place:
                    stats[provider]["error"].append(abs(place - truth))
                    stats[provider]["within2"].append(1.0 if abs(place - truth) <= 2 else 0.0)
                else:
                    stats[provider]["within2"].append(0.0)
            stats[provider]["stable"].append(1.0 if places[0] == places[1] else 0.0)
            cells.append(" / ".join(str(p) if p else "-" for p in places))
        seen = BROWSER[query]
        rows.append(f"| {query} | {truth:.1f} | {seen or '-'} | {cells[0]} | {cells[1]} |")
    lines = [
        "| Query | Search Console | Real browser | DataForSEO (run 1 / 2) | cloro (run 1 / 2) |",
        "|---|---|---|---|---|",
        *rows,
        "",
    ]
    for provider, label in (("dfs", "DataForSEO"), ("cloro", "cloro")):
        s = stats[provider]
        err = statistics.fmean(s["error"]) if s["error"] else float("nan")
        lines.append(
            f"- {label}: site found in the top 10 on {sum(s['found']):.0f} of {len(s['found'])} "
            f"runs; mean distance from Search Console {err:.1f} places; within 2 places on "
            f"{sum(s['within2']):.0f} of {len(s['within2'])}; same place on both runs for "
            f"{sum(s['stable']):.0f} of {len(s['stable'])} queries; same place as the real "
            f"browser on {sum(s['browser']):.0f} of {len(s['browser'])} runs"
        )
    say("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("dfs", "cloro", "analyze"):
        command = sub.add_parser(name)
        command.add_argument("--raw-dir", type=Path, required=True)
        command.add_argument(
            "--resolve", action="store_true", help="DataForSEO resolve_poisoned_results"
        )
        command.add_argument("--priority", action="store_true", help="DataForSEO priority queue")
    options = parser.parse_args()
    if options.command == "analyze":
        analyze(options.raw_dir)
    elif options.command == "dfs":
        run(
            lambda: collect_dfs(
                options.raw_dir,
                Decimal("1"),
                items=items(),
                resolve=options.resolve,
                priority=options.priority,
            )
        )
    else:
        asyncio.run(collect_cloro(options.raw_dir, 200, 30, only=items()))


if __name__ == "__main__":
    main()
