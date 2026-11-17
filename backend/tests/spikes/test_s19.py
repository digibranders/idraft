"""S-19: the tool that fetches the pages a crawl was refused, and reads them in again. The site is
an `httpx.MockTransport`, the provider is the in-repo stand-in behind the real On-Page adapter, the
database and the object store are the test ones. No network."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_ingest import IngestOutcome, html_key, ingest_run
from idraft.config.settings import load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import CrawlOrder
from idraft.storage.raw import RawStore, decompress, s3_client
from spikes import s19_fetch_blocked
from spikes.s19_fetch_blocked import DEFAULT_USER_AGENT, OwnHtmlOnPage, main
from tests.api.auth.support import Workspace, execute, fetch, fetchrow
from tests.api.internal_links.support import seed_crawl
from tests.collectors.crawl_support import (
    E2E_TASK,
    SITE,
    FakeOnPage,
    clear_crawls,
    page_item,
    serve,
    synthetic_site,
)
from tests.collectors.test_crawl_ingest import _crawled, _ingest, _pages, _snapshot
from tests.conftest import ObjectServer, PostgresServer
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
)

Sessions = async_sessionmaker[AsyncSession]
Reply = Callable[[httpx.Request], httpx.Response]
Cli = Callable[..., Awaitable[tuple[int, str]]]

REPOSITORY = Path(__file__).resolve().parents[3]
WORKER_PASSWORD = "worker-pw"
ADMIN_PASSWORD = "migrator-pw"
HTML = {"content-type": "text/html; charset=utf-8"}
ROBOTS_OPEN = "User-agent: *\nAllow: /\n"
TASK_POST = "/v3/on_page/task_post"
FORCE_STOP = "/v3/on_page/force_stop"
RAW_HTML = "/v3/on_page/raw_html"
PAUSE = 1.5


def reply(
    status: int = 200, body: str | bytes = "<html><body>ok</body></html>", **headers: str
) -> Reply:
    def make(_: httpx.Request) -> httpx.Response:
        merged = {**HTML, **{name.replace("_", "-"): value for name, value in headers.items()}}
        return httpx.Response(status, content=body, headers=merged)

    return make


def failing(error: type[httpx.TransportError]) -> Reply:
    def raiser(request: httpx.Request) -> httpx.Response:
        raise error("no answer", request=request)

    return raiser


class FakeSite:
    """The refusing site, now answering: by path (with its query), then from a script of replies
    given in order to the page requests, then a plain 200 page. It keeps every request."""

    def __init__(self, robots: tuple[int, str] = (200, ROBOTS_OPEN)) -> None:
        self.robots = robots
        self.routes: dict[str, Reply] = {}
        self.script: list[Reply] = []
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.raw_path.decode()
        if path == "/robots.txt":
            status, body = self.robots
            return httpx.Response(status, text=body, headers={"content-type": "text/plain"})
        if self.script:
            return self.script.pop(0)(request)
        return self.routes.get(path, reply())(request)

    @property
    def asked(self) -> list[str]:
        """The paths of the page requests, in order (robots.txt is not one)."""
        return [r.url.raw_path.decode() for r in self.requests if r.url.path != "/robots.txt"]


@dataclass(frozen=True)
class Crawl:
    workspace: Workspace
    project: uuid.UUID
    run_id: uuid.UUID
    provider: FakeOnPage


async def blocked_crawl(
    pg: PostgresServer,
    sessions: Sessions,
    *,
    blocked: Sequence[str] = ("/", "/blog"),
    extra: Sequence[str] = (),
) -> Crawl:
    """The synthetic site crawled to `ready` with the pages `blocked` answering 403 (no HTML, no
    links: as the real crawl of eventussecurity.com), and `extra` more pages that did too."""
    on_page = synthetic_site()
    items = []
    for item in on_page.page_items:
        path = item.url.removeprefix(SITE)
        if path in blocked:
            item = item.model_copy(update={"status_code": 403, "resource_type": "broken"})
            del on_page.html[item.url]
        items.append(item)
    on_page.page_items = [*items, *(page_item(path, 403) for path in extra)]
    crawled = await _crawled(pg, sessions, on_page)
    await _ingest(sessions, on_page, None, crawled.task)
    # The stand-in provider answers about this task only.
    await execute(
        pg,
        "UPDATE seo.crawl_runs SET provider_task_id = $1 WHERE id = $2",
        E2E_TASK,
        crawled.task.run_id,
    )
    state = (
        await fetchrow(pg, "SELECT state FROM seo.crawl_runs WHERE id = $1", crawled.task.run_id)
    )["state"]
    assert state == "ready"
    return Crawl(crawled.workspace, crawled.project, crawled.task.run_id, on_page)


@pytest.fixture(autouse=True)
async def _no_other_crawls(migrated: PostgresServer) -> None:
    await clear_crawls(migrated)


@pytest.fixture
async def bucket(object_server: ObjectServer) -> str:
    name = f"raw-{uuid.uuid4().hex[:12]}"
    async with s3_client(
        endpoint=object_server.endpoint,
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
    ) as client:
        await client.create_bucket(Bucket=name)
    return name


@pytest.fixture
def secrets(object_server: ObjectServer) -> list[str]:
    """Values that must never be printed or written."""
    return [PASSWORD, LOGIN, WORKER_PASSWORD, ADMIN_PASSWORD, object_server.secret_access_key]


@pytest.fixture(autouse=True)
def environment(
    monkeypatch: pytest.MonkeyPatch,
    migrated: PostgresServer,
    redis_url: str,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    """The worker's environment, as `uv run --env-file` would give it, for a local database."""
    values = {
        "PROCESS_ROLE": "worker",
        "APP_ENV": "local",
        "APP_ORIGIN": "http://localhost:3000",
        "DATABASE_URL": migrated.url("app_worker"),
        "REDIS_URL": redis_url,
        "DATAFORSEO_LOGIN": LOGIN,
        "DATAFORSEO_PASSWORD": PASSWORD,
        "R2_RAW_ENDPOINT": object_server.endpoint,
        "R2_RAW_BUCKET": bucket,
        "R2_RAW_ACCESS_KEY_ID": object_server.access_key_id,
        "R2_RAW_SECRET_ACCESS_KEY": object_server.secret_access_key,
        "DB_POOL_SIZE": "4",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
async def worker_db(environment: None) -> AsyncIterator[Sessions]:
    engine = create_engine(load_settings())
    yield create_session_factory(engine)
    await engine.dispose()


@pytest.fixture
def sleeps() -> list[float]:
    return []


@pytest.fixture
def cli(capsys: pytest.CaptureFixture[str], secrets: list[str], sleeps: list[float]) -> Cli:
    async def call(*argv: str, transport: httpx.MockTransport | None = None) -> tuple[int, str]:
        async def sleep(seconds: float) -> None:
            sleeps.append(seconds)

        code = await main(list(argv), transport=transport, sleep=sleep)
        captured = capsys.readouterr()
        text = captured.out + captured.err
        for secret in secrets:
            assert secret not in text
        return code, text

    return call


@pytest.fixture
def site() -> FakeSite:
    return FakeSite()


def args(crawl: Crawl, command: str, *extra: str) -> tuple[str, ...]:
    return (command, "--project", str(crawl.project), "--allow-host", "example.com", *extra)


def fetch_args(crawl: Crawl, out: Path, *extra: str) -> tuple[str, ...]:
    return args(crawl, "fetch", "--out", str(out), *extra)


def admin_file(tmp_path: Path, url: str, *, lines: Sequence[str] = ()) -> Path:
    path = tmp_path / "admin.env"
    path.write_text("\n".join([*lines, f"DATABASE_URL={url}"]) + "\n", encoding="utf-8")
    return path


def report_of(out: Path) -> dict[str, Any]:
    body: dict[str, Any] = json.loads((out / "fetch-report.json").read_text(encoding="utf-8"))
    return body


def entries(out: Path) -> dict[str, dict[str, Any]]:
    """The report's pages by URL."""
    return {entry["url"]: entry for entry in report_of(out)["pages"]}


# list


async def test_list_shows_the_blocked_pages_and_sends_nothing(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(10)])

    code, out = await cli(*args(crawl, "list"), transport=httpx.MockTransport(site))

    assert code == 0
    assert "on allowed hosts: 12" in out
    assert out.count("  https://example.com/") == 10
    assert "and 2 more" in out
    assert site.requests == []


