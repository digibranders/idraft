"""S-19: fetch the pages a crawl was refused (HTTP 403) ourselves, once, lightly, and read them into
the crawl again (internal link tracker). A dev tool: nothing here is product code, nothing is
wired into the worker, and its output is git-ignored.

From `backend/` (so that `--out spikes/raw/<name>` is the git-ignored `backend/spikes/raw/`):

    uv run --env-file <worker env file> python spikes/s19_fetch_blocked.py list \\
        --project <uuid> --allow-host example.com
    uv run --env-file <worker env file> python spikes/s19_fetch_blocked.py fetch \\
        --project <uuid> --allow-host example.com --max-requests 102 --pause-seconds 1.5 \\
        --out spikes/raw/<name>
    uv run --env-file <worker env file> python spikes/s19_fetch_blocked.py apply \\
        --project <uuid> --allow-host example.com --out spikes/raw/<name> \\
        --admin-env-file <env file of the admin database role>
    uv run --env-file <worker env file> python spikes/s19_fetch_blocked.py reingest \\
        --project <uuid> --allow-host example.com --out spikes/raw/<name> --max-usd 0.05

The settings are the worker's. Stop the real worker first (or leave CRAWLS_ENABLED off): after
`apply` the crawl is `processing` again, and a worker that ticks before `reingest` has read the
pages would read them from the provider, which has no HTML for them.

`list` reads the database only: the latest crawl of the project and its pages that answered 401 or
403 and have no links. `fetch` asks the site for exactly those pages (the only requests this tool
sends to a site), with these rules, all enforced in code:

- the host of every URL is in `--allow-host`, and runs only with APP_ENV=local;
- robots.txt of each host is read first, with the honest user agent (once, not counted in the
  cap); a URL it disallows is never fetched; an answer other than 200, 404 or 410 ends the tool
  before any page;
- `--max-requests` (default 102, at most 150) counts every page request, each redirect hop
  included; at the cap the tool stops and reports what is left;
- redirects are followed by hand: 3 hops at most, only to an allowed host and a URL robots.txt
  allows;
- one request at a time, `--pause-seconds` (at least 1.0) between any two requests;
- the first 403 or 429 ends the tool at once (no retry); so do 3 answers of 5xx in a row and 3
  failed requests (connect error, 30 second total timeout) in a row;
- only a 200 `text/html` answer of at most 10 MiB is kept; 404 and 410 are recorded as such;
- no cookies are kept, no JavaScript runs, no header is sent but `User-Agent` and
  `Accept: text/html`; a user agent that looks like a browser is refused.

Output in `--out` (a new or empty folder, git-ignored when inside the repository):

    html/<url_id>.html     each kept page, and the same bytes in the raw object store under the
                           key ingest uses (`html_key`), compressed as ingest compresses them
    fetch-report.json      every page: url, url_id, status, final url, bytes, skipped, timestamp
    provenance.json        the url_ids whose HTML came from this tool (the schema has no column
                           for it, and `links_state` has a closed set of values)

`apply` corrects the stored page rows of the run from the report (200: served html page, links
`waiting`; 404 and 410: broken) with an ADMIN database role, because the worker role may not
update those columns. The admin URL is read from the `DATABASE_URL` line of `--admin-env-file`,
never printed, and must name the same host, port and database as the worker's. It then puts the
crawl back to `processing` at the `links` phase, in one transaction.

`reingest` runs the real ingest on that crawl with an On-Page adapter that serves this tool's HTML
for the pages in provenance.json and the provider's free reads for the rest. It never posts a
crawl, never stops one and never writes a cost event; `--max-usd` is a watchdog on the cost events
of the run, which must not grow.

Exit codes: 0 done; 1 stopped on purpose (a 403 or 429, the cap, a failure) or an error; 2 a
refusal or a bad argument.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import math
import re
import subprocess
import sys
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from html import unescape
from pathlib import Path
from typing import Any, Final
from urllib.parse import urldefrag, urljoin, urlsplit
from urllib.robotparser import RobotFileParser
from uuid import UUID

import httpx
from redis.asyncio import BlockingConnectionPool, Redis
from sqlalchemy import Row, func, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from idraft.collectors.crawl_ingest import PASS_TIME, _canonical, html_key, ingest_run
from idraft.collectors.crawl_runs import CrawlIngestTask
from idraft.config.settings import Settings, load_settings, to_sqlalchemy_url
from idraft.crawl.edges import clean_text
from idraft.crawl.head import canonical_of
from idraft.db import dictionaries
from idraft.db.engine import create_engine, create_session_factory
from idraft.db.tables import crawl_links, crawl_pages, crawl_runs, provider_cost_events, urls
from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import CrawlOrder, OnPage, PostedCrawl
from idraft.storage.raw import ObjectStore, compress
from idraft.worker.app import HTTP_TIMEOUT, REDIS_TIMEOUT_SECONDS, _open_raw_store
from idraft.worker.assembly import dataforseo_client

Sessions = async_sessionmaker[AsyncSession]
Sleep = Callable[[float], Awaitable[None]]

DEFAULT_USER_AGENT: Final = "idraft-link-check/0.1 (+https://idraft.ai)"
BROWSER_MARKERS: Final = ("mozilla/5.0 (", "chrome/", "safari/")
MAX_REQUESTS_DEFAULT: Final = 102
MAX_REQUESTS_LIMIT: Final = 150
PAUSE_MIN: Final = 1.0
MAX_USD_LIMIT: Final = Decimal(5)
REQUEST_TIMEOUT_SECONDS: Final = 30.0
PAGE_MAX_BYTES: Final = 10 * 1024 * 1024
ROBOTS_MAX_BYTES: Final = 512 * 1024
REDIRECT_HOPS_MAX: Final = 3
CONSECUTIVE_STOP: Final = 3
REDIRECTS: Final = frozenset({301, 302, 303, 307, 308})
ROBOTS_OK: Final = frozenset({200, 404, 410})
BLOCKED_STATUSES: Final = (401, 403)
GONE_STATUSES: Final = frozenset({404, 410})
SUCCEEDED: Final = frozenset({"ready", "stopped_at_ceiling"})
LIST_SHOWN: Final = 10
REINGEST_PASSES_MAX: Final = 200
REINGEST_PAUSE_SECONDS: Final = 5.0
TITLE_SCAN_MAX: Final = 1_000_000
REPORT: Final = "fetch-report.json"
PROVENANCE: Final = "provenance.json"
EXIT_STOPPED: Final = 1
EXIT_REFUSED: Final = 2
_TITLE: Final = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
HTTP_CONNECTIONS: Final = 2
REDIS_CONNECTIONS: Final = 4
GIT_TIMEOUT_SECONDS: Final = 20
MAX_USD_DEFAULT: Final = Decimal("0.05")


class RefusedError(Exception):
    """A precondition does not hold. Nothing was sent to a site."""


def say(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _git(folder: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", "-C", str(folder), *arguments],
            capture_output=True,
            text=True,
            check=False,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        raise RefusedError("git could not be run to check where --out is") from None


def check_out_dir(out: Path) -> None:
    """A folder inside a git repository must be ignored by it: real pages are not committed.
    Run from `backend/`, `--out spikes/raw/<name>` is ignored (`backend/spikes/raw/`)."""
    target = out.resolve()
    anchor = next(folder for folder in (target, *target.parents) if folder.is_dir())
    if _git(anchor, "rev-parse", "--show-toplevel").returncode != 0:
        return
    # A file inside the folder: a rule for a folder (`raw/`) matches through its parent.
    ignored = _git(anchor, "check-ignore", "-q", "--", str(target / REPORT))
    if ignored.returncode == 1:
        raise RefusedError(f"--out {target} is inside the repository and is not ignored by git")
    if ignored.returncode != 0:
        raise RefusedError("git could not say whether --out is ignored")


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json(path: Path, body: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise RefusedError(f"{path.name} in --out is missing or is not JSON") from None


# What a run and its blocked pages are (database reads, by the worker role)


@dataclass(frozen=True, slots=True)
class BlockedPage:
    url_id: int
    url: str
    url_hash: bytes


def _host_of(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


async def _latest_run(sessions: Sessions, project_id: UUID) -> Row[Any]:
    """The project's latest crawl of any state; it must be a finished one."""
    async with sessions() as db:
        run = (
            await db.execute(
                select(
                    crawl_runs.c.id,
                    crawl_runs.c.workspace_id,
                    crawl_runs.c.project_id,
                    crawl_runs.c.state,
                )
                .where(crawl_runs.c.project_id == project_id)
                .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
                .limit(1)
            )
        ).one_or_none()
    if run is None:
        raise RefusedError(f"no crawl run for project {project_id}")
    return run


