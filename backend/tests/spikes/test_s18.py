"""S-18: the tool that drives one real crawl, tested against the in-repo stand-ins only (the
real On-Page adapter over an httpx transport that answers from memory). No network.

Every call goes through `cli`, which also asserts that no secret of the environment reached
the output."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from decimal import Decimal

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_runs import queue_run
from idraft.config.settings import load_settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.on_page import CrawlOrder
from idraft.storage.raw import s3_client
from spikes.s18_link_crawl import OneCrawlOnPage, main
from tests.api.auth.support import execute, fetch, fetchrow
from tests.collectors.crawl_support import (
    E2E_TASK,
    clear_crawls,
    serve,
    site_project,
    synthetic_site,
)
from tests.collectors.support import NOW
from tests.conftest import BASE_URL, ObjectServer, PostgresServer
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    envelope,
    task_answer,
)

Sessions = async_sessionmaker[AsyncSession]
Cli = Callable[..., Awaitable[tuple[int, str]]]

WORKER_PASSWORD = "worker-pw"
TASK_POST = "/v3/on_page/task_post"
FORCE_STOP = "/v3/on_page/force_stop"
# The cost of a crawl of 2,000 pages at the price book's $0.00015 a page.
ESTIMATE = Decimal("0.30")


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
    """Values that must never be printed."""
    return [PASSWORD, LOGIN, WORKER_PASSWORD, object_server.secret_access_key]


@pytest.fixture(autouse=True)
def environment(
    monkeypatch: pytest.MonkeyPatch,
    migrated: PostgresServer,
    redis_url: str,
    object_server: ObjectServer,
    bucket: str,
) -> None:
    """The worker's environment, as `uv run --env-file` would give it."""
    values = {
        "PROCESS_ROLE": "worker",
        "APP_ENV": "test",
        "APP_ORIGIN": BASE_URL,
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
    """Sessions as `app_worker`, for the runs a test queues without the tool."""
    engine = create_engine(load_settings())
    yield create_session_factory(engine)
    await engine.dispose()


@pytest.fixture
def provider() -> Api:
    stand_in = Api([])
    serve(synthetic_site(), stand_in)
    return stand_in


@pytest.fixture
def cli(capsys: pytest.CaptureFixture[str], provider: Api, secrets: list[str]) -> Cli:
    async def call(*argv: str) -> tuple[int, str]:
        code = await main(list(argv), transport=httpx.MockTransport(provider))
        captured = capsys.readouterr()
        text = captured.out + captured.err
        for secret in secrets:
            assert secret not in text
        return code, text

    return call


def _asked(provider: Api, path: str) -> list[httpx.Request]:
    return [r for r in provider.requests if r.url.path == path]


async def _queue(worker_db: Sessions, workspace_id: uuid.UUID, project: uuid.UUID) -> uuid.UUID:
    async with worker_db() as db, db.begin():
        return await queue_run(
            db,
            workspace_id=workspace_id,
            project_id=project,
            trigger="manual",
            requested_by=None,
            now=NOW,
        )


async def _states(pg: PostgresServer) -> list[tuple[str, str | None]]:
    rows = await fetch(pg, "SELECT state, provider_task_id FROM seo.crawl_runs ORDER BY created_at")
    return [(row["state"], row["provider_task_id"]) for row in rows]


def _run(project: uuid.UUID, *extra: str) -> tuple[str, ...]:
    return ("run", "--project", str(project), "--allow-host", "example.com", *extra)


# queue


async def test_queue_queues_one_run_and_prints_what_it_may_cost(
    migrated: PostgresServer, cli: Cli
) -> None:
    _, project = await site_project(migrated)

    code, out = await cli("queue", "--project", str(project), "--allow-host", "example.com")

    assert code == 0
    assert "example.com" in out
    assert "ceiling=2000" in out
    assert f"estimated_cost_usd={ESTIMATE}" in out
    row = await fetchrow(migrated, "SELECT trigger, state, estimated_cost_usd FROM seo.crawl_runs")
    assert (row["trigger"], row["state"], row["estimated_cost_usd"]) == (
        "manual",
        "queued",
        ESTIMATE,
    )


async def test_queue_refuses_a_second_run_anywhere_in_the_database(
    migrated: PostgresServer, cli: Cli
) -> None:
    _, first = await site_project(migrated)
    _, second = await site_project(migrated)
    assert (await cli("queue", "--project", str(first), "--allow-host", "example.com"))[0] == 0

    code, out = await cli("queue", "--project", str(second), "--allow-host", "example.com")

    assert code == 2
    assert "already" in out
    assert len(await _states(migrated)) == 1


async def test_queue_refuses_a_host_outside_the_allow_list(
    migrated: PostgresServer, cli: Cli
) -> None:
    _, project = await site_project(migrated)

    code, out = await cli("queue", "--project", str(project), "--allow-host", "other.example")

    assert code == 2
    assert "example.com" in out
    assert await _states(migrated) == []


async def test_queue_needs_an_allow_list(migrated: PostgresServer, cli: Cli) -> None:
    _, project = await site_project(migrated)

    code, _ = await cli("queue", "--project", str(project))

    assert code == 2
    assert await _states(migrated) == []


async def test_queue_refuses_an_unknown_project_and_one_without_a_website(
    migrated: PostgresServer, cli: Cli
) -> None:
    _, project = await site_project(migrated)
    await execute(
        migrated, "UPDATE core.projects SET primary_domain_id = NULL WHERE id = $1", project
    )

    unknown, _ = await cli("queue", "--project", str(uuid.uuid4()), "--allow-host", "example.com")
    bare, out = await cli("queue", "--project", str(project), "--allow-host", "example.com")

    assert (unknown, bare) == (2, 2)
    assert "no website" in out
    assert await _states(migrated) == []


# run: every refusal comes before any call to the provider


async def _refused(migrated: PostgresServer, provider: Api, code: int, out: str, word: str) -> None:
    assert code == 2
    assert word in out
    assert provider.requests == []
    assert await _states(migrated) == [("queued", None)]


async def test_run_refuses_without_a_cap(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, provider: Api
) -> None:
    workspace, project = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)

    code, out = await cli(*_run(project))

    await _refused(migrated, provider, code, out, "--max-usd")


