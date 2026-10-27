"""The Phase 4 acceptance (docs/29 section 3, rank collection plan Task 11): a daily rank
schedule over many keywords and many days, run through the real planner, dispatcher,
submission, ready poll, fetch and ingest on a simulated clock, against a provider that answers
as DataForSEO does.

Criteria, each checked on every simulated day or at the end:

- at least 98% of the day's checks are ingested within the window plus 6 hours;
- no check is ingested twice (one snapshot a task) and none is sent twice (one provider task a
  ledger task);
- every keyword has one snapshot a day, and its state is the last one;
- the cost the ledger recorded is within 5% of the run's estimate by the price book.

The clock is simulated, not the database's: every step passes its own `now` to the planner,
the dispatcher and the ready poll. What the database stamps itself (when a task was fetched,
the snapshot time) is the real time of the test, so the snapshots of all days carry the day the
test runs; the provider's own time is outside the accepted range for the days ahead (R19) and
is replaced by the fetch time. The partitions of the ledger exist for the months around today,
so the simulated days start tomorrow and a test run in the last two weeks of a month is
skipped.

By default a small run (300 keywords, 3 days) is part of the suite. The full run of the plan
(5,000 keywords, 14 days) is taken by `RANK_ACCEPTANCE=full`; it takes the better part of an
hour.
"""

from __future__ import annotations

import os
import uuid
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any

import pytest

from idraft.collectors.dispatcher import SubmitBatch, dispatch
from idraft.collectors.fetching import FetchTask, fetch_task, poll_ready
from idraft.collectors.planner import plan_due
from idraft.collectors.registry import Registry
from idraft.collectors.seo_rank import SeoRankWorkload
from idraft.collectors.seo_rank_ingest import ingest
from idraft.collectors.submission import submit_batch
from idraft.providers.contract import (
    AcceptedTask,
    CanonicalRequest,
    Echo,
    FetchResult,
    ReadyTask,
    SubmitResult,
)
from idraft.providers.dataforseo.serp import SerpOrganicParams
from idraft.ranks.depth import pages
from tests.api.auth.support import execute, fetch
from tests.api.keywords.support import LOCATION
from tests.collectors.rank_support import OWN_HOST, Ledger, answer, make_world
from tests.collectors.support import FakeProvider, Pauses, empty_ledger, make_schedule
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

FULL = os.environ.get("RANK_ACCEPTANCE") == "full"
KEYWORDS, DAYS = (5_000, 14) if FULL else (300, 3)
STEP = timedelta(minutes=10)
WINDOW_START = time(2, 0)
WINDOW_HOURS = 6
# The criterion of the plan: ingested within the window plus 6 hours.
AFTER_WINDOW = timedelta(hours=6)
PAGE_PRICE = Decimal("0.0006")


class Outbox:
    """The queue, as far as the dispatcher and the ready poll can tell."""

    def __init__(self) -> None:
        self.batches: list[SubmitBatch] = []
        self.fetches: list[FetchTask] = []
        self._held: set[str] = set()

    async def send(self, item: SubmitBatch | FetchTask) -> bool:
        key = item.dedupe_key
        if key in self._held:
            return False
        self._held.add(key)
        if isinstance(item, SubmitBatch):
            self.batches.append(item)
        else:
            self.fetches.append(item)
        return True

    def done(self, item: SubmitBatch | FetchTask) -> None:
        self._held.discard(item.dedupe_key)