async def _finished_run(sessions: Sessions, project_id: UUID) -> Row[Any]:
    run = await _latest_run(sessions, project_id)
    if run.state not in SUCCEEDED:
        raise RefusedError(f"the latest crawl {run.id} is {run.state}, not a finished one")
    return run


async def _blocked_pages(
    sessions: Sessions, run: Row[Any], allow: frozenset[str]
) -> tuple[list[BlockedPage], int]:
    """The pages of the run that answered 401 or 403 and have no links, on an allowed host, and
    how many others there were (another host)."""
    async with sessions() as db:
        rows = (
            await db.execute(
                select(crawl_pages.c.url_id, crawl_pages.c.crawled_url, urls.c.url_hash)
                .join(urls, urls.c.id == crawl_pages.c.url_id)
                .where(
                    crawl_pages.c.run_id == run.id,
                    crawl_pages.c.workspace_id == run.workspace_id,
                    crawl_pages.c.status_code.in_(BLOCKED_STATUSES),
                    crawl_pages.c.links_state == "none",
                )
                .order_by(crawl_pages.c.url_id)
            )
        ).all()
    pages = [BlockedPage(row.url_id, row.crawled_url, bytes(row.url_hash)) for row in rows]
    kept = [page for page in pages if _host_of(page.url) in allow]
    return kept, len(pages) - len(kept)


