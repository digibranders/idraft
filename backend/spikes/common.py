"""What every test run shares: the live client, a spending cap, waiting for results, and the
report."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import statistics
import sys
import time
import uuid
from collections.abc import AsyncIterator, Callable, Coroutine, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

import httpx

from idraft.providers.contract import (
    CanonicalRequest,
    Contract,
    FetchResult,
    Limit,
    ProviderCallError,
)
from idraft.providers.dataforseo.client import ALL_CALLS, FAMILY_LIMITS, DataForSeoClient
from idraft.providers.dataforseo.endpoint import TaskEndpoint
from idraft.providers.dataforseo.provider import DataForSeo
from idraft.providers.dataforseo.serp import ENDPOINT, SERP_ORGANIC

REPOSITORY: Final = Path(__file__).resolve().parents[2]
REPORTS: Final = REPOSITORY / "docs" / "spikes"
CAPTURED: Final = (
    Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "dataforseo" / "captured"
)
# The installation these runs tag their tasks with: never production's.
INSTALLATION: Final = "spike"
# Standard queue, per page of 10 results (doc 06 section 2.1).
PAGE_PRICE: Final = Decimal("0.0006")
# How long to wait for a standard task before giving up on it.
READY_WITHIN: Final = timedelta(hours=2)
POLL_EVERY: Final = timedelta(seconds=30)


class SpendError(RuntimeError):
    """The run would spend, or has spent, more than its cap."""


@dataclass
class Budget:
    """The most a run may spend, and what DataForSEO says it has spent."""

    cap: Decimal
    spent: Decimal = Decimal(0)

    def allow(self, estimate: Decimal) -> None:
        if self.spent + estimate > self.cap:
            raise SpendError(
                f"estimated ${self.spent + estimate} is over the cap of ${self.cap}; nothing sent"
            )

    def charge(self, cost: Decimal | None, *, fallback: Decimal) -> None:
        self.spent += fallback if cost is None else cost


def worst_case(depth: int, *, async_overview: bool) -> Decimal:
    """The most one standard task can cost: pages times the page price, doubled when the
    asynchronous AI Overview is asked for (the multiplier reading, the dearer of the two)."""
    pages = math.ceil(depth / 10)
    cost = PAGE_PRICE * pages
    return cost * 2 if async_overview else cost


def each_costs(depth: int, *, async_overview: bool) -> Callable[[Sent], Decimal]:
    """The estimate of every task of a batch that shares its depth and flag."""
    cost = worst_case(depth, async_overview=async_overview)

    def estimate(_: Sent) -> Decimal:
        return cost

    return estimate


class LocalGate:
    """The call limits of `idraft.worker.limiter`, kept in this process: a run is the only
    caller. One turn per `60 / per_minute` seconds for each scope a call names."""

    def __init__(self, all_calls: Limit, families: Mapping[str, Limit]) -> None:
        self._limits = {"all": all_calls, **families}
        self._next: dict[str, float] = {}

    async def enter(self, family: str | None, *, within: timedelta) -> bool:
        scopes = ["all"] if family is None else ["all", family]
        now = time.monotonic()
        start = max([now, *(self._next.get(scope, now) for scope in scopes)])
        if start - now > within.total_seconds():
            return False
        await asyncio.sleep(start - now)
        for scope in scopes:
            self._next[scope] = start + 60 / self._limits[scope].per_minute
        return True

    async def slow_down(self) -> None:
        pause = time.monotonic() + 60
        for scope in self._limits:
            self._next[scope] = max(self._next.get(scope, 0.0), pause)


@dataclass
class Live:
    client: DataForSeoClient
    provider: DataForSeo


@asynccontextmanager
async def live(endpoints: Mapping[str, TaskEndpoint] | None = None) -> AsyncIterator[Live]:
    login = os.environ.get("DATAFORSEO_LOGIN", "").strip()
    password = os.environ.get("DATAFORSEO_PASSWORD", "")
    if not login or not password:
        raise SystemExit("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set")
    gate = LocalGate(ALL_CALLS, FAMILY_LIMITS)
    async with httpx.AsyncClient(follow_redirects=False) as http:
        client = DataForSeoClient(http, gate, login=login, password=password)
        provider = DataForSeo(
            client, installation=INSTALLATION, endpoints=endpoints or {SERP_ORGANIC: ENDPOINT}
        )
        yield Live(client=client, provider=provider)


@dataclass
class Sent:
    """One task of a run: what was asked, and what came back."""

    number: int
    label: str
    params: Contract
    provider_task_id: str | None = None
    submit_cost: Decimal | None = None
    posted_at: datetime | None = None
    ready_at: datetime | None = None
    result: FetchResult | None = None
    body: dict[str, Any] | None = None
    notes: list[str] = field(default_factory=list)


def requests_for(sent: Sequence[Sent], run_id: uuid.UUID) -> list[CanonicalRequest]:
    return [
        CanonicalRequest(
            task_id=str(task.number),
            run_id=run_id,
            attempt=1,
            priority="standard",
            params=task.params,
        )
        for task in sent
    ]


async def submit_all(
    provider: DataForSeo,
    endpoint: str,
    sent: Sequence[Sent],
    budget: Budget,
    estimate: Callable[[Sent], Decimal],
) -> uuid.UUID:
    """Send the tasks in calls of 100, within the budget. Returns the run id their tags carry."""
    run_id = uuid.uuid4()
    by_number = {task.number: task for task in sent}
    for start in range(0, len(sent), 100):
        batch = list(sent[start : start + 100])
        budget.allow(sum((estimate(task) for task in batch), Decimal(0)))
        posted_at = datetime.now(UTC)
        try:
            result = await provider.submit(endpoint, requests_for(batch, run_id))
        except ProviderCallError as error:
            # The run goes on and reports it. The tasks may exist (a timeout): counted at
            # their estimate, and not collected, since their ids are not known.
            for task in batch:
                task.notes.append(f"call failed: {error.error.kind.value} {error.error.message}")
                budget.charge(None, fallback=estimate(task))
            continue
        for accepted in result.accepted:
            task = by_number[int(accepted.task_id)]
            task.provider_task_id = accepted.provider_task_id
            task.submit_cost = accepted.cost_usd
            task.posted_at = posted_at
            budget.charge(accepted.cost_usd, fallback=estimate(task))
        for refused in result.rejected:
            by_number[int(refused.task_id)].notes.append(
                f"refused: {refused.error.kind.value} {refused.error.message}"
            )
        answered = {task.task_id for task in result.accepted} | {
            task.task_id for task in result.rejected
        }
        for task in batch:
            if str(task.number) not in answered:
                # It may exist and be charged: counted at its estimate.
                task.notes.append("no answer for this task")
                budget.charge(None, fallback=estimate(task))
    return run_id


async def wait_ready(provider: DataForSeo, endpoint: str, sent: Sequence[Sent]) -> dict[str, bool]:
    """Poll until every sent task is listed as ready, or the wait runs out. Returns, per
    provider id, whether its listing echoed the tag it was sent with."""
    waiting = {task.provider_task_id: task for task in sent if task.provider_task_id}
    echoed: dict[str, bool] = {}
    deadline = time.monotonic() + READY_WITHIN.total_seconds()
    while waiting and time.monotonic() < deadline:
        for ready in await provider.list_ready(endpoint):
            task = waiting.pop(ready.provider_task_id, None)
            if task is None:
                continue
            task.ready_at = datetime.now(UTC)
            echoed[ready.provider_task_id] = ready.echo.task_id == str(task.number)
        if waiting:
            say(f"{len(waiting)} tasks not ready yet")
            await asyncio.sleep(POLL_EVERY.total_seconds())
    return echoed


async def fetch_all(provider: DataForSeo, endpoint: str, sent: Sequence[Sent]) -> None:
    for task in sent:
        if task.provider_task_id is None or task.ready_at is None:
            continue
        try:
            task.result = await provider.fetch(endpoint, task.provider_task_id)
        except ProviderCallError as error:
            task.notes.append(f"fetch failed: {error.error.kind.value} {error.error.message}")
            continue
        if task.result.body is not None:
            task.body = json.loads(task.result.body)


def first_result(body: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """The first result of the one task of a `task_get` answer, or an empty mapping."""
    if body is None:
        return {}
    tasks = body.get("tasks") or [{}]
    results = tasks[0].get("result") or [{}]
    result: Mapping[str, Any] = results[0] or {}
    return result


def task_cost(body: Mapping[str, Any] | None) -> Decimal | None:
    if body is None:
        return None
    tasks = body.get("tasks") or [{}]
    cost = tasks[0].get("cost")
    return None if cost is None else Decimal(str(cost))


def percentile(values: Sequence[float], share: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return math.nan
    index = min(len(ordered) - 1, max(0, math.ceil(share * len(ordered)) - 1))
    return ordered[index]


def median(values: Sequence[float]) -> float:
    return statistics.median(values) if values else math.nan


def wilson(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """The 95% Wilson interval of a proportion."""
    if total == 0:
        return (math.nan, math.nan)
    share = successes / total
    centre = share + z * z / (2 * total)
    spread = z * math.sqrt(share * (1 - share) / total + z * z / (4 * total * total))
    denominator = 1 + z * z / total
    return ((centre - spread) / denominator, (centre + spread) / denominator)


def read_keywords(path: Path, count: int) -> list[str]:
    keywords = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    if len(keywords) < count:
        raise SystemExit(f"{path} has {len(keywords)} keywords; this run needs {count}")
    return keywords[:count]


def arguments(description: str, *, keywords: int | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--cap", type=Decimal, required=True, help="most dollars the run may spend")
    if keywords is not None:
        parser.add_argument(
            "--keywords", type=Path, required=True, help=f"a file with at least {keywords} lines"
        )
    return parser.parse_args()


def say(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def run(main: Callable[[], Coroutine[Any, Any, None]]) -> None:
    """Run a test run; one refused by its cap exits with a message and code 2."""
    try:
        asyncio.run(main())
    except SpendError as error:
        say(str(error))
        raise SystemExit(2) from None


def write_report(spike: str, title: str, budget: Budget, sections: Sequence[str]) -> Path:
    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / f"{spike}.md"
    header = [
        f"# {spike}. {title}",
        "",
        f"Run: {datetime.now(UTC):%Y-%m-%d %H:%M} UTC. Spent: ${budget.spent} of a ${budget.cap} "
        "cap, as DataForSEO reported it (estimates where it did not).",
        "",
    ]
    path.write_text("\n".join([*header, *sections]) + "\n")
    return path


def capture(name: str, content: bytes, *, scrub: Callable[[Any], Any] | None = None) -> Path:
    """Keep an answer as a test fixture, with anything that names the account taken out."""
    CAPTURED.mkdir(parents=True, exist_ok=True)
    body = json.loads(content)
    if scrub is not None:
        body = scrub(body)
    path = CAPTURED / f"{name}.json"
    path.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")
    return path
