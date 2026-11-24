"""S-20: DataForSEO against cloro on the same prompts and keywords.

50 Eventus prompts (docs/ops/eventus-ai-prompts.csv, picked evenly across topics and countries)
go to ChatGPT, Gemini and Google AI Mode on both providers; 50 keywords (spikes/s20_keywords.csv)
go to Google Search with the AI Overview on both. Every fifth prompt and keyword is sent twice to
each provider: how far two runs of the SAME provider differ is the floor the two providers must be
compared against, since neither has a ground truth.

DataForSEO runs the standard queue, the way the product collects. cloro runs its async API.
ChatGPT is asked with web search forced on both (cloro cannot turn it off by default); DataForSEO
also gets the natural variant, which is what the product uses today.

    # DataForSEO, everything (about $0.35):
    uv run python -m spikes.s20_provider_ab dfs --cap 1 --raw-dir /tmp/s20
    # cloro, in priority order, stopping at the credit cap (CLORO_API_KEY in the environment):
    uv run python -m spikes.s20_provider_ab cloro --max-credits 460 --raw-dir /tmp/s20
    # the report, spending nothing:
    uv run python -m spikes.s20_provider_ab analyze --raw-dir /tmp/s20

`cloro` can be run again with a higher cap: finished tasks are kept, only the rest is sent.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import math
import os
import re
import statistics
import time
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, Literal
from urllib.parse import urlsplit

import httpx

from idraft.providers.contract import CanonicalRequest
from idraft.providers.dataforseo.endpoint import TaskBuilder
from idraft.providers.dataforseo.serp import ENDPOINT, SERP_ORGANIC, SerpOrganicParams, task_body
from spikes import common
from spikes.common import (
    REPOSITORY,
    Budget,
    Sent,
    fetch_all,
    first_result,
    live,
    median,
    percentile,
    run,
    say,
    submit_all,
    task_cost,
    wait_ready,
    write_report,
)
from spikes.s04_ai_engines import ENDPOINTS as AI_ENDPOINTS
from spikes.s04_ai_engines import AiParams

Engine = Literal["chatgpt", "gemini", "ai_mode", "google"]
ENGINES: Final[tuple[Engine, ...]] = ("chatgpt", "gemini", "ai_mode", "google")
PROMPTS_CSV: Final = REPOSITORY / "docs" / "ops" / "eventus-ai-prompts.csv"
KEYWORDS_CSV: Final = Path(__file__).with_name("s20_keywords.csv")

PROMPT_QUOTA: Final = {"IN": 36, "AE": 4, "SA": 4, "US": 4, "SG": 2}
LOCATION: Final = {"IN": 2356, "AE": 2784, "SA": 2682, "SG": 2702, "US": 2840}
# Every fifth item is sent twice to each provider (the floor of run-to-run variation).
REPEAT_EVERY: Final = 5
# The items of the first cloro stage: this many first runs, then their repeats, then the rest.
STAGE_ONE_PRIMARY: Final = 19

CLORO_BASE: Final = "https://api.cloro.dev"
CLORO_TYPE: Final[dict[Engine, str]] = {
    "chatgpt": "CHATGPT",
    "gemini": "GEMINI",
    "ai_mode": "AIMODE",
    "google": "GOOGLE",
}
# Credits of one async task (cloro's providers guide): ChatGPT 5 + 2 for the fan-out queries,
# Gemini 4, AI Mode 4, Google Search 3 + 2 for the AI Overview.
CLORO_CREDITS: Final[dict[Engine, int]] = {"chatgpt": 7, "gemini": 4, "ai_mode": 4, "google": 5}
# Dollars per credit on the Lite plan; the report also shows Hobby and Growth.
CREDIT_PRICES: Final = {"Lite": 0.0008, "Hobby": 0.0004, "Growth": 0.00037}
DFS_PRICE: Final = Decimal("0.0012")
POLL_SECONDS: Final = 10
TERMINAL: Final = {"COMPLETED", "FAILED"}

# Brands read out of the answers: the tracked one first, then the vendors that come up.
VENDORS: Final = [
    "Eventus",
    "Tata Communications",
    "Wipro",
    "Infosys",
    "HCL",
    "Tech Mahindra",
    "Quick Heal",
    "Seqrite",
    "Paladion",
    "Atos",
    "IBM",
    "Accenture",
    "Deloitte",
    "KPMG",
    "PwC",
    "EY",
    "CrowdStrike",
    "Palo Alto",
    "Microsoft",
    "Secureworks",
    "Sophos",
    "Cisco",
    "Cyble",
    "Airtel",
    "Reliance Jio",
    "Kaspersky",
    "Trend Micro",
    "Fortinet",
    "SOCRadar",
    "Mandiant",
    "Trellix",
    "Darktrace",
    "Rapid7",
    "Splunk",
    "ManageEngine",
    "Zscaler",
    "NTT",
    "Orange Cyberdefense",
    "Help AG",
    "Kroll",
    "Tenable",
    "Qualys",
    "Check Point",
    "Thales",
    "Sify",
    "Cyfirma",
    "Kratikal",
    "Redfox",
    "Lucideus",
    "Netmagic",
    "Sysdig",
    "Google",
]


@dataclass(frozen=True)
class Item:
    """One thing asked of both providers."""

    key: str  # e.g. "chatgpt|p007|r1"
    engine: Engine
    index: int
    repeat: int  # 1 first run, 2 the second run of the floor
    text: str
    country: str

    @property
    def group(self) -> str:
        return "A India" if self.country == "IN" else "B abroad (AE, SA, SG, US)"

    @property
    def stage(self) -> int:
        """1 for what the first, small cloro run covers; 2 for the rest."""
        picked = self.index < STAGE_ONE_PRIMARY and self.repeat == 1
        repeated = self.index < STAGE_ONE_PRIMARY and self.repeat == 2
        return 1 if picked or repeated else 2


def pick_prompts(path: Path = PROMPTS_CSV) -> list[tuple[str, str]]:
    """50 (country, prompt): the quota for each country, taken round-robin over its topics."""
    rows = list(csv.DictReader(path.read_text().splitlines()))
    chosen: list[tuple[str, str]] = []
    for country, quota in PROMPT_QUOTA.items():
        topics: dict[str, list[str]] = {}
        for row in rows:
            if row["country"] == country:
                topics.setdefault(row["topic"], []).append(row["prompt"])
        queues = list(topics.values())
        taken: list[str] = []
        while len(taken) < quota and any(queues):
            for queue in queues:
                if queue and len(taken) < quota:
                    taken.append(queue.pop(0))
        if len(taken) < quota:
            raise SystemExit(f"{path} has too few {country} prompts: {len(taken)} of {quota}")
        chosen += [(country, prompt) for prompt in taken]
    return chosen


def read_keywords(path: Path = KEYWORDS_CSV) -> list[tuple[str, str]]:
    return [
        (row["country"], row["keyword"]) for row in csv.DictReader(path.read_text().splitlines())
    ]


# The fresh run: 10 prompts and 10 keywords of India that cloro has not seen (positions 20 to 29)
# and 10 of each for the other markets (the last positions of both lists). Positions 20, 25, 40
# and 45 are the ones sent twice.
FRESH_PROMPTS: Final = {*range(20, 30), 36, 37, 38, 40, 41, 42, 44, 45, 48, 49}
FRESH_KEYWORDS: Final = {*range(20, 30), *range(40, 50)}


def all_items(fresh: bool = False) -> list[Item]:
    prompts, keywords = pick_prompts(), read_keywords()
    items = _every_item(prompts, keywords)
    if not fresh:
        return items
    return [
        i for i in items if i.index in (FRESH_KEYWORDS if i.engine == "google" else FRESH_PROMPTS)
    ]


def _every_item(prompts: list[tuple[str, str]], keywords: list[tuple[str, str]]) -> list[Item]:
    items: list[Item] = []
    for index, (country, text) in enumerate(prompts):
        for repeat in (1, 2) if index % REPEAT_EVERY == 0 else (1,):
            for engine in ("chatgpt", "gemini", "ai_mode"):
                items.append(
                    Item(f"{engine}|p{index:03d}|r{repeat}", engine, index, repeat, text, country)
                )
    for index, (country, text) in enumerate(keywords):
        for repeat in (1, 2) if index % REPEAT_EVERY == 0 else (1,):
            items.append(
                Item(f"google|p{index:03d}|r{repeat}", "google", index, repeat, text, country)
            )
    return items


def priority_order(items: Iterable[Item]) -> list[Item]:
    """Stage one first, each stage by position in the list, so a cap cuts the end, not a kind."""
    return sorted(items, key=lambda i: (i.stage, i.index, i.repeat, ENGINES.index(i.engine)))


# ----------------------------------------------------------------------------- DataForSEO


def dfs_series(item: Item) -> list[str]:
    if item.engine == "chatgpt":
        return ["chatgpt_forced", "chatgpt"] if item.repeat == 1 else ["chatgpt_forced"]
    return ["serp"] if item.engine == "google" else [item.engine]


def _dfs_params(
    series: str, item: Item, depth: int = 10, queue: Literal["standard", "priority"] = "standard"
) -> AiParams | SerpOrganicParams:
    location = LOCATION[item.country]
    if series == "serp":
        return SerpOrganicParams(
            keyword=item.text,
            location_code=location,
            language_code="en",
            depth=depth,
            queue=queue,
        )
    kind: Any = series
    return AiParams(series=kind, prompt=item.text, location_code=location, language_code="en")


@dataclass
class DfsJob:
    item: Item
    series: str
    sent: Sent


def dfs_jobs(
    items: Sequence[Item], depth: int = 10, queue: Literal["standard", "priority"] = "standard"
) -> list[DfsJob]:
    jobs: list[DfsJob] = []
    for item in items:
        for series in dfs_series(item):
            number = len(jobs) + 1
            sent = Sent(
                number=number,
                label=f"{series}|{item.key}",
                params=_dfs_params(series, item, depth, queue),
            )
            jobs.append(DfsJob(item, series, sent))
    return jobs


def _file(raw_dir: Path, provider: str, series: str, key: str) -> Path:
    return raw_dir / provider / f"{series}__{key.replace('|', '_')}.json"


def _prioritised(build: TaskBuilder) -> TaskBuilder:
    """An AI task body sent on the priority queue (DataForSEO `priority: 2`)."""

    def body(request: CanonicalRequest, tag: str) -> dict[str, object]:
        return {**build(request, tag), "priority": 2}

    return body


def _resolving_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    """The SERP task with DataForSEO's `resolve_poisoned_results` (2026-11-16): the organic
    results are checked against Google's Web mode and replaced when they were poisoned. It costs
    one more SERP unit a task."""
    return {**task_body(request, tag), "resolve_poisoned_results": True}


async def collect_dfs(
    raw_dir: Path,
    cap: Decimal,
    fresh: bool = False,
    items: Sequence[Item] | None = None,
    depth: int = 10,
    resolve: bool = False,
    priority: bool = False,
) -> None:
    jobs = dfs_jobs(
        all_items(fresh) if items is None else items, depth, "priority" if priority else "standard"
    )
    budget = Budget(cap=cap)
    # A SERP of `depth` results is ceil(depth / 10) units of $0.0006, doubled for the AI Overview.
    scale = 2 if priority else 1  # the priority queue costs twice the standard price
    serp_price = Decimal("0.0012") * math.ceil(depth / 10) * scale
    answer_price = DFS_PRICE * scale
    budget.allow(
        sum((serp_price if j.series == "serp" else answer_price for j in jobs), Decimal(0))
    )
    serp_endpoint = ENDPOINT
    if resolve:
        serp_endpoint = replace(ENDPOINT, build=_resolving_body)
    ai_endpoints = (
        {k: replace(v, build=_prioritised(v.build)) for k, v in AI_ENDPOINTS.items()}
        if priority
        else AI_ENDPOINTS
    )
    endpoints = {**ai_endpoints, SERP_ORGANIC: serp_endpoint}
    groups: dict[str, list[DfsJob]] = defaultdict(list)
    for job in jobs:
        groups["serp" if job.series == "serp" else job.series].append(job)

    def estimate(sent: Sent) -> Decimal:
        return serp_price if sent.label.startswith("serp|") else answer_price

    common.POLL_EVERY = timedelta(seconds=20)  # three groups at once stay under 12 calls a minute
    async with live(endpoints) as api:
        for series, group in groups.items():
            say(f"sending {len(group)} tasks: {series}")
            endpoint = SERP_ORGANIC if series == "serp" else series
            await submit_all(api.provider, endpoint, [j.sent for j in group], budget, estimate)
        waits = {
            "chatgpt": [j for j in jobs if j.series.startswith("chatgpt")],
            "gemini": [j for j in jobs if j.series == "gemini"],
            "ai_mode": [j for j in jobs if j.series == "ai_mode"],
            SERP_ORGANIC: [j for j in jobs if j.series == "serp"],
        }
        # Every group at once: waiting for them in turn would stamp the later ones as ready only
        # when the earlier ones finished.
        for endpoint, group in waits.items():
            say(f"waiting for {len(group)} tasks: {endpoint}")
        await asyncio.gather(
            *(
                wait_ready(api.provider, endpoint, [j.sent for j in group])
                for endpoint, group in waits.items()
            )
        )
        for series, group in groups.items():
            endpoint = SERP_ORGANIC if series == "serp" else series
            await fetch_all(api.provider, endpoint, [j.sent for j in group])
    for job in jobs:
        sent = job.sent
        record = {
            "provider": "dfs",
            "series": job.series,
            "item": _item_dict(job.item),
            "posted_at": sent.posted_at.isoformat() if sent.posted_at else None,
            "ready_at": sent.ready_at.isoformat() if sent.ready_at else None,
            "cost": str(task_cost(sent.body)) if task_cost(sent.body) is not None else None,
            "notes": sent.notes,
            "body": sent.body,
        }
        _write(_file(raw_dir, "dfs", job.series, job.item.key), record)
        budget.spent = sum((Decimal(str(task_cost(j.sent.body) or 0)) for j in jobs), Decimal(0))
    say(f"kept {len(jobs)} DataForSEO answers in {raw_dir / 'dfs'}; spent ${budget.spent}")


# ----------------------------------------------------------------------------- cloro


def credits_for(item: Item, pages: int = 1) -> int:
    """Credits of one task: Google is 3, +2 for the AI Overview, +2 per page after the first."""
    return CLORO_CREDITS[item.engine] + (2 * (pages - 1) if item.engine == "google" else 0)


def cloro_request(item: Item, pages: int = 1) -> dict[str, Any]:
    country = item.country
    if item.engine == "chatgpt":
        return {
            "prompt": item.text,
            "country": country,
            "include": {"markdown": True, "searchQueries": True},
        }
    if item.engine == "gemini":
        return {"prompt": item.text, "country": country, "include": {"markdown": True}}
    if item.engine == "ai_mode":
        return {"prompt": item.text, "country": country, "hl": "en", "include": {"markdown": True}}
    request: dict[str, Any] = {
        "query": item.text,
        "country": country,
        "hl": "en",
        "device": "desktop",
        "include": {"aioverview": {"markdown": True}},
    }
    if pages > 1:
        request["pages"] = pages
    return request


def _item_dict(item: Item) -> dict[str, Any]:
    return {
        "key": item.key,
        "engine": item.engine,
        "index": item.index,
        "repeat": item.repeat,
        "text": item.text,
        "country": item.country,
    }


def _write(path: Path, record: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=1, ensure_ascii=False, default=str))


def _read(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text())
    return data


async def _call(
    http: httpx.AsyncClient, method: str, path: str, body: dict[str, Any] | None = None
) -> httpx.Response:
    """One request, with the pauses a rate or concurrency 429 asks for (no Retry-After is sent)."""
    for attempt in range(6):
        response = await http.request(method, f"{CLORO_BASE}{path}", json=body)
        if response.status_code not in (429, 500, 502, 503):
            return response
        await asyncio.sleep(2**attempt)
    return response


def _error_code(response: httpx.Response) -> str:
    try:
        return str(response.json().get("error", {}).get("code", ""))
    except ValueError:
        return ""


async def collect_cloro(
    raw_dir: Path,
    max_credits: int,
    minutes: int,
    fresh: bool = False,
    only: Sequence[Item] | None = None,
    pages: int = 1,
) -> None:
    key = os.environ.get("CLORO_API_KEY", "").strip()
    if not key:
        raise SystemExit("CLORO_API_KEY must be set in the environment")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    items = priority_order(all_items(fresh) if only is None else only)
    records: dict[str, dict[str, Any]] = {}
    committed = 0
    for item in items:
        path = _file(raw_dir, "cloro", item.engine, item.key)
        if path.exists():
            records[item.key] = _read(path)
            committed += int(records[item.key].get("credits_to_charge") or credits_for(item, pages))
    say(f"{len(records)} tasks already kept, {committed} credits committed of {max_credits}")
    async with httpx.AsyncClient(headers=headers, timeout=90) as http:
        balance = (await _call(http, "GET", "/v1/credits")).json().get("remaining")
        say(f"balance reported by cloro: {balance} credits")
        stop = False
        for item in items:
            if item.key in records or stop:
                continue
            cost = credits_for(item, pages)
            if committed + cost > max_credits:
                continue
            body = {
                "taskType": CLORO_TYPE[item.engine],
                "priority": 5,
                "idempotencyKey": f"s20-{item.key}",
                "payload": cloro_request(item, pages),
            }
            response = await _call(http, "POST", "/v1/async/task", body)
            data = response.json()
            if response.status_code == 409:
                data = {"task": {"id": data["error"]["details"]["taskId"], "status": "QUEUED"}}
            elif response.status_code != 200:
                say(f"{item.key}: {response.status_code} {_error_code(response)}")
                stop = _error_code(response) == "INSUFFICIENT_CREDITS"
                continue
            task = data["task"]
            committed += cost
            records[item.key] = {
                "provider": "cloro",
                "series": item.engine,
                "item": _item_dict(item),
                "task_id": task["id"],
                "status": "QUEUED",
                "credits_to_charge": cost,
                "submitted_at": datetime.now(UTC).isoformat(),
            }
            _write(_file(raw_dir, "cloro", item.engine, item.key), records[item.key])
        say(f"submitted; {committed} credits committed; polling")
        deadline = time.monotonic() + minutes * 60
        while time.monotonic() < deadline:
            pending = [r for r in records.values() if r["status"] not in TERMINAL]
            if not pending:
                break
            for record in pending:
                response = await _call(http, "GET", f"/v1/async/task/{record['task_id']}")
                if response.status_code != 200:
                    continue
                data = response.json()
                task = data.get("task") or data
                status = str(task.get("status", "QUEUED"))
                if status in TERMINAL:
                    credits = data.get("credits") or {}
                    record.update(
                        status=status,
                        done_at=datetime.now(UTC).isoformat(),
                        latency_ms=task.get("latencyMs"),
                        credits_charged=credits.get("creditsCharged"),
                        response=data.get("response") or task.get("response"),
                        poll=data,  # the whole body, so a shape surprise is fixed offline
                    )
                    _write(_file(raw_dir, "cloro", record["series"], record["item"]["key"]), record)
            say(
                f"{len([r for r in records.values() if r['status'] not in TERMINAL])} tasks pending"
            )
            await asyncio.sleep(POLL_SECONDS)
    done = [r for r in records.values() if r["status"] == "COMPLETED"]
    charged = sum(int(r.get("credits_charged") or 0) for r in records.values())
    say(f"{len(done)} completed of {len(records)}; {charged} credits charged")


# ----------------------------------------------------------------------------- reading answers


@dataclass
class Answer:
    provider: str
    series: str
    item: Item
    ok: bool = False
    seconds: float | None = None  # waiting time, submit to ready
    provider_seconds: float | None = None  # cloro's own time on the task, queue wait excluded
    cost: float | None = None  # dollars (DataForSEO) or credits (cloro)
    text: str = ""
    urls: list[str] = field(default_factory=list)
    fan_out: list[str] = field(default_factory=list)
    entities: int = 0
    organic: list[str] = field(default_factory=list)
    aio: bool = False
    aio_urls: list[str] = field(default_factory=list)
    note: str = ""


def _item(data: Mapping[str, Any]) -> Item:
    return Item(**{k: data[k] for k in ("key", "engine", "index", "repeat", "text", "country")})


def _urls(entries: Any) -> list[str]:
    return [
        str(e.get("url") or e.get("link"))
        for e in (entries if isinstance(entries, list) else [])
        if isinstance(e, dict) and (e.get("url") or e.get("link"))
    ]


def _seconds(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    return (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()


def _real_url(item: Mapping[str, Any]) -> str:
    """The result's address. The priority queue returns Google redirect links (`google.com/goto`);
    the visible address is then in `breadcrumb`, which names the site but not always the page."""
    url = str(item["url"])
    if "google.com/goto" in url:
        match = re.match(
            r"https?://[^\s\N{SINGLE RIGHT-POINTING ANGLE QUOTATION MARK}]+",
            str(item.get("breadcrumb") or ""),
        )
        if match:
            return match.group(0)
    return url


def read_dfs(record: Mapping[str, Any]) -> Answer:
    item = _item(record["item"])
    answer = Answer(
        "dfs", record["series"], item, seconds=_seconds(record["posted_at"], record["ready_at"])
    )
    cost = None if record["cost"] is None else float(record["cost"])
    # The scrapers report no cost in `task_get` (it is billed at `task_post`): list price.
    answer.cost = float(DFS_PRICE) if not cost and record["series"] != "serp" else cost
    result = first_result(record["body"])
    items = [i for i in result.get("items") or [] if isinstance(i, dict)]
    if record["series"] == "serp":
        answer.organic = [
            _real_url(i) for i in items if i.get("type") == "organic" and i.get("url")
        ]
        overview = next((i for i in items if i.get("type") == "ai_overview"), None)
        answer.ok = bool(items)
        if overview:
            answer.aio = True
            answer.text = str(overview.get("markdown") or "")
            answer.aio_urls = _urls(overview.get("references"))
        return answer
    if record["series"] == "ai_mode":
        overview = next((i for i in items if i.get("type") == "ai_overview"), {})
        answer.text = str(overview.get("markdown") or "")
        answer.urls = _urls(overview.get("references"))
    else:
        answer.text = str(result.get("markdown") or "")
        answer.urls = _urls(result.get("sources"))
        answer.fan_out = [str(q) for q in result.get("fan_out_queries") or []]
        answer.entities = len(result.get("brand_entities") or [])
    answer.ok = bool(answer.text)
    return answer


def read_cloro(record: Mapping[str, Any]) -> Answer:
    item = _item(record["item"])
    answer = Answer("cloro", record["series"], item)
    answer.seconds = _seconds(record.get("submitted_at"), record.get("done_at"))
    if record.get("latency_ms") is not None:
        answer.provider_seconds = float(record["latency_ms"]) / 1000
    if record.get("credits_charged") is not None:
        answer.cost = float(record["credits_charged"])
    response = record.get("response")
    if record.get("status") != "COMPLETED" or not isinstance(response, dict):
        answer.note = f"{record.get('status')}: {str(response)[:120]}"
        return answer
    result = response.get("result", response)
    if item.engine == "google":
        answer.organic = [
            str(r["link"]) for r in result.get("organicResults") or [] if r.get("link")
        ]
        overview = result.get("aioverview")
        answer.ok = bool(answer.organic)
        if isinstance(overview, dict):
            answer.aio = True
            answer.text = str(overview.get("markdown") or overview.get("text") or "")
            answer.aio_urls = _urls(overview.get("sources"))
        return answer
    answer.text = str(result.get("markdown") or result.get("text") or "")
    answer.urls = _urls(result.get("sources"))
    answer.fan_out = [str(q) for q in result.get("searchQueries") or []]
    answer.entities = len(result.get("entities") or [])
    answer.ok = bool(answer.text)
    return answer


def load(raw_dir: Path) -> list[Answer]:
    answers: list[Answer] = []
    for provider, reader in (("dfs", read_dfs), ("cloro", read_cloro)):
        for path in sorted((raw_dir / provider).glob("*.json")):
            answers.append(reader(_read(path)))
    return answers


# ----------------------------------------------------------------------------- measures


def host(url: str) -> str:
    return urlsplit(url).netloc.lower().removeprefix("www.")


def page(url: str) -> str:
    """The page a result stands for: host and path, without query, fragment or a trailing slash."""
    parts = urlsplit(url)
    return f"{host(url)}{parts.path.rstrip('/')}"


def jaccard(a: Iterable[str], b: Iterable[str]) -> float | None:
    left, right = set(a), set(b)
    return len(left & right) / len(left | right) if left | right else None


def brands(text: str) -> set[str]:
    found: set[str] = set()
    for name in VENDORS:
        flags = 0 if len(name) <= 3 else re.IGNORECASE
        if re.search(rf"\b{re.escape(name)}\b", text, flags):
            found.add(name.lower())
    return found


def mean(values: Iterable[float | None]) -> float | None:
    kept = [v for v in values if v is not None]
    return statistics.fmean(kept) if kept else None


def fmt(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None or math.isnan(value) else f"{value:.{digits}f}"


def share(count: int, total: int) -> str:
    return f"{count}/{total} ({count / total:.0%})" if total else "n/a"


def top_overlap(a: Sequence[str], b: Sequence[str], size: int = 10) -> float | None:
    left, right = {page(u) for u in a[:size]}, {page(u) for u in b[:size]}
    return len(left & right) / max(min(len(left), len(right)), 1) if left and right else None


def _domains(answer: Answer) -> set[str]:
    return {host(u) for u in answer.urls}


def _pairs(
    answers: Sequence[Answer], left: tuple[str, str], right: tuple[str, str], engine: Engine
) -> list[tuple[Answer, Answer]]:
    """Answers of one engine from two (provider, series) pairs, for the same item and run."""
    first = {a.item.key: a for a in answers if (a.provider, a.series) == left and a.ok}
    second = {a.item.key: a for a in answers if (a.provider, a.series) == right and a.ok}
    keys = [k for k in first if k in second and first[k].item.engine == engine]
    return [(first[k], second[k]) for k in keys]


def _floor(
    answers: Sequence[Answer], side: tuple[str, str], engine: Engine
) -> list[tuple[Answer, Answer]]:
    """The same provider asked the same thing twice."""
    runs = {a.item.key: a for a in answers if (a.provider, a.series) == side and a.ok}
    pairs = []
    for key, first in runs.items():
        if first.item.engine == engine and first.item.repeat == 1:
            again = runs.get(key.replace("|r1", "|r2"))
            if again:
                pairs.append((first, again))
    return pairs


# ----------------------------------------------------------------------------- report


def _table(head: Sequence[str], rows: Iterable[Sequence[str]]) -> list[str]:
    return [
        "",
        f"| {' | '.join(head)} |",
        f"|{'---|' * len(head)}",
        *(f"| {' | '.join(r)} |" for r in rows),
        "",
    ]


def delivery_section(answers: Sequence[Answer]) -> list[str]:
    rows: list[list[str]] = []
    for provider, series in sorted({(a.provider, a.series) for a in answers}):
        group = [a for a in answers if (a.provider, a.series) == (provider, series)]
        ok = [a for a in group if a.ok]
        waits = [a.seconds for a in group if a.seconds is not None]
        own = [a.provider_seconds for a in group if a.provider_seconds is not None]
        cost = mean(a.cost for a in group)
        unit = "USD" if provider == "dfs" else "credits"
        rows.append(
            [
                provider,
                series,
                str(len(group)),
                share(len(ok), len(group)),
                f"{median(waits):.0f} s" if waits else "n/a",
                f"{percentile(waits, 0.95):.0f} s" if waits else "n/a",
                f"{median(own):.0f} s" if own else "n/a",
                f"{fmt(cost, 4 if provider == 'dfs' else 1)} {unit}" if cost is not None else "n/a",
            ]
        )
    head = [
        "Provider",
        "Series",
        "Tasks",
        "Answered",
        "Median wait",
        "p95 wait",
        "cloro task time",
        "Mean charge",
    ]
    note = (
        "DataForSEO waits are submit to ready as seen by a 30 second poll; cloro waits are "
        "submit to the poll that saw COMPLETED, queue included (free plan: 1 task at a time)."
    )
    return ["## Delivery", *_table(head, rows), note]


def content_section(answers: Sequence[Answer]) -> list[str]:
    rows: list[list[str]] = []
    for provider, series in sorted(
        {
            (a.provider, a.series)
            for a in answers
            if a.series != "serp" and a.item.engine != "google"
        }
    ):
        ok = [a for a in answers if (a.provider, a.series) == (provider, series) and a.ok]
        rows.append(
            [
                provider,
                series,
                str(len(ok)),
                f"{median([float(len(a.text)) for a in ok]):.0f}" if ok else "n/a",
                share(sum(1 for a in ok if a.urls), len(ok)),
                f"{median([float(len(a.urls)) for a in ok if a.urls]):.0f}"
                if any(a.urls for a in ok)
                else "n/a",
                share(sum(1 for a in ok if a.fan_out), len(ok)),
                share(sum(1 for a in ok if a.entities), len(ok)),
                share(sum(1 for a in ok if "eventus" in brands(a.text)), len(ok)),
            ]
        )
    head = [
        "Provider",
        "Series",
        "Answers",
        "Median chars",
        "With sources",
        "Median sources",
        "With fan-out",
        "With entities",
        "Names Eventus",
    ]
    return ["## What each answer holds", *_table(head, rows)]


def agreement_section(answers: Sequence[Answer]) -> list[str]:
    cloro = ("cloro", "chatgpt")
    comparisons: list[tuple[str, Engine, tuple[str, str], tuple[str, str]]] = [
        ("ChatGPT: DFS web search forced vs cloro", "chatgpt", ("dfs", "chatgpt_forced"), cloro),
        ("ChatGPT: DFS natural vs cloro", "chatgpt", ("dfs", "chatgpt"), cloro),
        ("Gemini: DFS vs cloro", "gemini", ("dfs", "gemini"), ("cloro", "gemini")),
        ("AI Mode: DFS vs cloro", "ai_mode", ("dfs", "ai_mode"), ("cloro", "ai_mode")),
    ]
    floors: list[tuple[str, Engine, tuple[str, str]]] = [
        ("ChatGPT: DFS vs itself (forced)", "chatgpt", ("dfs", "chatgpt_forced")),
        ("ChatGPT: cloro vs itself", "chatgpt", cloro),
        ("Gemini: DFS vs itself", "gemini", ("dfs", "gemini")),
        ("Gemini: cloro vs itself", "gemini", ("cloro", "gemini")),
        ("AI Mode: DFS vs itself", "ai_mode", ("dfs", "ai_mode")),
        ("AI Mode: cloro vs itself", "ai_mode", ("cloro", "ai_mode")),
    ]
    rows: list[list[str]] = []
    for label, engine, left, right in comparisons:
        pairs = _pairs(answers, left, right, engine)
        rows.append(
            [
                label,
                str(len(pairs)),
                fmt(mean(jaccard(_domains(a), _domains(b)) for a, b in pairs)),
                fmt(mean(jaccard(brands(a.text), brands(b.text)) for a, b in pairs)),
            ]
        )
    for label, engine, side in floors:
        pairs = _floor(answers, side, engine)
        rows.append(
            [
                f"{label} (floor)",
                str(len(pairs)),
                fmt(mean(jaccard(_domains(a), _domains(b)) for a, b in pairs)),
                fmt(mean(jaccard(brands(a.text), brands(b.text)) for a, b in pairs)),
            ]
        )
    head = ["Comparison", "Pairs", "Cited domains (Jaccard)", "Brands named (Jaccard)"]
    reading = (
        "Read each provider pair against the floor rows of the same engine: when two runs "
        "of one provider differ as much as the two providers do, the providers are "
        "interchangeable for that engine. A 1.00 is identical; 0.00 shares nothing."
    )
    return ["## Agreement between providers, and the floor", *_table(head, rows), reading]


def geo_section(answers: Sequence[Answer]) -> list[str]:
    rows: list[list[str]] = []
    for provider, series in (
        ("dfs", "chatgpt_forced"),
        ("cloro", "chatgpt"),
        ("dfs", "gemini"),
        ("cloro", "gemini"),
        ("dfs", "ai_mode"),
        ("cloro", "ai_mode"),
    ):
        cells: list[str] = []
        for country, suffix in (("IN", ".in"), ("AE", ".ae"), ("SA", ".sa")):
            group = [
                a
                for a in answers
                if (a.provider, a.series) == (provider, series)
                and a.ok
                and a.item.country == country
                and a.item.repeat == 1
            ]
            local = [share_of(a, suffix) for a in group if a.urls]
            cells.append(f"{fmt(mean(local))} of {len(group)}")
        rows.append([provider, series, *cells])
    head = ["Provider", "Series", "Local-domain share IN (.in)", "AE (.ae)", "SA (.sa)"]
    return [
        "## Does the country change the answer",
        *_table(head, rows),
        "Local-domain share: the part of an answer's cited domains that end in the country's "
        "suffix. It is a proxy: a provider that ignores the country shows a low share.",
    ]


def share_of(answer: Answer, suffix: str) -> float:
    domains = {host(u) for u in answer.urls}
    return sum(1 for d in domains if d.endswith(suffix)) / len(domains) if domains else 0.0


def serp_section(answers: Sequence[Answer]) -> list[str]:
    dfs = {a.item.key: a for a in answers if (a.provider, a.series) == ("dfs", "serp") and a.ok}
    cloro = {
        a.item.key: a
        for a in answers
        if a.provider == "cloro" and a.item.engine == "google" and a.ok
    }
    keys = [k for k in dfs if k in cloro]
    both = [(dfs[k], cloro[k]) for k in keys]
    rows = [
        ["keywords answered by both", str(len(both))],
        [
            "top 10 pages in common (mean)",
            fmt(mean(top_overlap(a.organic, b.organic) for a, b in both)),
        ],
        [
            "top 10 domains (Jaccard, mean)",
            fmt(
                mean(
                    jaccard({host(u) for u in a.organic[:10]}, {host(u) for u in b.organic[:10]})
                    for a, b in both
                )
            ),
        ],
        [
            "same first result",
            share(
                sum(
                    1
                    for a, b in both
                    if a.organic and b.organic and page(a.organic[0]) == page(b.organic[0])
                ),
                len(both),
            ),
        ],
        [
            "AI Overview on both / on neither",
            f"{sum(1 for a, b in both if a.aio and b.aio)} / "
            f"{sum(1 for a, b in both if not a.aio and not b.aio)}",
        ],
        [
            "AI Overview only on DataForSEO / only on cloro",
            f"{sum(1 for a, b in both if a.aio and not b.aio)} / "
            f"{sum(1 for a, b in both if b.aio and not a.aio)}",
        ],
        [
            "AI Overview sources in common (Jaccard, mean)",
            fmt(
                mean(
                    jaccard({host(u) for u in a.aio_urls}, {host(u) for u in b.aio_urls})
                    for a, b in both
                    if a.aio and b.aio
                )
            ),
        ],
    ]
    for label, side in (("DataForSEO", ("dfs", "serp")), ("cloro", ("cloro", "google"))):
        pairs = _floor(answers, side, "google")
        rows.append(
            [
                f"{label} vs itself: top 10 pages in common ({len(pairs)} keywords)",
                fmt(mean(top_overlap(a.organic, b.organic) for a, b in pairs)),
            ]
        )
    return ["## Google Search and AI Overview (50 keywords)", *_table(["Measure", "Value"], rows)]


def cost_section(answers: Sequence[Answer]) -> list[str]:
    per: dict[str, dict[str, float]] = defaultdict(dict)
    for provider, series in {(a.provider, a.series) for a in answers}:
        cost = mean(a.cost for a in answers if (a.provider, a.series) == (provider, series))
        if cost is not None:
            per[provider][series] = cost
    windows = 150 * 52 * 2 / 12  # the base plan: 150 prompts, twice a week, a month
    dfs = per["dfs"]
    dfs_month = windows * sum(dfs.get(s, 0.0) for s in ("chatgpt", "gemini", "ai_mode"))
    credits = per["cloro"]
    credits_month = windows * sum(credits.get(s, 0.0) for s in ("chatgpt", "gemini", "ai_mode"))
    rows = [["DataForSEO (standard queue, ChatGPT natural)", f"${dfs_month:.2f}", "pay as you go"]]
    for plan, price in CREDIT_PRICES.items():
        rows.append(
            [
                f"cloro, {plan} credit price",
                f"${credits_month * price:.2f}",
                f"{credits_month:,.0f} credits a month",
            ]
        )
    return [
        "## Base plan cost (150 prompts, twice a week, three engines)",
        *_table(["Provider", "Per month", "Note"], rows),
        "cloro sells credits in plans (Lite $30 for 37,500, Hobby $100 for 250,000): the "
        "monthly bill is the plan price, not the metered figure above.",
    ]


def rows_csv(answers: Sequence[Answer], path: Path) -> None:
    lines = ["provider,series,key,ok,seconds,cost,sources,fan_out,organic,aio,chars,note"]
    for a in answers:
        note = a.note.replace('"', "'").replace("\n", " ")
        lines.append(
            f"{a.provider},{a.series},{a.item.key},{a.ok},{a.seconds},{a.cost},{len(a.urls)},"
            f'{len(a.fan_out)},{len(a.organic)},{a.aio},{len(a.text)},"{note}"'
        )
    path.write_text("\n".join(lines) + "\n")


def _measures(answers: Sequence[Answer]) -> list[str]:
    return [
        *delivery_section(answers),
        *content_section(answers),
        *agreement_section(answers),
        *geo_section(answers),
        *serp_section(answers),
    ]


def analyze(raw_dir: Path, fresh: bool = False) -> None:
    answers = load(raw_dir)
    if not answers:
        raise SystemExit(f"no answers under {raw_dir}")
    budget = Budget(cap=Decimal(0))
    budget.spent = Decimal(str(sum(a.cost or 0 for a in answers if a.provider == "dfs")))
    sections = [
        "Two providers, the same prompts and keywords, collected within the same hour. Only the "
        "items both providers answered are compared.",
        "",
    ]
    if fresh:
        for group in sorted({a.item.group for a in answers}):
            sections += [
                f"# Group {group}",
                *_measures([a for a in answers if a.item.group == group]),
            ]
        sections += [*cost_section(answers)]
    else:
        sections += [*_measures(answers), *cost_section(answers)]
    problems = [a for a in answers if not a.ok]
    sections += ["## Tasks that did not answer", ""]
    sections += [
        f"- {a.provider} {a.series} {a.item.key}: {a.note or 'no answer'}" for a in problems
    ] or ["- none"]
    rows_csv(answers, raw_dir / "rows.csv")
    name, title = (
        ("S-21", "cloro on a paid plan, two groups")
        if fresh
        else ("S-20", "DataForSEO against cloro")
    )
    say(f"report: {write_report(name, title, budget, sections)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("dfs", "cloro", "analyze"):
        command = sub.add_parser(name)
        command.add_argument("--raw-dir", type=Path, required=True)
        command.add_argument("--fresh", action="store_true", help="the two groups of S-21 only")
        if name == "dfs":
            command.add_argument("--cap", type=Decimal, required=True)
            command.add_argument("--resolve", action="store_true", help="resolve_poisoned_results")
            command.add_argument("--priority", action="store_true", help="the priority queue")
        if name == "cloro":
            command.add_argument("--max-credits", type=int, required=True)
            command.add_argument("--minutes", type=int, default=90)
    options = parser.parse_args()
    if options.command == "analyze":
        analyze(options.raw_dir, options.fresh)
    elif options.command == "dfs":
        run(
            lambda: collect_dfs(
                options.raw_dir,
                options.cap,
                options.fresh,
                resolve=options.resolve,
                priority=options.priority,
            )
        )
    else:
        asyncio.run(
            collect_cloro(options.raw_dir, options.max_credits, options.minutes, options.fresh)
        )


if __name__ == "__main__":
    main()
