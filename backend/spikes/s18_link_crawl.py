"""S-18: one real crawl of one project's website, through the code the worker runs, and nothing
else (internal link tracker, plan 02).

It is not the worker. The worker also runs rank, SERP, AI prompt and Search Console ticks that
spend money; this tool starts none of them. Its one tick is `crawl_tick`, the only code that
posts a crawl, and it is held to one run, one post and a cap:

    uv run --env-file <worker env file> python spikes/s18_link_crawl.py queue \\
        --project <uuid> --allow-host example.com
    uv run --env-file <worker env file> python spikes/s18_link_crawl.py run \\
        --project <uuid> --allow-host example.com --max-usd 1.00
    uv run --env-file <worker env file> python spikes/s18_link_crawl.py status --project <uuid>

The settings are the worker's, read from the process environment. Stop the real worker first
(or leave CRAWLS_ENABLED off): a worker ticking at the same time would post queued crawls too.

`run` checks, before any call to the provider, that: the cap is given and at most $5; exactly
one crawl run is queued or under way in the whole database (the tick posts every queued run of
every workspace) and it is this project's; its estimate fits the cap; its host is in the
allow-list; the DataForSEO credentials and the raw bucket are set. Then it ticks until the run
ends, printing one line a tick. If the cost recorded for the run passes the cap it asks the
provider to stop the crawl, once, and exits with 1. On a timeout or Ctrl-C it cancels nothing:
it prints the run and task ids and leaves the decision to a person.

Exit codes: 0 the crawl is `ready` or `stopped_at_ceiling`; 1 it failed, was cancelled, passed
the cap, timed out or hit an error; 2 a refusal or a bad argument; 130 interrupted.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Final
from uuid import UUID

import httpx
from redis.asyncio import BlockingConnectionPool, Redis
from sqlalchemy import Row, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_ingest import PASS_TIME, ingest_run
from idraft.collectors.crawl_runs import (
    CrawlBusyError,
    CrawlIngestTask,
    NoSiteError,
    crawl_tick,
    queue_run,
)
from idraft.collectors.crawl_store import ACTIVE_STATES
from idraft.collectors.ledger import database_time
from idraft.config.settings import Settings, load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.db.tables import (
    crawl_links,
    crawl_pages,
    crawl_runs,
    domains,
    projects,
    provider_cost_events,
    workspaces,
)
from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import CrawlOrder, OnPage, PostedCrawl
from idraft.worker.app import HTTP_TIMEOUT, REDIS_TIMEOUT_SECONDS, _open_raw_store
from idraft.worker.assembly import dataforseo_client

Sessions = async_sessionmaker[AsyncSession]

MAX_USD_LIMIT: Final = Decimal(5)
TERMINAL: Final = frozenset({"ready", "stopped_at_ceiling", "failed", "cancelled"})
SUCCEEDED: Final = frozenset({"ready", "stopped_at_ceiling"})
EXIT_FAILED: Final = 1
EXIT_REFUSED: Final = 2
EXIT_INTERRUPTED: Final = 130
# This tool makes its calls one after the other.
HTTP_CONNECTIONS: Final = 2
REDIS_CONNECTIONS: Final = 4


class RefusedError(Exception):
    """A precondition does not hold. Nothing was sent to the provider."""


def say(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _shown(value: object) -> str:
    if value is None:
        return "-"
    return f"{value:f}" if isinstance(value, Decimal) else str(value)


class OneCrawlOnPage(OnPage):
    """The worker's On-Page adapter, allowed to post one crawl: the run this tool was started
    for, once. `crawl_tick` also queues the scheduled crawls that fall due and posts every queued
    run, and it tries again a post that certainly did not leave. Neither may happen here, so any
    other post, and a second post of this run, is refused as not sent."""

    def __init__(self, client: DataForSeoClient, run_id: UUID) -> None:
        super().__init__(client)
        self._tag = str(run_id)
        self.posts = 0

    async def post(self, order: CrawlOrder) -> PostedCrawl:
        if order.tag != self._tag:
            raise _not_sent("this tool posts only the crawl it was started for")
        if self.posts:
            raise _not_sent("this crawl was already posted once; it is not posted again")
        self.posts += 1
        return await super().post(order)


def _not_sent(message: str) -> ProviderCallError:
    return ProviderCallError(ProviderError(kind=ProviderErrorKind.NOT_SENT, message=message))


# Database reads (all by the worker role, which bypasses row-level security)


async def _active_runs(sessions: Sessions) -> list[Row[Any]]:
    """Every crawl run queued or under way, in the whole database."""
    async with sessions() as db:
        return list(
            (
                await db.execute(
                    select(
                        crawl_runs.c.id,
                        crawl_runs.c.project_id,
                        crawl_runs.c.state,
                        crawl_runs.c.target_host,
                        crawl_runs.c.estimated_cost_usd,
                    )
                    .where(crawl_runs.c.state.in_(ACTIVE_STATES))
                    .order_by(crawl_runs.c.created_at, crawl_runs.c.id)
                )
            ).all()
        )


@dataclass(frozen=True, slots=True)
class Snapshot:
    state: str
    pages_crawled: int
    pages_found: int
    ingest_phase: str | None
    task_id: str | None
    run_cost: Decimal | None
    events_cost: Decimal
    error_code: str | None
    error_message: str | None

    def over(self, cap: Decimal) -> bool:
        return self.events_cost > cap or (self.run_cost or Decimal(0)) > cap


async def _snapshot(sessions: Sessions, run_id: UUID) -> Snapshot | None:
    async with sessions() as db:
        run = (
            await db.execute(
                select(
                    crawl_runs.c.state,
                    crawl_runs.c.pages_crawled,
                    crawl_runs.c.pages_found,
                    crawl_runs.c.ingest_phase,
                    crawl_runs.c.provider_task_id,
                    crawl_runs.c.cost_usd,
                    crawl_runs.c.error_code,
                    crawl_runs.c.error_message,
                ).where(crawl_runs.c.id == run_id)
            )
        ).one_or_none()
        if run is None:
            return None
        spent: Decimal | int = (
            await db.execute(
                select(func.coalesce(func.sum(provider_cost_events.c.cost_usd), 0)).where(
                    provider_cost_events.c.run_id == run_id
                )
            )
        ).scalar_one()
    return Snapshot(
        state=run.state,
        pages_crawled=run.pages_crawled,
        pages_found=run.pages_found,
        ingest_phase=run.ingest_phase,
        task_id=run.provider_task_id,
        run_cost=run.cost_usd,
        events_cost=Decimal(spent),
        error_code=run.error_code,
        error_message=run.error_message,
    )


def _check_host(host: str, allowed: Sequence[str]) -> None:
    if host.lower() not in {name.lower() for name in allowed}:
        raise RefusedError(f"host {host} is not in the --allow-host allow-list")


# queue


async def _queue(sessions: Sessions, args: argparse.Namespace) -> int:
    async with sessions() as db:
        site = (
            await db.execute(
                select(
                    projects.c.workspace_id,
                    projects.c.status,
                    workspaces.c.status.label("workspace_status"),
                    domains.c.host,
                )
                .select_from(
                    projects.join(workspaces, workspaces.c.id == projects.c.workspace_id).outerjoin(
                        domains, domains.c.id == projects.c.primary_domain_id
                    )
                )
                .where(projects.c.id == args.project, projects.c.deleted_at.is_(None))
            )
        ).one_or_none()
    if site is None:
        raise RefusedError(f"no project {args.project}")
    if site.status != "active" or site.workspace_status != "active":
        raise RefusedError("the project or its workspace is not active")
    if site.host is None:
        raise RefusedError("the project has no website (no primary domain)")
    say(f"project {args.project} host {site.host}")
    _check_host(site.host, args.allow_host)
    active = await _active_runs(sessions)
    if active:
        raise RefusedError(
            f"crawl run {active[0].id} is already {active[0].state}: only one run may exist"
        )
    now = await database_time(sessions)
    try:
        async with sessions() as db, db.begin():
            run_id = await queue_run(
                db,
                workspace_id=site.workspace_id,
                project_id=args.project,
                trigger=args.trigger,
                requested_by=None,
                now=now,
            )
    except (CrawlBusyError, NoSiteError, LookupError) as failure:
        raise RefusedError(str(failure) or type(failure).__name__) from None
    async with sessions() as db:
        queued = (
            await db.execute(
                select(crawl_runs.c.ceiling, crawl_runs.c.estimated_cost_usd).where(
                    crawl_runs.c.id == run_id
                )
            )
        ).one()
    say(
        f"queued run {run_id} ceiling={queued.ceiling} "
        f"estimated_cost_usd={_shown(queued.estimated_cost_usd)}"
    )
    say("next: run this tool with `run`, with --max-usd at least the estimate")
    return 0


# status


async def _status(sessions: Sessions, args: argparse.Namespace) -> int:
    async with sessions() as db:
        run = (
            await db.execute(
                select(crawl_runs)
                .where(crawl_runs.c.project_id == args.project)
                .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
                .limit(1)
            )
        ).one_or_none()
        if run is None:
            say(f"no crawl run for project {args.project}")
            return 0
        pages = (
            await db.execute(
                select(func.count()).select_from(crawl_pages).where(crawl_pages.c.run_id == run.id)
            )
        ).scalar_one()
        links = (
            await db.execute(
                select(func.count()).select_from(crawl_links).where(crawl_links.c.run_id == run.id)
            )
        ).scalar_one()
        events = (
            await db.execute(
                select(
                    provider_cost_events.c.workload,
                    provider_cost_events.c.endpoint,
                    provider_cost_events.c.cost_usd,
                    provider_cost_events.c.cost_source,
                )
                .where(provider_cost_events.c.run_id == run.id)
                .order_by(provider_cost_events.c.occurred_at)
            )
        ).all()
    say(
        f"run {run.id} state={run.state} trigger={run.trigger} host={run.target_host} "
        f"ceiling={run.ceiling}"
    )
    say(
        f"pages_found={run.pages_found} pages_crawled={run.pages_crawled} "
        f"stop_reason={_shown(run.stop_reason)} ingest_phase={_shown(run.ingest_phase)}"
    )
    say(
        f"estimated_cost_usd={_shown(run.estimated_cost_usd)} cost_usd={_shown(run.cost_usd)} "
        f"task_id={_shown(run.provider_task_id)}"
    )
    say(f"error_code={_shown(run.error_code)} error_message={_shown(run.error_message)}")
    say(f"stored: pages={pages} links={links}")
    say(f"cost events: {len(events)}")
    for event in events:
        say(
            f"  workload={event.workload} endpoint={event.endpoint} "
            f"cost_usd={_shown(event.cost_usd)} source={event.cost_source}"
        )
    return 0


# run


async def _run(
    settings: Settings,
    sessions: Sessions,
    args: argparse.Namespace,
    transport: httpx.AsyncBaseTransport | None,
) -> int:
    cap: Decimal = args.max_usd
    if cap > MAX_USD_LIMIT:
        raise RefusedError(f"--max-usd must be at most {MAX_USD_LIMIT}")
    say(f"check max-usd: {cap} (at most {MAX_USD_LIMIT})")
    active = await _active_runs(sessions)
    if len(active) != 1:
        raise RefusedError(
            "exactly one crawl run must be queued or under way in the whole database "
            f"(the tick would post every queued run); found {len(active)}"
        )
    run = active[0]
    if run.project_id != args.project:
        raise RefusedError(f"the one active run ({run.id}) belongs to another project")
    say(f"check exactly one run: {run.id} state={run.state} host={run.target_host}")
    estimate: Decimal | None = run.estimated_cost_usd
    if estimate is None or estimate > cap:
        raise RefusedError(f"the run's cost estimate {_shown(estimate)} is above --max-usd {cap}")
    say(f"check estimate: {estimate} is at most {cap}")
    _check_host(run.target_host, args.allow_host)
    say(f"check host in allow-list: {run.target_host}")
    present = settings.dataforseo_credentials is not None
    say(f"check DataForSEO credentials: {'present' if present else 'missing'}")
    if not present:
        raise RefusedError("the DataForSEO credentials are not set")
    if settings.r2_raw_endpoint is None:
        raise RefusedError("raw storage (R2_RAW_*) is not configured: ingest keeps its pages there")
    async with contextlib.AsyncExitStack() as resources:
        http = await resources.enter_async_context(
            httpx.AsyncClient(
                transport=transport,
                timeout=HTTP_TIMEOUT,
                limits=httpx.Limits(max_connections=HTTP_CONNECTIONS),
                follow_redirects=False,
            )
        )
        redis: Redis = Redis(
            connection_pool=BlockingConnectionPool.from_url(
                settings.redis_url.get_secret_value(),
                max_connections=REDIS_CONNECTIONS,
                timeout=REDIS_TIMEOUT_SECONDS,
                socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
                socket_timeout=REDIS_TIMEOUT_SECONDS,
            )
        )
        resources.push_async_callback(redis.aclose, close_connection_pool=True)
        await redis.ping()
        store = await resources.enter_async_context(_open_raw_store(settings, 1))
        client = dataforseo_client(settings, http, redis)
        if client is None:
            raise RefusedError("the DataForSEO credentials are not set")
        on_page = OneCrawlOnPage(client, run.id)
        say("checks passed; the first tick may post the crawl")
        code = await _drive(sessions, on_page, store, run.id, args)
        # Best effort: the crawl's own outcome is what is reported.
        with contextlib.suppress(Exception):
            others = [other for other in await _active_runs(sessions) if other.id != run.id]
            if others:
                say(
                    f"note: {len(others)} other crawl run(s) are now queued or under way (the tick "
                    "queues scheduled crawls); this tool posted none of them"
                )
        return code


async def _drive(
    sessions: Sessions,
    on_page: OneCrawlOnPage,
    store: Any,
    run_id: UUID,
    args: argparse.Namespace,
) -> int:
    cap: Decimal = args.max_usd
    deadline = time.monotonic() + args.timeout_minutes * 60
    last = await _snapshot(sessions, run_id)

    async def send_ingest(task: CrawlIngestTask) -> bool:
        # Past the cap nothing more is read: the stop below comes first.
        now = await _snapshot(sessions, run_id)
        if now is None or now.over(cap):
            return False
        outcome = await ingest_run(
            sessions, on_page, store, task, deadline=time.monotonic() + PASS_TIME.total_seconds()
        )
        say(
            f"ingest pass: phase={_shown(outcome.phase)} steps={outcome.steps} "
            f"failed={outcome.failed} busy={outcome.busy}"
        )
        return True

    try:
        while True:
            report_time = await database_time(sessions)
            await crawl_tick(sessions, on_page, send_ingest, now=report_time)
            last = await _snapshot(sessions, run_id)
            if last is None:
                say(f"run {run_id} is gone from the database")
                return EXIT_FAILED
            say(
                f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ} state={last.state} "
                f"pages_crawled={last.pages_crawled} pages_found={last.pages_found} "
                f"ingest_phase={_shown(last.ingest_phase)} cost_usd={_shown(last.events_cost)}"
            )
            if last.over(cap):
                return await _stop_at_cap(on_page, run_id, last, cap)
            if last.state in TERMINAL:
                say(f"finished: run {run_id} state={last.state}")
                if last.state == "failed":
                    say(
                        f"error_code={_shown(last.error_code)} message={_shown(last.error_message)}"
                    )
                if last.state == "stopped_at_ceiling":
                    say("the crawl hit its page ceiling; its pages are kept")
                return 0 if last.state in SUCCEEDED else EXIT_FAILED
            if last.state == "queued" and on_page.posts:
                say(
                    f"the post did not go through and is not sent again: run {run_id} is still "
                    "queued, nothing was posted"
                )
                return EXIT_FAILED
            if time.monotonic() >= deadline:
                say(
                    f"timed out: run {run_id} state={last.state} task {_shown(last.task_id)}; "
                    "the crawl is not cancelled at the provider, a person decides"
                )
                return EXIT_FAILED
            await asyncio.sleep(args.poll_seconds)
    except asyncio.CancelledError:
        say(
            f"interrupted: run {run_id} state={_shown(last and last.state)} "
            f"task {_shown(last and last.task_id)}; nothing was cancelled"
        )
        return EXIT_INTERRUPTED
    except Exception as failure:
        say(
            f"tick failed ({type(failure).__name__}): run {run_id} "
            f"state={_shown(last and last.state)} task {_shown(last and last.task_id)}; "
            "nothing is retried"
        )
        return EXIT_FAILED


async def _stop_at_cap(on_page: OneCrawlOnPage, run_id: UUID, seen: Snapshot, cap: Decimal) -> int:
    say(
        f"CAP EXCEEDED: cost_usd={_shown(seen.events_cost)} run cost_usd={_shown(seen.run_cost)} "
        f"is above --max-usd {cap}; run {run_id} task {_shown(seen.task_id)}"
    )
    if seen.task_id is None:
        say("there is no provider task id to stop")
        return EXIT_FAILED
    try:
        await on_page.force_stop(seen.task_id)
    except ProviderCallError as failure:
        say(f"force stop failed ({failure.error.kind.value}): stop task {seen.task_id} by hand")
    else:
        say(f"force stop sent for task {seen.task_id}; the run row is left as it is")
    return EXIT_FAILED


# Arguments and entry point


def _usd(text: str) -> Decimal:
    try:
        value = Decimal(text)
    except InvalidOperation:
        raise argparse.ArgumentTypeError("not a number") from None
    if not value.is_finite() or value <= 0:
        raise argparse.ArgumentTypeError("must be above 0")
    return value


def _seconds(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError("not a number") from None
    if not 0 <= value < 1e9:
        raise argparse.ArgumentTypeError("must not be negative")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name: str, help_: str, *, allow: bool) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=help_)
        sub.add_argument("--project", type=UUID, required=True)
        if allow:
            sub.add_argument(
                "--allow-host",
                action="append",
                required=True,
                help="a host this tool may crawl (repeatable)",
            )
        return sub

    queue = command("queue", "queue one crawl run of the project's website", allow=True)
    queue.add_argument("--trigger", choices=["manual"], default="manual")
    run = command("run", "tick the one queued run until it ends, within a cap", allow=True)
    run.add_argument("--max-usd", type=_usd, required=True, help="at most 5")
    run.add_argument("--poll-seconds", type=_seconds, default=20.0)
    run.add_argument("--timeout-minutes", type=_seconds, default=60.0)
    command("status", "show the project's latest run (no provider call)", allow=False)
    return parser


async def main(
    argv: Sequence[str] | None = None, *, transport: httpx.AsyncBaseTransport | None = None
) -> int:
    """`transport` is for tests: the HTTP transport of the provider client."""
    try:
        args = _parser().parse_args(argv)
        settings = load_settings()
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else EXIT_REFUSED
    engine = create_engine(settings)
    sessions = create_session_factory(engine)
    try:
        if args.command == "queue":
            return await _queue(sessions, args)
        if args.command == "status":
            return await _status(sessions, args)
        return await _run(settings, sessions, args, transport)
    except RefusedError as refusal:
        say(f"refused: {refusal}")
        return EXIT_REFUSED
    except Exception as failure:
        # The class only: a message may quote a connection string or an address.
        say(f"failed: {type(failure).__name__}")
        return EXIT_FAILED
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