# The fetch engine


class _FailedError(Exception):
    """A request that got no answer (connection, timeout). Carries the error class only."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


@dataclass(frozen=True, slots=True)
class _Answer:
    status: int
    location: str | None
    content_type: str
    body: bytes | None
    too_large: bool
    charset: str | None


@dataclass(slots=True)
class PageResult:
    url: str
    url_id: int
    requested_url: str
    status: int | None = None
    final_url: str | None = None
    size: int | None = None
    skipped: str | None = None
    fetched_at: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "url_id": self.url_id,
            "requested_url": self.requested_url,
            "status": self.status,
            "final_url": self.final_url,
            "bytes": self.size,
            "skipped": self.skipped,
            "fetched_at": self.fetched_at,
        }


Keep = Callable[[BlockedPage, str], Awaitable[None]]


def _decode(body: bytes, charset: str | None) -> str:
    try:
        return body.decode(charset or "utf-8", errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


class Fetcher:
    """Fetches the blocked pages one after the other under the rules in the module docstring."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        agent: str,
        allow: frozenset[str],
        max_requests: int,
        pause: float,
        sleep: Sleep,
    ) -> None:
        self._client = client
        self._agent = agent
        self._allow = allow
        self._max = max_requests
        self._pause = pause
        self._sleep = sleep
        self._headers = {"User-Agent": agent, "Accept": "text/html"}
        self._robots: dict[str, RobotFileParser] = {}
        self._sent = 0
        self._five_in_a_row = 0
        self._failed_in_a_row = 0
        self.requests = 0
        self.stopped: str | None = None

    async def _get(self, url: str, *, html_only: bool, limit: int) -> _Answer:
        """One GET, after the pause. The body is read only for a 200 (and, for a page, a text/html
        one), up to `limit` bytes of the decoded content."""
        if self._sent:
            await self._sleep(self._pause)
        self._sent += 1
        try:
            async with (
                asyncio.timeout(REQUEST_TIMEOUT_SECONDS),
                self._client.stream("GET", url, headers=self._headers) as response,
            ):
                status = response.status_code
                kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                where = response.headers.get("location")
                charset = response.charset_encoding
                if status != 200 or (html_only and kind != "text/html"):
                    return _Answer(status, where, kind, None, False, charset)
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > limit:
                        return _Answer(status, where, kind, None, True, charset)
                    chunks.append(chunk)
                return _Answer(status, where, kind, b"".join(chunks), False, charset)
        except (httpx.HTTPError, httpx.InvalidURL, TimeoutError, OSError) as failure:
            raise _FailedError(type(failure).__name__) from None
        finally:
            # No cookie survives a request.
            self._client.cookies.clear()

    async def _robots_for(self, host: str) -> RobotFileParser | None:
        """The host's robots.txt (read once). None, with `stopped` set, when it cannot be read as
        200, 404 or 410."""
        known = self._robots.get(host)
        if known is not None:
            return known
        url = f"https://{host}/robots.txt"
        try:
            answer = await self._get(url, html_only=False, limit=ROBOTS_MAX_BYTES)
        except _FailedError as failure:
            self.stopped = f"robots.txt of {host} could not be read ({failure.kind})"
            return None
        if answer.too_large:
            self.stopped = f"robots.txt of {host} is larger than {ROBOTS_MAX_BYTES} bytes"
            return None
        if answer.status not in ROBOTS_OK:
            self.stopped = f"robots.txt of {host} answered {answer.status}"
            return None
        parser = RobotFileParser()
        parser.parse(_decode(answer.body, answer.charset).splitlines() if answer.body else [])
        # Without this, `can_fetch` says no to everything.
        parser.modified()
        self._robots[host] = parser
        return parser

    async def prepare(self, pages: Sequence[BlockedPage]) -> None:
        """Read robots.txt of every host the pages are on, before any page."""
        for host in sorted({_host_of(page.url) for page in pages}):
            if await self._robots_for(host) is None:
                return

    async def _refusal(self, url: str) -> str | None:
        """Why the URL may not be fetched, or None."""
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https"):
            return "not an http or https address"
        host = (parts.hostname or "").lower()
        if host not in self._allow:
            return f"host {host or '(none)'} is not in the allow-list"
        robots = await self._robots_for(host)
        if robots is None:
            return "robots.txt not readable"
        if not robots.can_fetch(self._agent, url):
            return "disallowed by robots.txt"
        return None

    def _stop(self, reason: str) -> None:
        self.stopped = reason

    async def fetch(self, page: BlockedPage, keep: Keep) -> PageResult:
        requested = page.url[:-1] if page.url.endswith("?") else page.url
        result = PageResult(url=page.url, url_id=page.url_id, requested_url=requested)
        if self.stopped is not None:
            result.skipped = f"not reached: {self.stopped}"
            return result
        current = requested
        hops = 0
        while True:
            refusal = await self._refusal(current)
            if refusal is not None:
                result.skipped = f"redirect refused: {refusal}" if hops else refusal
                return result
            if self.requests >= self._max:
                self._stop(f"the request cap of {self._max} was reached")
                result.skipped = f"not reached: {self.stopped}"
                return result
            self.requests += 1
            result.fetched_at = _now()
            try:
                answer = await self._get(current, html_only=True, limit=PAGE_MAX_BYTES)
            except _FailedError as failure:
                self._five_in_a_row = 0
                self._failed_in_a_row += 1
                result.skipped = f"request failed: {failure.kind}"
                if self._failed_in_a_row >= CONSECUTIVE_STOP:
                    self._stop(f"{CONSECUTIVE_STOP} requests in a row failed")
                return result
            result.status = answer.status
            result.final_url = current
            if answer.status in (403, 429):
                self._stop(f"HTTP {answer.status} at {current}")
                result.skipped = f"HTTP {answer.status}: the tool stopped"
                return result
            if answer.status >= 500:
                self._failed_in_a_row = 0
                self._five_in_a_row += 1
                result.skipped = f"HTTP {answer.status}"
                if self._five_in_a_row >= CONSECUTIVE_STOP:
                    self._stop(f"{CONSECUTIVE_STOP} answers of 5xx in a row, the last at {current}")
                return result
            self._five_in_a_row = self._failed_in_a_row = 0
            if answer.status in REDIRECTS:
                if not answer.location:
                    result.skipped = "redirect without a Location"
                    return result
                if hops >= REDIRECT_HOPS_MAX:
                    result.skipped = f"more than {REDIRECT_HOPS_MAX} redirects"
                    return result
                hops += 1
                current = urldefrag(urljoin(current, answer.location)).url
                continue
            if answer.status in GONE_STATUSES:
                return result
            if answer.status != 200:
                result.skipped = f"HTTP {answer.status} is not kept"
            elif answer.content_type != "text/html":
                result.skipped = f"content type {answer.content_type or 'unknown'} is not text/html"
            elif answer.too_large or answer.body is None:
                result.skipped = f"larger than {PAGE_MAX_BYTES} bytes"
            else:
                html = _decode(answer.body, answer.charset)
                result.size = len(answer.body)
                await keep(page, html)
            return result