async def test_list_leaves_out_a_host_that_is_not_allowed(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    code, out = await cli("list", "--project", str(crawl.project), "--allow-host", "other.example")

    assert code == 0
    assert "on allowed hosts: 0" in out
    assert "on other hosts, left out: 2" in out


async def test_a_command_needs_the_allow_list(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    code, _ = await cli("list", "--project", str(crawl.project))

    assert code == 2


# fetch: what it stores


async def test_fetch_keeps_a_page_in_the_folder_and_the_store_and_reports_it(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    sleeps: list[float],
    tmp_path: Path,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site.routes["/"] = reply(body="<html><head><title>Home é</title></head></html>")
    out_dir = tmp_path / "out"

    code, out = await cli(*fetch_args(crawl, out_dir), transport=httpx.MockTransport(site))

    assert code == 0, out
    # robots.txt first, then the two pages by their exact URLs, one at a time with the pause.
    assert site.requests[0].url.path == "/robots.txt"
    assert [r.url.path for r in site.requests].count("/robots.txt") == 1
    assert sorted(site.asked) == ["/", "/blog"]
    assert sleeps == [PAUSE] * (len(site.requests) - 1)
    report = report_of(out_dir)
    home = entries(out_dir)[f"{SITE}/"]
    assert (home["status"], home["final_url"], home["skipped"]) == (200, f"{SITE}/", None)
    assert home["bytes"] == len("<html><head><title>Home é</title></head></html>".encode())
    assert home["fetched_at"] is not None
    assert (report["requests_made"], report["stopped"]) == (2, None)
    # The folder, the store (the key and the compression ingest uses) and provenance agree.
    saved = (out_dir / "html" / f"{home['url_id']}.html").read_bytes()
    assert saved == "<html><head><title>Home é</title></head></html>".encode()
    row = await fetchrow(migrated, "SELECT url_hash FROM core.urls WHERE id = $1", home["url_id"])
    async with s3_client(
        endpoint=object_server.endpoint,
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
    ) as client:
        packed = await RawStore(client, bucket).get(html_key(crawl.project, bytes(row["url_hash"])))
    assert decompress(packed) == saved
    provenance = json.loads((out_dir / "provenance.json").read_text(encoding="utf-8"))
    assert sorted(provenance["url_ids"]) == sorted(e["url_id"] for e in report["pages"])
    assert provenance["run_id"] == str(crawl.run_id)
    assert provenance["urls"][str(home["url_id"])] == f"{SITE}/"


async def test_fetch_sends_only_the_honest_agent_and_accept_and_keeps_no_cookie(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site.routes["/"] = reply(set_cookie="session=abc; Path=/")
    site.routes["/blog"] = reply(set_cookie="session=def; Path=/")

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert "idraft" in DEFAULT_USER_AGENT
    assert len(site.requests) == 3
    for request in site.requests:
        assert request.headers["user-agent"] == DEFAULT_USER_AGENT
        assert request.headers["accept"] == "text/html"
        # What the HTTP library adds for any request; nothing else, and no cookie.
        extra = set(request.headers.keys()) - {"user-agent", "accept", "host", "accept-encoding"}
        assert extra <= {"connection"}


async def test_fetch_uses_the_agent_it_is_given_when_it_is_honest(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    code, _ = await cli(
        *fetch_args(crawl, tmp_path / "out", "--user-agent", "idraft-test/9"),
        transport=httpx.MockTransport(site),
    )

    assert code == 0
    assert {r.headers["user-agent"] for r in site.requests} == {"idraft-test/9"}


async def test_the_url_is_fetched_as_stored_but_without_a_trailing_question_mark(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/",), extra=["/contact?", "/docs/"])

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert sorted(site.asked) == ["/", "/contact", "/docs/"]
    found = entries(tmp_path / "out")
    # One page, one request; the report keeps the URL as the crawl stored it.
    assert found[f"{SITE}/contact?"]["requested_url"] == f"{SITE}/contact"
    assert found[f"{SITE}/docs/"]["status"] == 200


async def test_a_page_that_is_gone_is_recorded_and_not_kept(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site.routes["/blog"] = reply(404, body="not found")
    site.routes["/"] = reply(410, body="gone")

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    found = entries(tmp_path / "out")
    assert {(e["status"], e["skipped"], e["bytes"]) for e in found.values()} == {
        (404, None, None),
        (410, None, None),
    }
    assert not (tmp_path / "out" / "html").exists()
    provenance = json.loads((tmp_path / "out" / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["url_ids"] == []


@pytest.mark.parametrize(
    ("answer", "word"),
    [
        (reply(200, body="{}", content_type="application/json"), "not text/html"),
        (reply(200, body=b"a" * (10 * 1024 * 1024 + 1)), "larger than"),
        (reply(401), "401"),
        (reply(204, body=""), "204"),
    ],
)
async def test_only_a_small_html_page_with_status_200_is_kept(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    answer: Reply,
    word: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/",))
    site.routes["/"] = answer

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    (entry,) = entries(tmp_path / "out").values()
    assert word in entry["skipped"]
    assert not (tmp_path / "out" / "html").exists()


# fetch: robots.txt


async def test_a_url_robots_txt_disallows_is_skipped_and_never_fetched(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site = FakeSite(robots=(200, "User-agent: *\nDisallow: /blog\n"))

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == ["/"]
    skipped = entries(tmp_path / "out")[f"{SITE}/blog"]
    assert skipped["skipped"] == "disallowed by robots.txt"
    assert skipped["status"] is None
    assert "disallowed by robots.txt" in out


async def test_a_rule_for_this_tools_own_agent_is_honoured(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site = FakeSite(robots=(200, "User-agent: idraft-link-check\nDisallow: /\n"))

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == []
    assert {e["skipped"] for e in entries(tmp_path / "out").values()} == {
        "disallowed by robots.txt"
    }


@pytest.mark.parametrize("status", [404, 410])
async def test_a_site_with_no_robots_txt_is_open(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, tmp_path: Path, status: int
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site = FakeSite(robots=(status, "none"))

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert sorted(site.asked) == ["/", "/blog"]


@pytest.mark.parametrize("status", [500, 503, 403, 429, 401, 301])
async def test_a_robots_txt_that_cannot_be_read_stops_the_tool_before_any_page(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, tmp_path: Path, status: int
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    site = FakeSite(robots=(status, "nope"))

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 1
    assert [r.url.path for r in site.requests] == ["/robots.txt"]
    assert "STOPPED before any page" in out
    assert str(status) in out
    found = entries(tmp_path / "out")
    assert all(e["skipped"].startswith("not reached") for e in found.values())
    assert report_of(tmp_path / "out")["requests_made"] == 0


async def test_a_robots_txt_that_cannot_be_reached_stops_the_tool_before_any_page(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, tmp_path: Path, site: FakeSite
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    def refuse_robots(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            raise httpx.ConnectError("no route", request=request)
        return site(request)

    code, out = await cli(
        *fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(refuse_robots)
    )

    assert code == 1
    assert site.requests == []
    assert "ConnectError" in out


# fetch: the cap, redirects, the pause


async def test_the_cap_stops_at_exactly_that_many_page_requests(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(10)])

    code, out = await cli(
        *fetch_args(crawl, tmp_path / "out", "--max-requests", "3"),
        transport=httpx.MockTransport(site),
    )

    assert code == 1
    assert len(site.asked) == 3
    assert "request cap of 3" in out
    assert "9 page(s) not reached" in out
    report = report_of(tmp_path / "out")
    assert report["requests_made"] == 3
    left = [e for e in report["pages"] if (e["skipped"] or "").startswith("not reached")]
    assert len(left) == 9


async def test_every_redirect_hop_counts_against_the_cap(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/",))
    site.routes["/"] = reply(301, location="/a")
    site.routes["/a"] = reply(301, location="/b")
    site.routes["/b"] = reply(200)

    code, out = await cli(
        *fetch_args(crawl, tmp_path / "out", "--max-requests", "2"),
        transport=httpx.MockTransport(site),
    )

    assert code == 1
    assert site.asked == ["/", "/a"]
    assert "request cap of 2" in out
    (entry,) = entries(tmp_path / "out").values()
    assert (entry["status"], entry["final_url"]) == (301, f"{SITE}/a")
    assert not (tmp_path / "out" / "html").exists()


async def test_a_redirect_inside_the_site_stores_under_the_original_url_with_the_final_one(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/blog",))
    site.routes["/blog"] = reply(301, location="https://example.com/blog/new")
    site.routes["/blog/new"] = reply(302, location="/blog/newer#top")
    site.routes["/blog/newer"] = reply(200, body="<html>final</html>")

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == ["/blog", "/blog/new", "/blog/newer"]
    entry = entries(tmp_path / "out")[f"{SITE}/blog"]
    assert (entry["status"], entry["final_url"]) == (200, f"{SITE}/blog/newer")
    kept = tmp_path / "out" / "html" / f"{entry['url_id']}.html"
    assert kept.read_text(encoding="utf-8") == "<html>final</html>"


async def test_three_redirect_hops_are_followed_and_a_fourth_is_not(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/blog",))
    for here, there in (("/blog", "/r1"), ("/r1", "/r2"), ("/r2", "/r3"), ("/r3", "/r4")):
        site.routes[here] = reply(301, location=there)
    site.routes["/r4"] = reply(200)

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == ["/blog", "/r1", "/r2", "/r3"]
    (entry,) = entries(tmp_path / "out").values()
    assert entry["skipped"] == "more than 3 redirects"

    # With one hop fewer the same chain ends in the page.
    site.requests.clear()
    site.routes["/r3"] = reply(200)

    code, _ = await cli(*fetch_args(crawl, tmp_path / "again"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == ["/blog", "/r1", "/r2", "/r3"]
    (entry,) = entries(tmp_path / "again").values()
    assert (entry["status"], entry["skipped"]) == (200, None)


@pytest.mark.parametrize(
    ("location", "word"),
    [
        ("https://evil.example/x", "allow-list"),
        ("https://www.example.com/x", "allow-list"),
        ("ftp://example.com/x", "not an http"),
        ("/secret/page", "disallowed by robots.txt"),
    ],
)
async def test_a_redirect_to_another_host_or_a_url_robots_txt_disallows_is_refused(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    tmp_path: Path,
    location: str,
    word: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/blog",))
    site = FakeSite(robots=(200, "User-agent: *\nDisallow: /secret\n"))
    site.routes["/blog"] = reply(302, location=location)

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == ["/blog"]
    assert {r.url.host for r in site.requests} == {"example.com"}
    (entry,) = entries(tmp_path / "out").values()
    assert entry["skipped"].startswith("redirect refused")
    assert word in entry["skipped"]
    assert entry["status"] == 302


async def test_the_second_hop_to_another_host_is_refused(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/blog",))
    site.routes["/blog"] = reply(301, location="/mid")
    site.routes["/mid"] = reply(301, location="https://evil.example/x")

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert site.asked == ["/blog", "/mid"]
    assert {r.url.host for r in site.requests} == {"example.com"}
    (entry,) = entries(tmp_path / "out").values()
    assert entry["skipped"].startswith("redirect refused")
    assert (entry["status"], entry["final_url"]) == (301, f"{SITE}/mid")


async def test_no_file_of_the_output_holds_a_secret(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    secrets: list[str],
    redis_url: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    files = [file for file in (tmp_path / "out").rglob("*") if file.is_file()]
    assert len(files) >= 3
    for file in files:
        text = file.read_text(encoding="utf-8")
        for secret in [*secrets, redis_url, "postgresql://"]:
            assert secret not in text


async def test_a_redirect_without_a_location_is_recorded_as_skipped(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/blog",))
    site.routes["/blog"] = reply(301)

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    (entry,) = entries(tmp_path / "out").values()
    assert entry["skipped"] == "redirect without a Location"


# fetch: when to stop


@pytest.mark.parametrize("status", [403, 429])
async def test_the_first_403_or_429_stops_the_tool_without_a_retry(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    status: int,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(5)])
    site.script = [reply(status)]

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 1
    assert len(site.asked) == 1
    assert f"STOPPED: HTTP {status} at https://example.com{site.asked[0]}" in out
    report = report_of(tmp_path / "out")
    assert report["stopped"].startswith(f"HTTP {status}")
    assert sum(1 for e in report["pages"] if e["status"] == status) == 1
    assert sum(1 for e in report["pages"] if (e["skipped"] or "").startswith("not reached")) == 6


async def test_a_403_in_the_middle_of_a_redirect_chain_stops_the_tool(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/blog",))
    site.routes["/blog"] = reply(301, location="/next")
    site.routes["/next"] = reply(403)

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 1
    assert site.asked == ["/blog", "/next"]
    assert "https://example.com/next" in out


async def test_three_answers_of_5xx_in_a_row_stop_the_tool(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(5)])
    site.script = [reply(500), reply(502), reply(503), reply(200)]

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 1
    assert len(site.asked) == 3
    assert "3 answers of 5xx in a row" in out


async def test_two_answers_of_5xx_in_a_row_do_not_and_a_good_answer_starts_the_count_again(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(5)])
    site.script = [reply(500), reply(502), reply(200), reply(503), reply(503), reply(200)]

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert len(site.asked) == 7
    assert report_of(tmp_path / "out")["stopped"] is None


@pytest.mark.parametrize("error", [httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout])
async def test_three_failed_requests_in_a_row_stop_the_tool_and_none_is_retried(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    error: type[httpx.TransportError],
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(5)])
    site.script = [failing(error)] * 3

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 1
    assert len(site.asked) == 3
    assert len(set(site.asked)) == 3
    assert "3 requests in a row failed" in out
    failed = [e for e in entries(tmp_path / "out").values() if e["skipped"]]
    assert sum(1 for e in failed if e["skipped"] == f"request failed: {error.__name__}") == 3


async def test_an_answer_that_takes_longer_than_the_total_timeout_is_a_failed_page(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(5)])
    monkeypatch.setattr(s19_fetch_blocked, "REQUEST_TIMEOUT_SECONDS", 0.05)

    async def slow(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return site(request)
        await asyncio.sleep(5)
        return httpx.Response(200, text="late", headers=HTML)

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(slow))

    assert code == 1
    assert "3 requests in a row failed" in out
    failed = [e["skipped"] for e in entries(tmp_path / "out").values() if e["status"] is None]
    assert failed.count("request failed: TimeoutError") == 3


async def test_two_failed_requests_do_not_stop_the_tool(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=[f"/x{n}" for n in range(3)])
    site.script = [failing(httpx.ConnectError), failing(httpx.ReadTimeout), reply()]

    code, _ = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert code == 0
    assert len(site.asked) == 5


async def test_the_pause_is_applied_between_every_two_requests(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    sleeps: list[float],
    tmp_path: Path,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, extra=["/x0", "/x1"])

    code, _ = await cli(
        *fetch_args(crawl, tmp_path / "out", "--pause-seconds", "2.5"),
        transport=httpx.MockTransport(site),
    )

    assert code == 0
    # robots.txt and four pages: five requests, four pauses.
    assert len(site.requests) == 5
    assert sleeps == [2.5] * 4


# fetch: refusals, all before any request


async def _refused_fetch(
    cli: Cli, site: FakeSite, crawl: Crawl, out: Path, *extra: str, word: str
) -> None:
    code, text = await cli(*fetch_args(crawl, out, *extra), transport=httpx.MockTransport(site))
    assert code == 2
    assert word in text
    assert site.requests == []


@pytest.mark.parametrize(
    "agent",
    [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "idraft Chrome/120.0",
        "idraft-link-check Safari/605.1.15",
        "MOZILLA/5.0 (X11)",
        "  ",
    ],
)
async def test_a_user_agent_that_looks_like_a_browser_is_refused(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    agent: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    await _refused_fetch(
        cli, site, crawl, tmp_path / "out", "--user-agent", agent, word="--user-agent"
    )


@pytest.mark.parametrize("pause", ["0.99", "0", "-1", "nan", "inf", "abc"])
async def test_a_pause_under_a_second_is_refused(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    pause: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    await _refused_fetch(
        cli, site, crawl, tmp_path / "out", "--pause-seconds", pause, word="--pause-seconds"
    )


@pytest.mark.parametrize("cap", ["151", "1000", "0", "-3", "x"])
async def test_a_cap_above_150_is_refused(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    cap: str,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)

    await _refused_fetch(
        cli, site, crawl, tmp_path / "out", "--max-requests", cap, word="--max-requests"
    )


async def test_a_cap_of_150_and_a_pause_of_one_second_are_the_limits_that_work(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/",))

    code, _ = await cli(
        *fetch_args(crawl, tmp_path / "out", "--max-requests", "150", "--pause-seconds", "1"),
        transport=httpx.MockTransport(site),
    )

    assert code == 0


async def test_fetch_refuses_a_database_that_is_not_local(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    monkeypatch.setenv("APP_ENV", "test")

    await _refused_fetch(cli, site, crawl, tmp_path / "out", word="APP_ENV")
    code, text = await cli(*args(crawl, "list"))

    assert (code, "APP_ENV" in text) == (2, True)
    assert not (tmp_path / "out").exists()


async def test_fetch_refuses_an_out_folder_in_the_repository_that_git_does_not_ignore(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    out = REPOSITORY / "backend" / "spikes" / f"not-ignored-{uuid.uuid4().hex[:8]}"

    await _refused_fetch(cli, site, crawl, out, word="not ignored")

    assert not out.exists()


async def test_fetch_accepts_the_ignored_raw_folder_of_the_repository(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=("/",))
    out = REPOSITORY / "backend" / "spikes" / "raw" / f"s19-test-{uuid.uuid4().hex[:8]}"

    try:
        code, _ = await cli(*fetch_args(crawl, out), transport=httpx.MockTransport(site))
        assert code == 0
        assert (out / "fetch-report.json").is_file()
    finally:
        for file in sorted(out.rglob("*"), reverse=True):
            file.rmdir() if file.is_dir() else file.unlink()
        out.rmdir()


async def test_fetch_refuses_a_folder_that_is_not_empty(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    (tmp_path / "old.json").write_text("{}", encoding="utf-8")

    await _refused_fetch(cli, site, crawl, tmp_path, word="not an empty folder")


async def test_fetch_refuses_without_the_raw_store(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    monkeypatch.setenv("PROCESS_ROLE", "cli")
    for name in ("R2_RAW_ENDPOINT", "R2_RAW_ACCESS_KEY_ID", "R2_RAW_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(name)

    await _refused_fetch(cli, site, crawl, tmp_path / "out", word="raw storage")


async def test_fetch_refuses_a_crawl_that_is_not_finished(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    await execute(
        migrated, "UPDATE seo.crawl_runs SET state = 'failed' WHERE id = $1", crawl.run_id
    )

    await _refused_fetch(cli, site, crawl, tmp_path / "out", word="failed")


async def test_fetch_with_nothing_blocked_sends_nothing(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db, blocked=())

    code, out = await cli(*fetch_args(crawl, tmp_path / "out"), transport=httpx.MockTransport(site))

    assert (code, site.requests) == (0, [])
    assert "nothing to fetch" in out


async def test_a_failure_prints_no_secret(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    monkeypatch.setenv("DATABASE_URL", migrated.url("app_worker").replace(WORKER_PASSWORD, "wrong"))

    for argv in (args(crawl, "list"), fetch_args(crawl, tmp_path / "out")):
        code, out = await cli(*argv)
        assert code == 1
        assert "wrong" not in out


# apply


@dataclass(frozen=True)
class Fetched:
    crawl: Crawl
    out: Path
    admin: Path


async def fetched(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    *,
    blocked: Sequence[str] = ("/", "/blog"),
    extra: Sequence[str] = (),
) -> Fetched:
    """A refused crawl whose blocked pages were fetched."""
    crawl = await blocked_crawl(migrated, worker_db, blocked=blocked, extra=extra)
    out = tmp_path / "out"
    code, text = await cli(*fetch_args(crawl, out), transport=httpx.MockTransport(site))
    assert code == 0, text
    admin = admin_file(tmp_path, migrated.url("migrator"))
    return Fetched(crawl, out, admin)


def apply_args(done: Fetched, *extra: str) -> tuple[str, ...]:
    return args(
        done.crawl, "apply", "--out", str(done.out), "--admin-env-file", str(done.admin), *extra
    )


async def test_apply_corrects_the_rows_and_puts_the_crawl_back_to_processing(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
) -> None:
    site.routes["/"] = reply(
        body=(
            "<html><head><title> Home  &amp; more </title>"
            f'<link rel="canonical" href="{SITE}/"></head><body>x</body></html>'
        )
    )
    site.routes["/blog"] = reply(
        body=f'<html><head><link rel="canonical" href="{SITE}/pricing"></head></html>'
    )
    site.routes["/vanished"] = reply(404, body="gone")
    done = await fetched(migrated, worker_db, cli, site, tmp_path, extra=["/vanished"])
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET error_code = 'old', error_message = 'old', "
        "ingest_failures = 3, links_dropped_at = NULL WHERE id = $1",
        done.crawl.run_id,
    )

    code, out = await cli(*apply_args(done))

    assert code == 0, out
    pages = await _pages(migrated, done.crawl.run_id)
    home, blog, gone = pages["/"], pages["/blog"], pages["/vanished"]
    assert (home["status_code"], home["resource_type"], home["links_state"]) == (
        200,
        "html",
        "waiting",
    )
    assert home["title"] == "Home & more"
    assert (home["is_indexable"], home["non_indexable_reason"]) == (True, None)
    assert home["canonical_url_id"] == home["url_id"]
    assert blog["status_code"] == 200
    assert blog["title"] is None
    assert blog["canonical_url_id"] == pages["/pricing"]["url_id"]
    # A canonical that names another page makes the page non-indexable, as ingest does.
    assert (blog["is_indexable"], blog["non_indexable_reason"]) == (False, "canonical")
    assert (gone["status_code"], gone["resource_type"], gone["links_state"]) == (
        404,
        "broken",
        "none",
    )
    run = await fetchrow(
        migrated,
        "SELECT state, ingest_phase, error_code, error_message, finished_at, ingest_failures, "
        "links_dropped_at FROM seo.crawl_runs WHERE id = $1",
        done.crawl.run_id,
    )
    assert dict(run) == {
        "state": "processing",
        "ingest_phase": "links",
        "error_code": None,
        "error_message": None,
        "finished_at": None,
        "ingest_failures": 0,
        "links_dropped_at": None,
    }
    assert "2 page(s) served, 1 gone" in out


async def test_apply_makes_the_link_partition_again_when_it_was_dropped(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    await execute(migrated, "SELECT seo.drop_crawl_links_partition($1)", done.crawl.run_id)
    await execute(
        migrated,
        "UPDATE seo.crawl_runs SET links_dropped_at = now() WHERE id = $1",
        done.crawl.run_id,
    )
    exists = (
        "SELECT to_regclass('seo.crawl_links_' || replace($1::text, '-', '')) IS NOT NULL AS found"
    )
    assert not (await fetchrow(migrated, exists, str(done.crawl.run_id)))["found"]

    code, out = await cli(*apply_args(done))

    assert code == 0, out
    assert (await fetchrow(migrated, exists, str(done.crawl.run_id)))["found"]
    run = await fetchrow(
        migrated, "SELECT links_dropped_at FROM seo.crawl_runs WHERE id = $1", done.crawl.run_id
    )
    assert run["links_dropped_at"] is None
    assert "made again" in out


@pytest.mark.parametrize("part", ["database", "port", "host"])
async def test_apply_refuses_an_admin_url_for_another_database(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    part: str,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    url = migrated.url("migrator")
    other = {
        "database": migrated.url("migrator", database="elsewhere"),
        "port": url.replace(f":{migrated.port}/", f":{migrated.port + 1}/"),
        "host": url.replace(f"@{migrated.host}:", "@db.example.invalid:"),
    }[part]
    done = Fetched(done.crawl, done.out, admin_file(tmp_path, other))

    code, out = await cli(*apply_args(done))

    assert code == 2
    assert "not the database of the worker settings" in out
    assert "elsewhere" not in out
    assert (await _pages(migrated, done.crawl.run_id))["/"]["status_code"] == 403
    assert (await fetchrow(migrated, "SELECT state FROM seo.crawl_runs"))["state"] == "ready"


async def test_apply_reads_only_the_database_url_line_and_never_prints_it(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    admin = admin_file(
        tmp_path,
        migrated.url("migrator"),
        lines=["# a comment", "OTHER_SECRET=zzz-not-read", "export UNRELATED='x y'"],
    )
    quoted = tmp_path / "quoted.env"
    quoted.write_text(f'export DATABASE_URL="{migrated.url("migrator")}"\n', encoding="utf-8")

    code, out = await cli(*apply_args(Fetched(done.crawl, done.out, admin)))

    assert code == 0
    assert "zzz-not-read" not in out
    # The quoted form works the same, on a crawl that is processing again: refused for that.
    code, out = await cli(*apply_args(Fetched(done.crawl, done.out, quoted)))
    assert code == 2
    assert "processing" in out


async def test_apply_refuses_an_env_file_without_a_database_url_or_that_is_missing(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    bare = tmp_path / "bare.env"
    bare.write_text("OTHER=1\n", encoding="utf-8")

    for admin, word in ((bare, "no DATABASE_URL"), (tmp_path / "missing.env", "could not be read")):
        code, out = await cli(*apply_args(Fetched(done.crawl, done.out, admin)))
        assert code == 2
        assert word in out
    bad = tmp_path / "bad.env"
    bad.write_text("DATABASE_URL=mysql://root:hunter2@x/y\n", encoding="utf-8")
    code, out = await cli(*apply_args(Fetched(done.crawl, done.out, bad)))
    assert code == 2
    assert "hunter2" not in out


async def test_apply_with_a_wrong_admin_password_fails_without_printing_it(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    wrong = admin_file(tmp_path, migrated.url("migrator").replace(ADMIN_PASSWORD, "wrong-pw"))

    code, out = await cli(*apply_args(Fetched(done.crawl, done.out, wrong)))

    assert code == 1
    assert "wrong-pw" not in out
    assert (await _pages(migrated, done.crawl.run_id))["/"]["status_code"] == 403


async def test_apply_refuses_a_run_that_is_not_the_latest_of_the_project(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    await seed_crawl(migrated, done.crawl.workspace, done.crawl.project, [("/", 200)])

    code, out = await cli(*apply_args(done))

    assert code == 2
    assert "not of the latest crawl" in out
    assert (await _pages(migrated, done.crawl.run_id))["/"]["status_code"] == 403


async def test_apply_twice_changes_nothing_the_second_time(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    before = await fetch(
        migrated, "SELECT * FROM seo.crawl_pages WHERE run_id = $1", done.crawl.run_id
    )

    code, out = await cli(*apply_args(done))

    assert code == 2
    assert "processing" in out
    after = await fetch(
        migrated, "SELECT * FROM seo.crawl_pages WHERE run_id = $1", done.crawl.run_id
    )
    assert [dict(row) for row in after] == [dict(row) for row in before]


async def test_apply_does_not_make_a_page_that_has_links_wait_again(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    # Corrected by an earlier apply and read since: the crawl is `ready` again.
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET status_code = 200, links_state = 'from_html' WHERE run_id = $1",
        done.crawl.run_id,
    )

    code, out = await cli(*apply_args(done))

    assert code == 2
    assert "not refused any more" in out
    states = await fetch(
        migrated,
        "SELECT DISTINCT links_state FROM seo.crawl_pages WHERE status_code = 200 AND run_id = $1",
        done.crawl.run_id,
    )
    assert "waiting" not in {row["links_state"] for row in states}


async def test_apply_refuses_a_report_with_a_page_on_another_host(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    report = report_of(done.out)
    report["pages"][0]["url"] = "https://evil.example/"
    (done.out / "fetch-report.json").write_text(json.dumps(report), encoding="utf-8")

    code, out = await cli(*apply_args(done))

    assert code == 2
    assert "not in --allow-host" in out


async def test_apply_refuses_without_a_report(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, tmp_path: Path
) -> None:
    crawl = await blocked_crawl(migrated, worker_db)
    admin = admin_file(tmp_path, migrated.url("migrator"))

    code, out = await cli(
        *args(crawl, "apply", "--out", str(tmp_path), "--admin-env-file", str(admin))
    )

    assert code == 2
    assert "fetch-report.json" in out


# reingest


@pytest.fixture
def provider() -> Api:
    return Api([])


async def reingested(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
) -> tuple[Fetched, int, str]:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    serve(done.crawl.provider, provider)
    code, out = await cli(
        *args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "0.05"),
        transport=httpx.MockTransport(provider),
    )
    return done, code, out


async def test_reingest_reads_the_fetched_pages_in_and_ends_ready_without_posting_or_spending(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
) -> None:
    site.routes["/"] = reply(
        body='<html><body><main><p><a href="/pricing">Plans</a> <a href="/blog">Blog</a></p>'
        "</main></body></html>"
    )
    site.routes["/blog"] = reply(
        body='<html><body><main><ul><li><a href="/blog/a">A</a></li></ul></main></body></html>'
    )

    done, code, out = await reingested(migrated, worker_db, cli, site, provider, tmp_path)

    assert code == 0, out
    run = await fetchrow(
        migrated, "SELECT state, ingest_phase FROM seo.crawl_runs WHERE id = $1", done.crawl.run_id
    )
    assert (run["state"], run["ingest_phase"]) == ("ready", "done")
    pages = await _pages(migrated, done.crawl.run_id)
    assert pages["/"]["links_state"] == "from_html"
    assert pages["/"]["outlinks_all"] >= 2
    assert pages["/"]["click_depth"] == 0
    assert pages["/blog"]["outlinks_all"] >= 1
    assert pages["/blog"]["click_depth"] == 1
    assert pages["/blog/a"]["click_depth"] == 2
    # Nothing was posted, stopped or paid for, and the provider was not asked for the HTML of the
    # pages this tool fetched.
    asked = {r.url.path for r in provider.requests}
    assert TASK_POST not in asked
    assert FORCE_STOP not in asked
    assert RAW_HTML not in asked
    # The one cost event of the run is the crawl's own post, written long before.
    cost_events = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ops.provider_cost_events WHERE run_id = $1",
        done.crawl.run_id,
    )
    assert cost_events["n"] == 1
    for word in ("before", "after", "pages by status:", "links by scope:", "click_depth", "pass 1"):
        assert word in out
    assert "state=ready" in out


async def test_a_reingested_crawl_equals_the_same_crawl_that_was_never_refused(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
) -> None:
    """The second template and metrics passes run over rows the first ones already placed. They
    must leave what a crawl that read every page at once leaves."""
    plain_site = synthetic_site()
    plain = await _crawled(migrated, worker_db, plain_site)
    await _ingest(worker_db, plain_site, None, plain.task)
    for path in ("/", "/blog"):
        site.routes[path] = reply(body=plain_site.html[f"{SITE}{path}"])

    done, code, out = await reingested(migrated, worker_db, cli, site, provider, tmp_path)

    assert code == 0, out

    def stripped(snapshot: tuple[list[Any], list[Any], list[Any]]) -> tuple[Any, ...]:
        # The titles of the stand-in crawl are paths; the HTML of these pages names none.
        pages = [{k: v for k, v in page.items() if k != "title"} for page in snapshot[0]]
        return pages, snapshot[1], snapshot[2]

    assert stripped(await _snapshot(migrated, done.crawl.run_id)) == stripped(
        await _snapshot(migrated, plain.task.run_id)
    )


async def test_reingest_changes_the_counts_it_prints(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
) -> None:
    site.routes["/"] = reply(body='<html><body><main><a href="/blog">Blog</a></main></body></html>')

    _, code, out = await reingested(migrated, worker_db, cli, site, provider, tmp_path)

    assert code == 0
    before, after = out.split("\nafter\n")

    def links(text: str) -> int:
        (line,) = [row for row in text.splitlines() if row.startswith("links by scope:")]
        return sum(int(part.split("=")[1]) for part in line.removeprefix("links by scope:").split())

    # The two pages had no links before; the start page now starts the depth walk.
    assert links(after) > links(before)
    assert "pages with click_depth: " in after
    assert "403" not in after


async def test_reingest_needs_a_processing_crawl_and_its_own_provenance(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    serve(done.crawl.provider, provider)
    argv = args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "0.05")

    code, out = await cli(*argv, transport=httpx.MockTransport(provider))
    assert (code, "run `apply` first" in out) == (2, True)

    assert (await cli(*apply_args(done)))[0] == 0
    provenance = json.loads((done.out / "provenance.json").read_text(encoding="utf-8"))
    provenance["run_id"] = str(uuid.uuid4())
    (done.out / "provenance.json").write_text(json.dumps(provenance), encoding="utf-8")

    code, out = await cli(*argv, transport=httpx.MockTransport(provider))
    assert (code, "provenance.json is not of the latest crawl" in out) == (2, True)
    assert provider.requests == []


async def test_reingest_refuses_a_cap_above_five_dollars(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, site: FakeSite, tmp_path: Path
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0

    code, out = await cli(
        *args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "5.01")
    )

    assert (code, "at most 5" in out) == (2, True)


def test_the_cap_of_reingest_defaults_to_five_cents() -> None:
    parsed = s19_fetch_blocked._parser().parse_args(
        ["reingest", "--project", str(uuid.uuid4()), "--allow-host", "a.example", "--out", "x"]
    )

    assert parsed.max_usd == Decimal("0.05")


async def test_reingest_refuses_a_provenance_with_a_page_on_another_host(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    provenance = json.loads((done.out / "provenance.json").read_text(encoding="utf-8"))
    first = next(iter(provenance["urls"]))
    provenance["urls"][first] = "https://evil.example/"
    (done.out / "provenance.json").write_text(json.dumps(provenance), encoding="utf-8")

    code, out = await cli(
        *args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "0.05"),
        transport=httpx.MockTransport(provider),
    )

    assert (code, "not in --allow-host" in out) == (2, True)
    assert provider.requests == []


def test_the_documented_command_runs_as_a_script_from_the_backend_folder() -> None:
    done = subprocess.run(
        [sys.executable, "spikes/s19_fetch_blocked.py", "--help"],
        cwd=REPOSITORY / "backend",
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )

    assert done.returncode == 0, done.stderr
    assert "reingest" in done.stdout


async def test_reingest_refuses_without_credentials(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    monkeypatch.delenv("DATAFORSEO_LOGIN")
    monkeypatch.delenv("DATAFORSEO_PASSWORD")

    code, out = await cli(*args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "1"))

    assert (code, "credentials" in out) == (2, True)


async def test_reingest_stops_when_the_cost_events_of_the_run_grow(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    serve(done.crawl.provider, provider)
    real = ingest_run

    async def spending(*given: Any, **keywords: Any) -> Any:
        outcome = await real(*given, **keywords)
        await execute(
            migrated,
            "INSERT INTO ops.provider_cost_events (occurred_at, workspace_id, project_id, "
            "provider_code, endpoint, workload, channel, run_id, subject_type, subject_id, units, "
            "price_unit, cost_usd, cost_source, billing_period) "
            "SELECT occurred_at, workspace_id, project_id, provider_code, endpoint, workload, "
            "channel, run_id, subject_type, subject_id, units, price_unit, 1, cost_source, "
            "billing_period FROM ops.provider_cost_events WHERE run_id = $1 LIMIT 1",
            done.crawl.run_id,
        )
        return outcome

    monkeypatch.setattr(s19_fetch_blocked, "ingest_run", spending)

    code, out = await cli(
        *args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "0.05"),
        transport=httpx.MockTransport(provider),
    )

    assert code == 1
    assert "CAP EXCEEDED" in out
    assert FORCE_STOP not in {r.url.path for r in provider.requests}


async def test_reingest_stops_when_another_pass_holds_the_crawl(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    serve(done.crawl.provider, provider)
    real = ingest_run

    async def busy(*given: Any, **keywords: Any) -> Any:
        outcome = await real(*given, **keywords)
        return type(outcome)(phase=None, steps=0, busy=True)

    monkeypatch.setattr(s19_fetch_blocked, "ingest_run", busy)

    code, out = await cli(
        *args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "0.05"),
        transport=httpx.MockTransport(provider),
    )

    assert code == 1
    assert "another pass holds the crawl" in out


async def test_reingest_pauses_five_seconds_between_passes_and_gives_up_at_the_pass_limit(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    site: FakeSite,
    provider: Api,
    tmp_path: Path,
    sleeps: list[float],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done = await fetched(migrated, worker_db, cli, site, tmp_path)
    assert (await cli(*apply_args(done)))[0] == 0
    serve(done.crawl.provider, provider)
    monkeypatch.setattr(s19_fetch_blocked, "REINGEST_PASSES_MAX", 3)

    async def idle(*_: Any, **__: Any) -> IngestOutcome:
        return IngestOutcome(phase="links", steps=0)

    monkeypatch.setattr(s19_fetch_blocked, "ingest_run", idle)

    code, out = await cli(
        *args(done.crawl, "reingest", "--out", str(done.out), "--max-usd", "0.05"),
        transport=httpx.MockTransport(provider),
    )

    assert code == 1
    # The pause of the fetch, then 5 seconds between passes (none after the last one).
    assert sleeps[-2:] == [5.0, 5.0]
    assert sleeps.count(5.0) == 2
    assert "pass 3" in out
    assert "pass 4" not in out
    assert "state=processing" in out


# The adapter


@pytest.fixture
async def own(
    provider: Api, tmp_path: Path
) -> AsyncIterator[tuple[OwnHtmlOnPage, Mapping[str, Path]]]:
    serve(synthetic_site(), provider)
    kept = tmp_path / "kept.html"
    kept.write_text("<html>ours é</html>", encoding="utf-8")
    files = {f"{SITE}/": kept}
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
        client = DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD, origin=ORIGIN)
        yield OwnHtmlOnPage(client, files), files


async def test_the_adapter_serves_our_html_and_asks_the_provider_for_the_rest(
    own: tuple[OwnHtmlOnPage, Mapping[str, Path]], provider: Api
) -> None:
    on_page, _ = own

    ours = await on_page.raw_html(E2E_TASK, f"{SITE}/")
    assert ours == "<html>ours é</html>"
    assert provider.requests == []

    theirs = await on_page.raw_html(E2E_TASK, f"{SITE}/privacy")
    assert theirs is not None
    assert [r.url.path for r in provider.requests] == [RAW_HTML]


async def test_the_adapter_never_posts_and_never_stops_a_crawl(
    own: tuple[OwnHtmlOnPage, Mapping[str, Path]], provider: Api
) -> None:
    on_page, _ = own
    order = CrawlOrder(
        host="example.com", max_crawl_pages=2000, enable_javascript=False,
        allowed_subdomains=(), tag="x",
    )  # fmt: skip

    with pytest.raises(ProviderCallError) as posted:
        await on_page.post(order)
    with pytest.raises(ProviderCallError) as stopped:
        await on_page.force_stop(E2E_TASK)

    assert posted.value.error.kind is ProviderErrorKind.NOT_SENT
    assert stopped.value.error.kind is ProviderErrorKind.NOT_SENT
    assert provider.requests == []
