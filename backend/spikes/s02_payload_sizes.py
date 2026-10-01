"""S-02: how large advanced SERP answers are, and how well they compress (docs/01 section 12).

100 keywords at depth 10, 20 and 100, desktop and mobile. Records each answer's size as
received and compressed with zstd at levels 3, 6 (what storage uses) and 19.

    uv run python -m spikes.s02_payload_sizes --cap 5 --keywords keywords.txt
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

import zstandard

from sightline.providers.dataforseo.serp import SERP_ORGANIC, SerpOrganicParams
from spikes.common import (
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

KEYWORDS = 100
DEPTHS = (10, 20, 100)
DEVICES: tuple[Literal["desktop", "mobile"], ...] = ("desktop", "mobile")
LEVELS = (3, 6, 19)


async def main() -> None:
    options = arguments(__doc__ or "S-02", keywords=KEYWORDS)
    budget = Budget(cap=options.cap)
    keywords = read_keywords(options.keywords, KEYWORDS)
    sent: list[Sent] = []
    for depth in DEPTHS:
        for device in DEVICES:
            for keyword in keywords:
                params = SerpOrganicParams(
                    keyword=keyword,
                    location_code=2840,
                    language_code="en",
                    device=device,
                    depth=depth,
                )
                sent.append(Sent(number=len(sent) + 1, label=f"{depth}/{device}", params=params))
    budget.allow(sum((worst_case(_depth(task), async_overview=True) for task in sent), Decimal(0)))

    async with live() as api:
        await submit_all(
            api.provider,
            SERP_ORGANIC,
            sent,
            budget,
            lambda task: worst_case(_depth(task), async_overview=True),
        )
        await wait_ready(api.provider, SERP_ORGANIC, sent)
        await fetch_all(api.provider, SERP_ORGANIC, sent)

    compressors = {level: zstandard.ZstdCompressor(level=level) for level in LEVELS}
    sections = [
        "## Bytes per answer",
        "",
        "| Depth | Device | Answers | Raw median | Raw p95 | "
        + " | ".join(f"zstd {level} median | zstd {level} p95" for level in LEVELS)
        + " |",
        "|---|---|---|---|---|" + "---|---|" * len(LEVELS),
    ]
    for depth in DEPTHS:
        for device in DEVICES:
            bodies = [
                task.result.body
                for task in sent
                if task.label == f"{depth}/{device}"
                and task.result is not None
                and task.result.body is not None
            ]
            raw = [float(len(body)) for body in bodies]
            cells = [f"{median(raw):.0f}", f"{percentile(raw, 0.95):.0f}"]
            for level in LEVELS:
                packed = [float(len(compressors[level].compress(body))) for body in bodies]
                cells += [f"{median(packed):.0f}", f"{percentile(packed, 0.95):.0f}"]
            sections.append(f"| {depth} | {device} | {len(bodies)} | " + " | ".join(cells) + " |")
    sections += [
        "",
        "Doc 28's storage projection assumes 30 to 60 KB per depth 100 answer after zstd 6 (DM-2): "
        "confirm it or revise the projection with the medians above.",
    ]
    path = write_report("S-02", "Payload sizes and compression", budget, sections)
    say(f"report: {path}")


def _depth(task: Sent) -> int:
    if not isinstance(task.params, SerpOrganicParams):
        raise TypeError("this run sends SERP tasks only")
    return task.params.depth


if __name__ == "__main__":
    run(main)