# fetch


def _check_empty(out: Path) -> None:
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise RefusedError(f"--out {out} exists and is not an empty folder")


def _require_raw_store(settings: Settings) -> None:
    if settings.r2_raw_endpoint is None:
        raise RefusedError("raw storage (R2_RAW_*) is not configured: pages are kept there")


async def _fetch(
    settings: Settings,
    sessions: Sessions,
    args: argparse.Namespace,
    transport: httpx.AsyncBaseTransport | None,
    sleep: Sleep,
) -> int:
    allow = frozenset(name.lower() for name in args.allow_host)
    check_out_dir(args.out)
    _check_empty(args.out)
    _require_raw_store(settings)
    run = await _finished_run(sessions, args.project)
    pages, elsewhere = await _blocked_pages(sessions, run, allow)
    say(f"run {run.id} state={run.state}: {len(pages)} blocked page(s) on allowed hosts")
    if elsewhere:
        say(f"{elsewhere} blocked page(s) on other hosts are left alone")
    if not pages:
        say("nothing to fetch")
        return 0
    if len(pages) > args.max_requests:
        say(f"more pages than --max-requests {args.max_requests}: the tool stops at the cap")
    results: list[PageResult] = []
    kept: list[BlockedPage] = []

    async with contextlib.AsyncExitStack() as resources:
        store = await resources.enter_async_context(_open_raw_store(settings, 1))
        client = await resources.enter_async_context(
            httpx.AsyncClient(
                transport=transport,
                timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS),
                limits=httpx.Limits(max_connections=1),
                follow_redirects=False,
                trust_env=False,
            )
        )
        fetcher = Fetcher(
            client,
            agent=args.user_agent,
            allow=allow,
            max_requests=args.max_requests,
            pause=args.pause_seconds,
            sleep=sleep,
        )

        async def keep(page: BlockedPage, html: str) -> None:
            data = html.encode()
            target = args.out / "html" / f"{page.url_id}.html"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            await store.put(html_key(run.project_id, page.url_hash), await _packed(data))
            kept.append(page)

        try:
            await fetcher.prepare(pages)
            if fetcher.stopped is not None:
                say(f"STOPPED before any page: {fetcher.stopped}")
            for number, page in enumerate(pages, start=1):
                result = await fetcher.fetch(page, keep)
                results.append(result)
                outcome = result.skipped or (
                    "recorded" if result.size is None else f"kept {result.size} bytes"
                )
                say(f"{number}/{len(pages)} status={result.status or '-'} {page.url} {outcome}")
        finally:
            _write_outputs(args, run, results, kept, fetcher)
        left = sum(1 for result in results if (result.skipped or "").startswith("not reached"))
        if fetcher.stopped is not None:
            say(f"STOPPED: {fetcher.stopped}; {left} page(s) not reached")
        say(
            f"requests={fetcher.requests} kept={len(kept)} "
            f"gone={sum(1 for r in results if r.status in GONE_STATUSES)} "
            f"skipped={sum(1 for r in results if r.skipped)}"
        )
        say(f"written to {args.out}: {REPORT}, {PROVENANCE}, html/")
        return EXIT_STOPPED if fetcher.stopped is not None else 0


