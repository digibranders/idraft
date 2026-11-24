"""S-23: DataForSEO against cloro on 20 keywords the app tracks, at depth 75.

The keywords are the Eventus Security project's own (read from the live database, desktop, India
2356, 2026-11-23): 10 of the 28 in the group "Providers and vendors" and 10 of the 21 in "Service,
pricing and technology", spread evenly through each group's alphabetical list. Every keyword is sent
twice to each provider. DataForSEO reads depth 75; cloro reads 8 pages (80 results), cut to 75.

    uv run --env-file .env python -m spikes.s23_app_keywords_depth75 dfs --raw-dir /tmp/s23
    CLORO_API_KEY=... uv run python -m spikes.s23_app_keywords_depth75 cloro --raw-dir /tmp/s23
    uv run python -m spikes.s23_app_keywords_depth75 analyze --raw-dir /tmp/s23
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
    jaccard,
    load,
    page,
)

DEPTH: Final = 75
PAGES: Final = 8  # cloro: 10 results a page, so 8 pages cover 75
SITE: Final = "eventussecurity.com"
FIRST_INDEX: Final = 200
GROUPS: Final = {
    "Providers and vendors": [
        "best managed security service provider",
        "managed security service provider",
        "managed soc provider",
        "managed soc service provider",
        "soc as a service companies",
        "soc as a service providers",
        "soc managed service providers",
        "soc providers",
        "soc service providers",
        "socaas provider",
    ],
    "Service, pricing and technology": [
        "24/7 managed soc",
        "ai driven soc",
        "fully managed soc",
        "managed soc as a service",
        "managed soc service",
        "security operations center as a service",
        "soc as a service pricing",
        "soc as service",
        "soc security services",
        "soc service organization",
    ],
}


# Search Console, sc-domain:eventussecurity.com, 2026-10-24 to 2026-11-20, country IND, device
# DESKTOP: average position of the site. An average over many searches, so a few places of noise.
SEARCH_CONSOLE: Final = {
    "best managed security service provider": 18.3,
    "managed security service provider": 17.3,
    "managed soc provider": 13.4,
    "managed soc service provider": 9.5,
    "soc as a service companies": 23.4,
    "soc as a service providers": 43.1,
    "soc managed service providers": 11.9,
    "soc providers": 20.5,
    "soc service providers": 31.3,
    "socaas provider": 17.3,
    "24/7 managed soc": 3.7,
    "ai driven soc": 32.1,
    "fully managed soc": 74.5,
    "managed soc as a service": 21.4,
    "managed soc service": 27.5,
    "security operations center as a service": 70.5,
    "soc as a service pricing": 34.7,
    "soc as service": 41.7,
    "soc security services": 68.2,
    "soc service organization": 89.9,
}


def items() -> list[Item]:
    keywords = [(group, text) for group, texts in GROUPS.items() for text in texts]
    return [
        Item(
            f"google|p{FIRST_INDEX + n:03d}|r{repeat}",
            "google",
            FIRST_INDEX + n,
            repeat,
            text,
            "IN",
        )
        for n, (_, text) in enumerate(keywords)
        for repeat in (1, 2)
    ]


def group_of(text: str) -> str:
    return next(g for g, texts in GROUPS.items() if text in texts)


def organic(answer: Answer) -> list[str]:
    return answer.organic[:DEPTH]


def place(answer: Answer) -> int | None:
    for n, url in enumerate(organic(answer), start=1):
        if host(url).endswith(SITE):
            return n
    return None


def _mean(values: list[float]) -> str:
    return f"{statistics.fmean(values):.2f}" if values else "n/a"


def analyze(raw_dir: Path) -> None:
    answers = [a for a in load(raw_dir) if a.ok]
    by = {(a.provider, a.item.text, a.item.repeat): a for a in answers}
    texts = [t for ts in GROUPS.values() for t in ts]
    lines = [
        "| Group | Keyword | Search Console | DataForSEO run 1 / 2 | cloro run 1 / 2 |",
        "|---|---|---|---|---|",
    ]
    for text in texts:
        cells = []
        for provider in ("dfs", "cloro"):
            cells.append(
                " / ".join(
                    str(place(by[(provider, text, r)]))
                    if (provider, text, r) in by and place(by[(provider, text, r)])
                    else "-"
                    for r in (1, 2)
                )
            )
        lines.append(
            f"| {group_of(text)} | {text} | {SEARCH_CONSOLE[text]:.1f} | {cells[0]} | {cells[1]} |"
        )
    lines += [
        "",
        "Place of eventussecurity.com among the organic results (- = not in the first 75).",
        "",
    ]
    for provider, label in (("dfs", "DataForSEO"), ("cloro", "cloro")):
        sizes = [len(organic(a)) for a in answers if a.provider == provider]
        found = [place(a) for a in answers if a.provider == provider]
        lines.append(
            f"- {label}: {len(sizes)} answers, median {statistics.median(sizes or [0]):.0f} "
            f"organic results returned, site found in {sum(1 for f in found if f)} of "
            f"{len(found)}"
        )
    for provider, label in (("dfs", "DataForSEO"), ("cloro", "cloro")):
        errors = []
        for text, truth in SEARCH_CONSOLE.items():
            for r in (1, 2):
                a = by.get((provider, text, r))
                if a and (found_at := place(a)) and truth <= DEPTH:
                    errors.append(abs(found_at - truth))
        lines.append(
            f"- {label} against Search Console: {len(errors)} of {len(SEARCH_CONSOLE) * 2} runs "
            f"found the site within 75 and have a Search Console position; median distance "
            f"{statistics.median(errors or [0]):.1f} places, within 5 places on "
            f"{sum(1 for e in errors if e <= 5)}"
        )
    for label, size in (("top 10", 10), ("top 75", DEPTH)):
        cross_pages: list[float] = []
        cross_hosts: list[float] = []
        dfs_self: list[float] = []
        cloro_self: list[float] = []
        for text in texts:
            for r in (1, 2):
                d, c = by.get(("dfs", text, r)), by.get(("cloro", text, r))
                if d and c:
                    cross_pages.append(
                        jaccard(
                            {page(u) for u in d.organic[:size]}, {page(u) for u in c.organic[:size]}
                        )
                        or 0.0
                    )
                    cross_hosts.append(
                        jaccard(
                            {host(u) for u in d.organic[:size]}, {host(u) for u in c.organic[:size]}
                        )
                        or 0.0
                    )
            for provider, bucket in (("dfs", dfs_self), ("cloro", cloro_self)):
                a, b = by.get((provider, text, 1)), by.get((provider, text, 2))
                if a and b:
                    bucket.append(
                        jaccard(
                            {page(u) for u in a.organic[:size]}, {page(u) for u in b.organic[:size]}
                        )
                        or 0.0
                    )
        lines.append(
            f"- {label}: pages in common between providers {_mean(cross_pages)}, domains "
            f"{_mean(cross_hosts)}; a provider against itself: DataForSEO {_mean(dfs_self)}, "
            f"cloro {_mean(cloro_self)}"
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
                Decimal("2"),
                items=items(),
                depth=DEPTH,
                resolve=options.resolve,
                priority=options.priority,
            )
        )
    else:
        asyncio.run(collect_cloro(options.raw_dir, 1200, 45, only=items(), pages=PAGES))


if __name__ == "__main__":
    main()