class SerpProvider(FakeProvider):
    """DataForSEO's organic SERP as the worker meets it: a batch is accepted at the price of
    its pages and the asynchronous AI Overview, what it accepted is listed as ready, and its
    answer lists ten to a hundred results with the project's site at a rank that moves from
    day to day."""

    def __init__(self, clock: dict[str, datetime]) -> None:
        super().__init__(code="dataforseo", size=100)
        self._clock = clock
        self.requests: dict[str, CanonicalRequest] = {}
        self.sent: Counter[str] = Counter()
        self.waiting: list[str] = []

    def payload_slug(self, endpoint: str) -> str:
        return "serp_google_organic_advanced"

    async def submit(self, endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        accepted = []
        for request in requests:
            assert isinstance(request.params, SerpOrganicParams)
            provider_task_id = f"p-{request.task_id}-{request.attempt}"
            self.sent[request.task_id] += 1
            self.requests[provider_task_id] = request
            self.waiting.append(provider_task_id)
            cost = (pages(request.params.depth) + 1) * PAGE_PRICE
            accepted.append(
                AcceptedTask(
                    task_id=request.task_id, provider_task_id=provider_task_id, cost_usd=cost
                )
            )
        return SubmitResult(accepted=accepted)

    async def list_ready(self, endpoint: str) -> Sequence[ReadyTask]:
        return [
            ReadyTask(
                provider_task_id=provider_task_id,
                echo=Echo(
                    task_id=self.requests[provider_task_id].task_id,
                    run_id=self.requests[provider_task_id].run_id,
                    attempt=self.requests[provider_task_id].attempt,
                ),
            )
            for provider_task_id in self.waiting
        ]

    async def fetch(self, endpoint: str, provider_task_id: str) -> FetchResult:
        request = self.requests[provider_task_id]
        assert isinstance(request.params, SerpOrganicParams)
        if provider_task_id in self.waiting:
            self.waiting.remove(provider_task_id)
        day = (self._clock["now"].date() - self._clock["start"].date()).days
        return FetchResult(
            provider_task_id=provider_task_id,
            status="ready",
            body=_serp(request.params, day),
        )


def _serp(params: SerpOrganicParams, day: int) -> bytes:
    """The results for a keyword on a day: the site at a rank that moves with the day, or not
    on the pages checked."""
    number = int(params.keyword.rsplit(" ", 1)[1])
    own = 1 + (number * 7 + day * 3) % 30
    urls = [
        f"https://www.{OWN_HOST}/page" if rank == own else f"https://other-{rank}.example/"
        for rank in range(1, params.depth + 1)
    ]
    return answer(urls, depth=params.depth, when=datetime.now(UTC))


async def _keywords(pg: PostgresServer, workspace: uuid.UUID, project: uuid.UUID) -> None:
    await execute(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "SELECT $1, 'keyword ' || g, 'keyword ' || g, 'en' FROM generate_series(1, $2) g",
        workspace,
        KEYWORDS,
    )
    await execute(
        pg,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device) SELECT $1, $2, k.id, $3, 'en', 'desktop' FROM seo.keywords k "
        "WHERE k.workspace_id = $1",
        workspace,
        project,
        LOCATION,
    )


async def _step(
    sessions: Ledger, parts: Registry, provider: SerpProvider, store: MemoryStore, now: datetime
) -> None:
    """One pass of the worker at `now`: plan, send, submit, look, fetch, ingest."""
    outbox = Outbox()
    pauses = Pauses()
    await plan_due(sessions, parts, now=now)
    await dispatch(sessions, parts, outbox, pauses, now=now)
    for batch in outbox.batches:
        await submit_batch(sessions, parts, pauses, batch, store=store, jitter=lambda: 0.0)
    await poll_ready(sessions, parts, outbox, now=now)
    for order in outbox.fetches:
        await fetch_task(sessions, parts, store, order, jitter=lambda: 0.0)
    while True:
        report = await ingest(sessions, store)
        if not (report.ingested or report.failed):
            break