async def test_run_refuses_a_cap_above_five_dollars(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, provider: Api
) -> None:
    workspace, project = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)

    code, out = await cli(*_run(project, "--max-usd", "5.01"))

    await _refused(migrated, provider, code, out, "at most 5")


async def test_run_refuses_two_runs_in_the_database(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, provider: Api
) -> None:
    first_workspace, first = await site_project(migrated)
    second_workspace, second = await site_project(migrated)
    await _queue(worker_db, first_workspace.id, first)
    await _queue(worker_db, second_workspace.id, second)

    code, out = await cli(*_run(first, "--max-usd", "1.00"))

    assert (code, provider.requests) == (2, [])
    assert "exactly one" in out
    assert [state for state, _ in await _states(migrated)] == ["queued", "queued"]


async def test_run_refuses_when_nothing_is_queued(
    migrated: PostgresServer, cli: Cli, provider: Api
) -> None:
    _, project = await site_project(migrated)

    code, out = await cli(*_run(project, "--max-usd", "1.00"))

    assert (code, provider.requests) == (2, [])
    assert "exactly one" in out


async def test_run_refuses_an_estimate_above_the_cap(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, provider: Api
) -> None:
    workspace, project = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)

    code, out = await cli(*_run(project, "--max-usd", "0.10"))

    await _refused(migrated, provider, code, out, "estimate")


async def test_run_refuses_a_host_outside_the_allow_list(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, provider: Api
) -> None:
    workspace, project = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)

    code, out = await cli(
        "run", "--project", str(project), "--allow-host", "other.example", "--max-usd", "1.00"
    )

    await _refused(migrated, provider, code, out, "allow-list")


async def test_run_refuses_a_run_of_another_project(
    migrated: PostgresServer, worker_db: Sessions, cli: Cli, provider: Api
) -> None:
    workspace, project = await site_project(migrated)
    _, other = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)

    code, out = await cli(*_run(other, "--max-usd", "1.00"))

    await _refused(migrated, provider, code, out, "another project")


async def test_run_refuses_without_credentials(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    provider: Api,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)
    monkeypatch.delenv("DATAFORSEO_LOGIN")
    monkeypatch.delenv("DATAFORSEO_PASSWORD")

    code, out = await cli(*_run(project, "--max-usd", "1.00"))

    await _refused(migrated, provider, code, out, "credentials")