async def _packed(data: bytes) -> bytes:
    return await asyncio.to_thread(compress, data)


def _write_outputs(
    args: argparse.Namespace,
    run: Row[Any],
    results: Sequence[PageResult],
    kept: Sequence[BlockedPage],
    fetcher: Fetcher,
) -> None:
    _write_json(
        args.out / REPORT,
        {
            "run_id": str(run.id),
            "project_id": str(run.project_id),
            "generated_at": _now(),
            "user_agent": args.user_agent,
            "max_requests": args.max_requests,
            "requests_made": fetcher.requests,
            "stopped": fetcher.stopped,
            "pages": [result.as_json() for result in results],
        },
    )
    _write_json(
        args.out / PROVENANCE,
        {
            "source": "fetched by spikes/s19_fetch_blocked.py, not by the crawl provider",
            "run_id": str(run.id),
            "project_id": str(run.project_id),
            "url_ids": [page.url_id for page in kept],
            "urls": {str(page.url_id): page.url for page in kept},
        },
    )


# list


async def _list(sessions: Sessions, args: argparse.Namespace) -> int:
    run = await _finished_run(sessions, args.project)
    pages, elsewhere = await _blocked_pages(
        sessions, run, frozenset(name.lower() for name in args.allow_host)
    )
    say(f"run {run.id} state={run.state}")
    say(f"blocked pages (401 or 403, no links) on allowed hosts: {len(pages)}")
    if elsewhere:
        say(f"on other hosts, left out: {elsewhere}")
    for page in pages[:LIST_SHOWN]:
        say(f"  {page.url}")
    if len(pages) > LIST_SHOWN:
        say(f"  ... and {len(pages) - LIST_SHOWN} more")
    return 0


# apply


def _admin_url(env_file: Path) -> str:
    """The `DATABASE_URL` line of the file, and nothing else of it."""
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        raise RefusedError("the admin env file could not be read") from None
    for line in lines:
        entry = line.strip().removeprefix("export ").strip()
        if entry.startswith("DATABASE_URL="):
            value = entry.removeprefix("DATABASE_URL=").strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            return value
    raise RefusedError("the admin env file has no DATABASE_URL line")


def _identity(sqlalchemy_url: str) -> tuple[str, int, str | None]:
    url = make_url(sqlalchemy_url)
    return ((url.host or "").lower(), url.port or 5432, url.database)


def _title_of(html: str) -> str | None:
    found = _TITLE.search(html[:TITLE_SCAN_MAX])
    title = clean_text(unescape(found.group(1)), limit=1000) if found else ""
    return title or None


@dataclass(frozen=True, slots=True)
class _Fix:
    """A page the stored row is corrected for: its answer, its HTML (a 200), and the address the
    HTML came from."""

    url_id: int
    status: int
    html: str | None
    base: str


def _corrections(out: Path, report: Mapping[str, Any], allow: frozenset[str]) -> list[_Fix]:
    found: list[_Fix] = []
    for entry in report["pages"]:
        url = str(entry["url"])
        if _host_of(url) not in allow:
            raise RefusedError(f"the report has a page on a host not in --allow-host: {url}")
        status, skipped = entry.get("status"), entry.get("skipped")
        if skipped is not None or not isinstance(status, int):
            continue
        if status == 200:
            file = out / "html" / f"{int(entry['url_id'])}.html"
            try:
                html = file.read_text(encoding="utf-8")
            except OSError:
                raise RefusedError(f"the HTML of page {entry['url_id']} is missing") from None
            found.append(_Fix(int(entry["url_id"]), 200, html, str(entry.get("final_url") or url)))
        elif status in GONE_STATUSES:
            found.append(_Fix(int(entry["url_id"]), status, None, url))
    return found