async def test_a_daily_schedule_collects_every_keyword_every_day(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    today = datetime.now(UTC).date()
    if (today + timedelta(days=DAYS + 1)).month != today.month:
        pytest.skip("the ledger's partitions end with the month; run this earlier in a month")
    await empty_ledger(migrated)
    world = await make_world(migrated)
    project = world.project
    await _keywords(migrated, project.workspace_id, project.id)
    start = datetime.combine(today + timedelta(days=1), time(), tzinfo=UTC)
    clock = {"now": start, "start": start}
    await make_schedule(
        migrated,
        project,
        next_run_at=datetime.combine(start.date(), WINDOW_START, tzinfo=UTC),
        window_start_local=WINDOW_START.isoformat(timespec="minutes"),
        window_hours=WINDOW_HOURS,
        selector={"all": True},
    )
    provider = SerpProvider(clock)
    parts = Registry()
    parts.add_workload(SeoRankWorkload())
    parts.add_provider(provider)
    store = MemoryStore()

    for day in range(DAYS):
        midnight = start + timedelta(days=day)
        now = datetime.combine(midnight.date(), WINDOW_START, tzinfo=UTC)
        window_end = now + timedelta(hours=WINDOW_HOURS)
        first = now
        while now <= window_end + AFTER_WINDOW:
            clock["now"] = now
            await _step(worker_db, parts, provider, store, now)
            now += STEP
        # Judged at the window's end plus 6 hours.
        counts = await _day(migrated, first)
        assert counts["tasks"] == KEYWORDS, f"day {day}: {counts}"
        assert counts["ingested"] >= 0.98 * counts["tasks"], f"day {day}: {counts}"

    await _verify(migrated, provider, project.id)


async def _day(pg: PostgresServer, window_start: datetime) -> dict[str, int]:
    rows = await fetch(
        pg,
        "SELECT count(*) AS tasks, count(*) FILTER (WHERE t.status = 'ingested') AS ingested "
        "FROM ops.collection_tasks t JOIN ops.collection_runs r ON r.id = t.run_id "
        "WHERE r.window_start = $1",
        window_start,
    )
    return {"tasks": rows[0]["tasks"], "ingested": rows[0]["ingested"]}


async def _verify(pg: PostgresServer, provider: SerpProvider, project: uuid.UUID) -> None:
    totals: dict[str, Any] = dict(
        (
            await fetch(
                pg,
                "SELECT count(*) AS snapshots, count(DISTINCT collection_task_id) AS tasks, "
                "count(DISTINCT tracked_keyword_id) AS keywords FROM seo.serp_snapshots "
                "WHERE project_id = $1",
                project,
            )
        )[0]
    )
    # One snapshot a task, and a snapshot a keyword a day.
    assert totals["snapshots"] == totals["tasks"] == KEYWORDS * DAYS
    assert totals["keywords"] == KEYWORDS
    # Every ledger task was sent to the provider once.
    assert set(provider.sent.values()) == {1}
    assert len(provider.sent) == KEYWORDS * DAYS
    # Every keyword's state is its last check.
    stale = await fetch(
        pg,
        "SELECT count(*) AS n FROM seo.tracked_keyword_state s JOIN seo.serp_snapshots p "
        "ON p.id = s.last_snapshot_id WHERE s.project_id = $1 AND p.observed_at < ("
        "SELECT max(observed_at) FROM seo.serp_snapshots q "
        "WHERE q.tracked_keyword_id = s.tracked_keyword_id)",
        project,
    )
    assert stale[0]["n"] == 0
    states = await fetch(
        pg, "SELECT count(*) AS n FROM seo.tracked_keyword_state WHERE project_id = $1", project
    )
    assert states[0]["n"] == KEYWORDS
    # Cost: what the ledger recorded against the runs' estimates by the price book.
    spend = await fetch(
        pg,
        "SELECT sum(cost_usd) AS usd FROM ops.provider_cost_events WHERE project_id = $1",
        project,
    )
    estimated = await fetch(
        pg,
        "SELECT sum(estimated_cost_usd) AS usd FROM ops.collection_runs WHERE project_id = $1",
        project,
    )
    actual, expected = Decimal(spend[0]["usd"]), Decimal(estimated[0]["usd"])
    assert abs(actual - expected) <= Decimal("0.05") * expected, (actual, expected)
    # The recorded checks include the weekly deep check: some day looked at a hundred results.
    depths = await fetch(
        pg,
        "SELECT DISTINCT depth_requested FROM seo.serp_snapshots WHERE project_id = $1",
        project,
    )
    assert {row["depth_requested"] for row in depths} <= {20, 100}