async def test_run_refuses_without_the_raw_bucket(
    migrated: PostgresServer,
    worker_db: Sessions,
    cli: Cli,
    provider: Api,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project = await site_project(migrated)
    await _queue(worker_db, workspace.id, project)
    # The `cli` role does not demand the bucket of the settings, so this is the tool's own check.
    monkeypatch.setenv("PROCESS_ROLE", "cli")
    for name in ("R2_RAW_ENDPOINT", "R2_RAW_ACCESS_KEY_ID", "R2_RAW_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(name)

    code, out = await cli(*_run(project, "--max-usd", "1.00"))

    await _refused(migrated, provider, code, out, "raw storage")


# run: the crawl itself


async def test_a_crawl_goes_from_queued_to_ready_with_one_post_and_one_cost_event(
    migrated: PostgresServer, cli: Cli, provider: Api
) -> None:
    _, project = await site_project(migrated)
    assert (await cli("queue", "--project", str(project), "--allow-host", "example.com"))[0] == 0

    code, out = await cli(*_run(project, "--max-usd", "1.00", "--poll-seconds", "0"))

    assert code == 0
    assert len(_asked(provider, TASK_POST)) == 1
    assert _asked(provider, FORCE_STOP) == []
    run = await fetchrow(migrated, "SELECT id, state, pages_crawled, cost_usd FROM seo.crawl_runs")
    assert (run["state"], run["pages_crawled"], run["cost_usd"]) == ("ready", 11, Decimal("0.3"))
    costs = await fetch(
        migrated,
        "SELECT endpoint, cost_usd FROM ops.provider_cost_events WHERE run_id = $1",
        run["id"],
    )
    assert [(c["endpoint"], c["cost_usd"]) for c in costs] == [
        ("on_page/task_post", Decimal("0.3"))
    ]
    # Each check is printed, and each tick says where the crawl is.
    for word in ("max-usd", "exactly one", "estimate", "allow-list", "credentials"):
        assert word in out
    assert "state=ready" in out
    assert "pages_crawled=11" in out
    assert "cost_usd=0.3" in out

    code, status = await cli("status", "--project", str(project))

    assert code == 0
    assert "state=ready" in status
    assert "pages=11" in status
    assert "on_page/task_post" in status
    # `status` never calls the provider.
    assert len(_asked(provider, TASK_POST)) == 1


async def test_a_crawl_that_costs_more_than_the_cap_is_force_stopped_once(
    migrated: PostgresServer, cli: Cli, provider: Api
) -> None:
    _, project = await site_project(migrated)
    assert (await cli("queue", "--project", str(project), "--allow-host", "example.com"))[0] == 0
    # The estimate fits the cap, the cost the provider reports does not.
    provider.answer(
        "POST",
        TASK_POST,
        envelope([task_answer(task_id=E2E_TASK, cost=1.0, status_code=20100)]),
    )
    provider.answer("POST", FORCE_STOP, envelope([task_answer(task_id=E2E_TASK)]))

    code, out = await cli(*_run(project, "--max-usd", "0.30", "--poll-seconds", "0"))

    assert code == 1
    assert "CAP EXCEEDED" in out
    assert len(_asked(provider, TASK_POST)) == 1
    assert len(_asked(provider, FORCE_STOP)) == 1
    # Nothing is read from the provider after the cap is passed, and nothing else is changed.
    assert _asked(provider, "/v3/on_page/pages") == []
    run = await fetchrow(migrated, "SELECT state, provider_task_id FROM seo.crawl_runs")
    assert (run["state"], run["provider_task_id"]) == ("processing", E2E_TASK)


async def test_a_post_that_did_not_go_through_is_not_sent_again(
    migrated: PostgresServer, cli: Cli, provider: Api
) -> None:
    _, project = await site_project(migrated)
    assert (await cli("queue", "--project", str(project), "--allow-host", "example.com"))[0] == 0

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    # Nothing was sent: the library would try again next tick, the tool must not.
    provider.on("POST", TASK_POST, unreachable)

    code, out = await cli(*_run(project, "--max-usd", "1.00", "--poll-seconds", "0"))

    assert code == 1
    assert "not sent again" in out
    assert len(_asked(provider, TASK_POST)) == 1
    assert await _states(migrated) == [("queued", None)]


async def test_a_post_the_provider_refuses_ends_the_run_and_is_not_repeated(
    migrated: PostgresServer, cli: Cli, provider: Api
) -> None:
    _, project = await site_project(migrated)
    assert (await cli("queue", "--project", str(project), "--allow-host", "example.com"))[0] == 0
    provider.answer(
        "POST", TASK_POST, envelope([task_answer(task_id=None, status_code=40501, message="no")])
    )

    code, out = await cli(*_run(project, "--max-usd", "1.00", "--poll-seconds", "0"))

    assert code == 1
    assert "state=failed" in out
    assert len(_asked(provider, TASK_POST)) == 1


async def test_the_crawl_that_times_out_is_not_cancelled(
    migrated: PostgresServer, cli: Cli, provider: Api
) -> None:
    _, project = await site_project(migrated)
    assert (await cli("queue", "--project", str(project), "--allow-host", "example.com"))[0] == 0
    unfinished = {
        "crawl_progress": "in_progress",
        "crawl_status": {"pages_in_queue": 5, "pages_crawled": 3},
        "domain_info": {"extended_crawl_status": "no_errors", "checks": {"sitemap": True}},
    }
    provider.answer(
        "GET",
        f"/v3/on_page/summary/{E2E_TASK}",
        envelope([task_answer(task_id=E2E_TASK, result=[unfinished])]),
    )

    code, out = await cli(
        *_run(project, "--max-usd", "1.00", "--poll-seconds", "0", "--timeout-minutes", "0")
    )

    assert code == 1
    assert "timed out" in out
    assert E2E_TASK in out
    assert _asked(provider, FORCE_STOP) == []
    run = await fetchrow(migrated, "SELECT state, pages_crawled, pages_found FROM seo.crawl_runs")
    assert (run["state"], run["pages_crawled"], run["pages_found"]) == ("crawling", 3, 8)


# The guard on the adapter: only the crawl this tool was started for, and only once.


@pytest.fixture
async def guarded(provider: Api) -> AsyncIterator[tuple[OneCrawlOnPage, uuid.UUID]]:
    run_id = uuid.uuid4()
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
        client = DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD, origin=ORIGIN)
        yield OneCrawlOnPage(client, run_id), run_id


def _order(tag: str) -> CrawlOrder:
    return CrawlOrder(
        host="example.com", max_crawl_pages=2000, enable_javascript=False,
        allowed_subdomains=(), tag=tag,
    )  # fmt: skip


async def test_the_adapter_refuses_a_crawl_of_another_run(
    guarded: tuple[OneCrawlOnPage, uuid.UUID], provider: Api
) -> None:
    on_page, _ = guarded

    with pytest.raises(ProviderCallError) as refused:
        await on_page.post(_order(str(uuid.uuid4())))

    assert refused.value.error.kind is ProviderErrorKind.NOT_SENT
    assert provider.requests == []


async def test_the_adapter_posts_its_run_once(
    guarded: tuple[OneCrawlOnPage, uuid.UUID], provider: Api
) -> None:
    on_page, run_id = guarded

    posted = await on_page.post(_order(str(run_id)))
    with pytest.raises(ProviderCallError) as again:
        await on_page.post(_order(str(run_id)))

    assert posted.task_id == E2E_TASK
    assert again.value.error.kind is ProviderErrorKind.NOT_SENT
    assert len(_asked(provider, TASK_POST)) == 1


# Secrets


async def test_a_failure_prints_no_secret(
    migrated: PostgresServer,
    cli: Cli,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, project = await site_project(migrated)
    monkeypatch.setenv("DATABASE_URL", migrated.url("app_worker").replace(WORKER_PASSWORD, "wrong"))

    for argv in (
        ("queue", "--project", str(project), "--allow-host", "example.com"),
        ("status", "--project", str(project)),
        _run(project, "--max-usd", "1.00"),
    ):
        code, out = await cli(*argv)
        assert code == 1
        assert "wrong" not in out


async def test_invalid_settings_name_the_variable_and_not_its_value(
    cli: Cli, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("R2_RAW_ENDPOINT", "")

    code, out = await cli("status", "--project", str(uuid.uuid4()))

    assert code == 2
    assert "R2_RAW_ENDPOINT" in out
