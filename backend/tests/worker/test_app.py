"""The worker process as a whole (docs/21-scheduler-workers.md sections 5.1 and 12)."""

import asyncio
import io
import json
import os
import signal
from collections.abc import Sequence
from datetime import timedelta
from pathlib import Path

import pytest
from pydantic import BaseModel, SecretStr
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

from idraft.config.logging import configure_logging
from idraft.config.settings import Settings
from idraft.db.engine import create_engine, create_session_factory
from idraft.storage.raw import RawStore
from idraft.worker import __main__ as entrypoint
from idraft.worker import app as worker_app
from idraft.worker.app import WorkerContext, run_worker
from idraft.worker.assembly import assemble
from idraft.worker.queues import Queues
from idraft.worker.ticks import Tick
from tests.conftest import ObjectServer
from tests.worker.conftest import eventually


class Note(BaseModel):
    number: int


def _nothing(context: WorkerContext) -> Sequence[Tick]:
    return ()


async def test_the_worker_runs_until_asked_to_stop_and_then_ends(
    worker_settings: Settings, redis: Redis
) -> None:
    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(worker_settings, _nothing, stop))
    await asyncio.sleep(0.5)
    assert not running.done()

    stop.set()
    # True: it stopped because it was asked to.
    assert await asyncio.wait_for(running, timeout=10) is True
    # Nothing of it is left behind in Redis but its two streams.
    assert not await redis.exists("lock:taskiq-scheduler")


async def test_jobs_and_ticks_are_built_from_the_context_and_run(
    worker_settings: Settings, redis: Redis
) -> None:
    handled: list[int] = []
    ticks = 0
    contexts: list[WorkerContext] = []

    def parts(context: WorkerContext) -> Sequence[Tick]:
        contexts.append(context)

        async def handle(message: Note) -> None:
            handled.append(message.number)

        async def tick() -> None:
            nonlocal ticks
            ticks += 1
            await context.queues.enqueue("note", Note(number=ticks), dedupe_key=f"note:{ticks}")

        context.queues.register("process", "note", handle)
        return [
            Tick(
                name="producer",
                interval=timedelta(milliseconds=300),
                action=tick,
                lock_ttl=timedelta(milliseconds=250),
            )
        ]

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(worker_settings, parts, stop))
    await eventually(lambda: len(handled) >= 2, within=10)
    stop.set()
    await asyncio.wait_for(running, timeout=10)

    (context,) = contexts
    assert context.settings is worker_settings
    # The worker connects as its own database role.
    assert "app_worker" in worker_settings.database_url.get_secret_value()
    # One HTTP client for its provider calls, closed with the worker; no raw storage is set.
    assert context.http is not None
    assert context.http.is_closed
    assert context.raw_store is None


async def test_the_raw_store_is_opened_when_it_is_configured_and_closed_at_the_end(
    worker_settings: Settings, object_server: ObjectServer
) -> None:
    settings = worker_settings.model_copy(
        update={
            "r2_raw_endpoint": object_server.endpoint,
            "r2_raw_access_key_id": SecretStr(object_server.access_key_id),
            "r2_raw_secret_access_key": SecretStr(object_server.secret_access_key),
        }
    )
    stores: list[object] = []

    def parts(context: WorkerContext) -> Sequence[Tick]:
        stores.append(context.raw_store)
        return ()

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(settings, parts, stop))
    await eventually(lambda: bool(stores), within=10)
    stop.set()
    assert await asyncio.wait_for(running, timeout=10) is True

    (store,) = stores
    assert isinstance(store, RawStore)
    assert store.bucket == "seo-raw"


async def test_stopping_waits_for_a_handler_in_flight(
    worker_settings: Settings, redis: Redis
) -> None:
    started, finished = asyncio.Event(), asyncio.Event()
    sent = False

    def parts(context: WorkerContext) -> Sequence[Tick]:
        async def slow(message: Note) -> None:
            started.set()
            await asyncio.sleep(0.8)
            finished.set()

        async def produce() -> None:
            nonlocal sent
            if started.is_set():
                return
            sent = await context.queues.enqueue("slow", Note(number=1), dedupe_key="slow:1") or sent

        context.queues.register("collect", "slow", slow)
        return [Tick(name="producer", interval=timedelta(milliseconds=200), action=produce)]

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(worker_settings, parts, stop))
    await asyncio.wait_for(started.wait(), timeout=10)

    stop.set()
    await asyncio.wait_for(running, timeout=10)

    # A deploy must not cut a provider call in half.
    assert finished.is_set()