async def _apply(settings: Settings, args: argparse.Namespace) -> int:
    allow = frozenset(name.lower() for name in args.allow_host)
    report = _read_json(args.out / REPORT)
    if not isinstance(report, dict) or not isinstance(report.get("pages"), list):
        raise RefusedError(f"{REPORT} is not a report of this tool")
    admin = _admin_url(args.admin_env_file)
    try:
        admin_url = to_sqlalchemy_url(admin)
    except ValueError:
        raise RefusedError("DATABASE_URL of the admin env file is not a PostgreSQL URL") from None
    if _identity(admin_url) != _identity(settings.sqlalchemy_url):
        raise RefusedError("the admin DATABASE_URL is not the database of the worker settings")
    fixes = _corrections(args.out, report, allow)
    if not fixes:
        raise RefusedError("the report holds no page to correct (no 200, 404 or 410 answer)")
    engine = create_async_engine(admin_url, pool_size=1, max_overflow=0, hide_parameters=True)
    try:
        async with AsyncSession(engine) as db, db.begin():
            await _apply_in(db, args, report, fixes)
    finally:
        await engine.dispose()
    return 0


async def _apply_in(
    db: AsyncSession, args: argparse.Namespace, report: Mapping[str, Any], fixes: Sequence[_Fix]
) -> None:
    latest: UUID | None = (
        await db.execute(
            select(crawl_runs.c.id)
            .where(crawl_runs.c.project_id == args.project)
            .order_by(crawl_runs.c.created_at.desc(), crawl_runs.c.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest is None or str(latest) != report["run_id"]:
        raise RefusedError("the report is not of the latest crawl of the project")
    run = (
        await db.execute(
            select(
                crawl_runs.c.id,
                crawl_runs.c.workspace_id,
                crawl_runs.c.state,
                crawl_runs.c.links_dropped_at,
            )
            .where(crawl_runs.c.id == latest)
            .with_for_update()
        )
    ).one()
    if run.state not in SUCCEEDED:
        raise RefusedError(f"the crawl {run.id} is {run.state}: only a finished one is corrected")
    await db.execute(
        text("SELECT set_config('app.workspace_id', :workspace_id, true)"),
        {"workspace_id": str(run.workspace_id)},
    )
    changed = gone = 0
    for fix in fixes:
        url_id, html = fix.url_id, fix.html
        values: dict[str, Any]
        if html is None:
            values = {"status_code": fix.status, "resource_type": "broken", "links_state": "none"}
        else:
            canonical = _canonical(canonical_of(html, fix.base))
            canonical_id = None
            if canonical is not None:
                canonical_id = (await dictionaries.urls_for(db, [canonical]))[canonical.url_hash].id
            elsewhere = canonical_id is not None and canonical_id != url_id
            values = {
                "status_code": 200,
                "resource_type": "html",
                "links_state": "waiting",
                "title": _title_of(html),
                "canonical_url_id": canonical_id,
                "is_indexable": not elsewhere,
                "non_indexable_reason": "canonical" if elsewhere else None,
            }
        # Only a page that is still refused and has no links: a second `apply` changes nothing,
        # and a page that already has links is never made to wait for them again.
        done = await db.execute(
            update(crawl_pages)
            .where(
                crawl_pages.c.run_id == run.id,
                crawl_pages.c.workspace_id == run.workspace_id,
                crawl_pages.c.url_id == url_id,
                crawl_pages.c.status_code.in_(BLOCKED_STATUSES),
                crawl_pages.c.links_state == "none",
            )
            .values(**values)
            .returning(crawl_pages.c.url_id)
        )
        if done.scalar_one_or_none() is not None:
            changed += 1
            gone += html is None
    if not changed:
        raise RefusedError("no page needed a correction: they are not refused any more")
    await db.execute(
        update(crawl_runs)
        .where(crawl_runs.c.id == run.id, crawl_runs.c.workspace_id == run.workspace_id)
        .values(
            state="processing",
            ingest_phase="links",
            error_code=None,
            error_message=None,
            finished_at=None,
            ingest_failures=0,
            links_dropped_at=None,
        )
    )
    missing: bool = (
        await db.execute(
            text("SELECT to_regclass('seo.crawl_links_' || replace(:run_id, '-', '')) IS NULL"),
            {"run_id": str(run.id)},
        )
    ).scalar_one()
    if missing:
        await db.execute(text("SELECT seo.add_crawl_links_partition(:run_id)"), {"run_id": run.id})
    say(f"run {run.id}: {changed - gone} page(s) served, {gone} gone; the crawl is `processing`")
    if missing:
        say("the link partition had been dropped and was made again: older links are not back")
    say("next: `reingest` (the worker must not be running)")


# reingest


def _not_sent(message: str) -> ProviderCallError:
    return ProviderCallError(ProviderError(kind=ProviderErrorKind.NOT_SENT, message=message))


class OwnHtmlOnPage(OnPage):
    """The worker's On-Page adapter that serves, for the pages this tool fetched, their HTML from
    `--out/html`, and asks the provider (a free read) for any other. It never posts a crawl and
    never stops one."""

    def __init__(self, client: DataForSeoClient, files: Mapping[str, Path]) -> None:
        super().__init__(client)
        self._files = files

    async def raw_html(self, task_id: str, url: str) -> str | None:
        file = self._files.get(url)
        if file is None:
            return await super().raw_html(task_id, url)
        return await asyncio.to_thread(file.read_text, "utf-8")

    async def post(self, order: CrawlOrder) -> PostedCrawl:
        raise _not_sent("this tool never posts a crawl")

    async def force_stop(self, task_id: str) -> None:
        raise _not_sent("this tool never stops a crawl")


def _own_files(out: Path, run: Row[Any], allow: frozenset[str]) -> dict[str, Path]:
    provenance = _read_json(out / PROVENANCE)
    if (
        not isinstance(provenance, dict)
        or provenance.get("run_id") != str(run.id)
        or not isinstance(provenance.get("urls"), dict)
    ):
        raise RefusedError(f"{PROVENANCE} is not of the latest crawl of the project")
    files: dict[str, Path] = {}
    for url_id, url in provenance["urls"].items():
        if _host_of(str(url)) not in allow:
            raise RefusedError(f"{PROVENANCE} has a page on a host not in --allow-host: {url}")
        file = out / "html" / f"{int(url_id)}.html"
        if not file.is_file():
            raise RefusedError(f"the HTML of page {url_id} is missing")
        files[str(url)] = file
    return files


async def _counts(sessions: Sessions, run_id: UUID) -> list[str]:
    async with sessions() as db:
        by_status = (
            await db.execute(
                select(crawl_pages.c.status_code, func.count())
                .where(crawl_pages.c.run_id == run_id)
                .group_by(crawl_pages.c.status_code)
                .order_by(crawl_pages.c.status_code)
            )
        ).all()
        by_scope = (
            await db.execute(
                select(crawl_links.c.scope, func.count())
                .where(crawl_links.c.run_id == run_id)
                .group_by(crawl_links.c.scope)
                .order_by(crawl_links.c.scope)
            )
        ).all()
        deep = (
            await db.execute(
                select(
                    func.count().filter(crawl_pages.c.click_depth.is_not(None)),
                    func.count().filter(crawl_pages.c.is_orphan),
                ).where(crawl_pages.c.run_id == run_id)
            )
        ).one()
    return [
        "pages by status: " + " ".join(f"{code if code else 'none'}={n}" for code, n in by_status),
        "links by scope: " + " ".join(f"{scope}={n}" for scope, n in by_scope),
        f"pages with click_depth: {deep[0]}, orphans: {deep[1]}",
    ]


async def _events_cost(sessions: Sessions, run_id: UUID) -> Decimal:
    async with sessions() as db:
        spent: Decimal | int = (
            await db.execute(
                select(func.coalesce(func.sum(provider_cost_events.c.cost_usd), 0)).where(
                    provider_cost_events.c.run_id == run_id
                )
            )
        ).scalar_one()
    return Decimal(spent)


async def _run_state(sessions: Sessions, run_id: UUID) -> tuple[str, str | None]:
    async with sessions() as db:
        row = (
            await db.execute(
                select(crawl_runs.c.state, crawl_runs.c.ingest_phase).where(
                    crawl_runs.c.id == run_id
                )
            )
        ).one()
    return row.state, row.ingest_phase


async def _reingest(
    settings: Settings,
    sessions: Sessions,
    args: argparse.Namespace,
    transport: httpx.AsyncBaseTransport | None,
    sleep: Sleep,
) -> int:
    cap: Decimal = args.max_usd
    if cap > MAX_USD_LIMIT:
        raise RefusedError(f"--max-usd must be at most {MAX_USD_LIMIT}")
    if settings.dataforseo_credentials is None:
        raise RefusedError("the DataForSEO credentials are not set")
    _require_raw_store(settings)
    run = await _latest_run(sessions, args.project)
    if run.state != "processing":
        raise RefusedError(f"the latest crawl {run.id} is {run.state}: run `apply` first")
    files = _own_files(args.out, run, frozenset(name.lower() for name in args.allow_host))
    say(f"run {run.id} is processing; {len(files)} page(s) have HTML fetched by this tool")
    say("check max-usd: the cost events of the run must not grow by more than " + str(cap))
    task = CrawlIngestTask(workspace_id=run.workspace_id, run_id=run.id)
    before_cost = await _events_cost(sessions, run.id)
    for line in ["before", *await _counts(sessions, run.id)]:
        say(line)
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
        store: ObjectStore = await resources.enter_async_context(_open_raw_store(settings, 1))
        client = dataforseo_client(settings, http, redis)
        if client is None:
            raise RefusedError("the DataForSEO credentials are not set")
        on_page = OwnHtmlOnPage(client, files)
        code = await _passes(sessions, on_page, store, task, before_cost, cap, sleep)
    for line in ["after", *await _counts(sessions, run.id)]:
        say(line)
    return code


async def _passes(
    sessions: Sessions,
    on_page: OwnHtmlOnPage,
    store: ObjectStore,
    task: CrawlIngestTask,
    before_cost: Decimal,
    cap: Decimal,
    sleep: Sleep,
) -> int:
    state: str = "processing"
    for number in range(1, REINGEST_PASSES_MAX + 1):
        outcome = await ingest_run(
            sessions,
            on_page,
            store,
            task,
            deadline=time.monotonic() + PASS_TIME.total_seconds(),
        )
        state, phase = await _run_state(sessions, task.run_id)
        say(
            f"pass {number}: phase={phase or '-'} steps={outcome.steps} failed={outcome.failed} "
            f"busy={outcome.busy} state={state}"
        )
        if outcome.busy:
            say("another pass holds the crawl (is the worker running?): stopped")
            return EXIT_STOPPED
        grown = await _events_cost(sessions, task.run_id) - before_cost
        if grown > cap:
            say(f"CAP EXCEEDED: the run's cost events grew by {grown}; stopped, nothing cancelled")
            return EXIT_STOPPED
        if state != "processing":
            break
        if number < REINGEST_PASSES_MAX:
            await sleep(REINGEST_PAUSE_SECONDS)
    say(f"finished: run {task.run_id} state={state}")
    return 0 if state in SUCCEEDED else EXIT_STOPPED


# Arguments and entry point


def _usd(value: str) -> Decimal:
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise argparse.ArgumentTypeError("not a number") from None
    if not number.is_finite() or number <= 0:
        raise argparse.ArgumentTypeError("must be above 0")
    return number


def _max_requests(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("not a number") from None
    if not 1 <= number <= MAX_REQUESTS_LIMIT:
        raise argparse.ArgumentTypeError(f"must be 1 to {MAX_REQUESTS_LIMIT}")
    return number


def _pause(value: str) -> float:
    try:
        number = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("not a number") from None
    if not math.isfinite(number) or number < PAUSE_MIN:
        raise argparse.ArgumentTypeError(f"must be at least {PAUSE_MIN} seconds")
    return number


def _agent(value: str) -> str:
    lowered = value.lower()
    if not value.strip() or any(marker in lowered for marker in BROWSER_MARKERS):
        raise argparse.ArgumentTypeError(
            "must be an honest user agent of this tool, not one that looks like a browser"
        )
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name: str, help_: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=help_)
        sub.add_argument("--project", type=UUID, required=True)
        sub.add_argument(
            "--allow-host",
            action="append",
            required=True,
            help="a host this tool may ask (repeatable)",
        )
        return sub

    command("list", "show the latest crawl's blocked pages (no network)")
    fetch = command("fetch", "fetch the blocked pages from the site, lightly")
    fetch.add_argument("--max-requests", type=_max_requests, default=MAX_REQUESTS_DEFAULT)
    fetch.add_argument("--pause-seconds", type=_pause, default=1.5)
    fetch.add_argument("--user-agent", type=_agent, default=DEFAULT_USER_AGENT)
    fetch.add_argument("--out", type=Path, required=True, help="a new or empty folder")
    apply = command("apply", "correct the stored page rows from the report (admin database role)")
    apply.add_argument("--out", type=Path, required=True)
    apply.add_argument("--admin-env-file", type=Path, required=True)
    reingest = command("reingest", "run the real ingest on the corrected crawl")
    reingest.add_argument("--out", type=Path, required=True)
    reingest.add_argument(
        "--max-usd",
        type=_usd,
        default=MAX_USD_DEFAULT,
        help=f"at most 5 (default {MAX_USD_DEFAULT})",
    )
    return parser


async def main(
    argv: Sequence[str] | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    sleep: Sleep = asyncio.sleep,
) -> int:
    """`transport` is for tests: the HTTP transport of the site (`fetch`) or of the provider
    (`reingest`); `sleep` replaces the pauses."""
    try:
        args = _parser().parse_args(argv)
        settings = load_settings()
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else EXIT_REFUSED
    engine = create_engine(settings)
    sessions = create_session_factory(engine)
    try:
        if settings.app_env != "local":
            raise RefusedError(
                f"APP_ENV is {settings.app_env}: this tool runs only against a local database"
            )
        if args.command == "list":
            return await _list(sessions, args)
        if args.command == "fetch":
            return await _fetch(settings, sessions, args, transport, sleep)
        if args.command == "apply":
            return await _apply(settings, args)
        return await _reingest(settings, sessions, args, transport, sleep)
    except RefusedError as refusal:
        say(f"refused: {refusal}")
        return EXIT_REFUSED
    except Exception as failure:
        # The class only: a message may quote a connection string, an address or a key.
        say(f"failed: {type(failure).__name__}")
        return EXIT_STOPPED
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