async def test_from_the_moment_it_is_asked_to_stop_the_worker_takes_no_new_message(
    worker_settings: Settings, redis: Redis
) -> None:
    """A deploy gives the worker a fixed time to stop. A handler started while a slow tick
    is still finishing would eat into it."""
    started: list[int] = []
    in_tick, leave_tick = asyncio.Event(), asyncio.Event()
    contexts: list[WorkerContext] = []

    def parts(context: WorkerContext) -> Sequence[Tick]:
        contexts.append(context)

        async def handle(message: Note) -> None:
            started.append(message.number)

        async def slow_tick() -> None:
            in_tick.set()
            await leave_tick.wait()

        context.queues.register("collect", "note", handle)
        return [Tick(name="slow", interval=timedelta(seconds=30), action=slow_tick)]

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(worker_settings, parts, stop))
    await asyncio.wait_for(in_tick.wait(), timeout=10)
    (context,) = contexts
    await context.queues.enqueue("note", Note(number=1), dedupe_key="note:1")
    await eventually(lambda: started == [1], within=10)

    stop.set()
    await asyncio.sleep(0.5)
    # The tick is still at it, and the worker is no longer taking messages.
    await context.queues.enqueue("note", Note(number=2), dedupe_key="note:2")
    await asyncio.sleep(2.5)
    assert not running.done()
    assert started == [1]

    leave_tick.set()
    assert await asyncio.wait_for(running, timeout=10) is True
    assert started == [1]
    # The message is there for the next worker.
    assert await redis.xlen("collect") == 2


async def test_a_tick_that_never_ends_does_not_hold_the_worker_for_ever(
    worker_settings: Settings, redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    stream = io.StringIO()
    monkeypatch.setattr(worker_app, "STOP_TICKS_WITHIN", timedelta(milliseconds=300))
    in_tick = asyncio.Event()

    def parts(context: WorkerContext) -> Sequence[Tick]:
        async def stuck() -> None:
            in_tick.set()
            await asyncio.Event().wait()

        return [Tick(name="stuck", interval=timedelta(seconds=30), action=stuck)]

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(worker_settings, parts, stop))
    configure_logging(service="worker", version="test", level="info", stream=stream)
    await asyncio.wait_for(in_tick.wait(), timeout=10)

    stop.set()
    assert await asyncio.wait_for(running, timeout=10) is True

    (line,) = [
        json.loads(line) for line in stream.getvalue().splitlines() if "cut off at stop" in line
    ]
    assert line["part"] == "tick:stuck"


async def test_the_heartbeat_is_written_while_both_stores_answer(
    worker_settings: Settings, redis: Redis, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(worker_app, "HEARTBEAT_EVERY", timedelta(milliseconds=100))
    heartbeat = tmp_path / "heartbeat"
    settings = worker_settings.model_copy(update={"heartbeat_file": heartbeat})

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(settings, _nothing, stop))
    await eventually(heartbeat.exists, within=10)
    first = heartbeat.stat().st_mtime_ns
    await eventually(lambda: heartbeat.stat().st_mtime_ns > first, within=5)
    stop.set()
    await asyncio.wait_for(running, timeout=10)


async def test_no_heartbeat_is_written_when_the_database_does_not_answer(
    worker_settings: Settings,
    redis: Redis,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    black_hole: str,
) -> None:
    stream = io.StringIO()
    monkeypatch.setattr(worker_app, "HEARTBEAT_EVERY", timedelta(milliseconds=100))
    monkeypatch.setattr(worker_app, "_HEALTH_TIMEOUT_SECONDS", 0.2)
    heartbeat = tmp_path / "heartbeat"
    settings = worker_settings.model_copy(
        update={
            "heartbeat_file": heartbeat,
            "database_url": SecretStr(f"postgresql://app_worker:x@{black_hole}/idraft"),
            "log_level": "info",
        }
    )

    stop = asyncio.Event()
    running = asyncio.create_task(run_worker(settings, _nothing, stop))
    configure_logging(service="worker", version="test", level="info", stream=stream)
    await asyncio.sleep(1.0)
    stop.set()
    await asyncio.wait_for(running, timeout=15)

    # The container healthcheck finds no fresh file and reports the worker unhealthy.
    assert not heartbeat.exists()
    failures = [
        json.loads(line) for line in stream.getvalue().splitlines() if "tick failed" in line
    ]
    assert failures
    assert {line["tick"] for line in failures} == {"heartbeat"}


async def test_no_heartbeat_is_written_when_redis_does_not_answer(
    worker_settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(worker_app, "_HEALTH_TIMEOUT_SECONDS", 2.0)
    heartbeat = tmp_path / "heartbeat"
    settings = worker_settings.model_copy(update={"heartbeat_file": heartbeat})
    engine = create_engine(settings)
    unreachable = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2)
    context = WorkerContext(
        settings=settings,
        engine=engine,
        sessions=create_session_factory(engine),
        redis=unreachable,
        queues=Queues(settings.redis_url.get_secret_value(), unreachable),
    )
    tick = worker_app._heartbeat(context)
    assert tick is not None
    try:
        # The database answers; Redis does not. A worker that cannot reach its queues is
        # not healthy.
        with pytest.raises(RedisConnectionError):
            await tick.action()
    finally:
        await unreachable.aclose()
        await engine.dispose()

    assert not heartbeat.exists()


def test_a_worker_with_no_heartbeat_file_says_so(
    worker_settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    context = WorkerContext(
        settings=worker_settings,
        engine=None,  # type: ignore[arg-type]
        sessions=None,  # type: ignore[arg-type]
        redis=None,  # type: ignore[arg-type]
        queues=None,  # type: ignore[arg-type]
    )

    assert worker_app._heartbeat(context) is None
    assert "no heartbeat file is set" in stream.getvalue()


async def test_a_part_that_ends_by_itself_stops_the_whole_worker(
    worker_settings: Settings, redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)

    async def broken_scheduler(*args: object, **kwargs: object) -> None:
        raise RuntimeError("the scheduler fell over")

    monkeypatch.setattr(worker_app, "run_scheduler", broken_scheduler)

    # Nobody sets `stop`: the worker ends because one of its parts did, and says it did not
    # stop as asked.
    stopped_when_asked = await asyncio.wait_for(
        run_worker(worker_settings, _nothing, asyncio.Event()), timeout=10
    )
    assert stopped_when_asked is False

    (line,) = [
        json.loads(line) for line in stream.getvalue().splitlines() if "worker part ended" in line
    ]
    assert (line["part"], line["err"]["type"]) == ("scheduler", "RuntimeError")


def test_the_entrypoint_refuses_a_process_that_is_not_the_worker(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], worker_settings: Settings
) -> None:
    monkeypatch.setattr(
        entrypoint,
        "load_settings",
        lambda: worker_settings.model_copy(update={"process_role": "cli"}),
    )
    assert entrypoint.main() == 2
    assert "PROCESS_ROLE" in capsys.readouterr().err


def test_the_entrypoint_runs_the_worker_and_stops_on_sigterm(
    monkeypatch: pytest.MonkeyPatch, worker_settings: Settings
) -> None:
    assembled: list[WorkerContext] = []

    def recording(context: WorkerContext) -> Sequence[Tick]:
        assembled.append(context)
        # What `docker stop` sends, a moment after the worker has started. The timer is set
        # from inside the running worker, where the signal is already being listened for:
        # sent any earlier it would end the test run itself.
        asyncio.get_running_loop().call_later(1.0, os.kill, os.getpid(), signal.SIGTERM)
        return assemble(context)

    monkeypatch.setattr(entrypoint, "assemble", recording)
    monkeypatch.setattr(entrypoint, "load_settings", lambda: worker_settings)
    monkeypatch.setattr(entrypoint, "configure_logging", lambda **_: None)

    assert entrypoint.main() == 0
    # It ran the real parts of the worker, built from the settings it loaded.
    assert [context.settings for context in assembled] == [worker_settings]


def test_the_entrypoint_exits_with_an_error_when_the_worker_ended_by_itself(
    monkeypatch: pytest.MonkeyPatch, worker_settings: Settings
) -> None:
    """The container is started again by its restart policy, and the exit shows in its state."""

    async def ended_by_itself(*args: object) -> bool:
        return False

    monkeypatch.setattr(entrypoint, "run_worker", ended_by_itself)
    monkeypatch.setattr(entrypoint, "load_settings", lambda: worker_settings)
    monkeypatch.setattr(entrypoint, "configure_logging", lambda **_: None)

    assert entrypoint.main() == 1
