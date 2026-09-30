"""The worker process as a whole (docs/21-scheduler-workers.md sections 5.1 and 12)."""

import asyncio
import io
import json
import os
import signal
import threading
from collections.abc import Sequence
from datetime import timedelta
from pathlib import Path

import pytest
from pydantic import BaseModel, SecretStr
from redis.asyncio import Redis

from sightline.config.logging import configure_logging
from sightline.config.settings import Settings
from sightline.worker import __main__ as entrypoint
from sightline.worker import app as worker_app
from sightline.worker.app import WorkerContext, run_worker
from sightline.worker.assembly import assemble
from sightline.worker.ticks import Tick
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
    await asyncio.wait_for(running, timeout=10)
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
    # The first tick fires before the receivers have joined their streams; a later one lands.
    await eventually(lambda: len(handled) >= 2, within=10)
    stop.set()
    await asyncio.wait_for(running, timeout=10)

    (context,) = contexts
    assert context.settings is worker_settings
    # The worker connects as its own database role.
    assert "app_worker" in worker_settings.database_url.get_secret_value()


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
            "database_url": SecretStr(f"postgresql://app_worker:x@{black_hole}/sightline"),
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


async def test_a_part_that_ends_by_itself_stops_the_whole_worker(
    worker_settings: Settings, redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)

    async def broken_scheduler(*args: object, **kwargs: object) -> None:
        raise RuntimeError("the scheduler fell over")

    monkeypatch.setattr(worker_app, "run_scheduler", broken_scheduler)

    # Nobody sets `stop`: the worker ends because one of its parts did.
    await asyncio.wait_for(run_worker(worker_settings, _nothing, asyncio.Event()), timeout=10)

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
        return assemble(context)

    monkeypatch.setattr(entrypoint, "assemble", recording)
    monkeypatch.setattr(entrypoint, "load_settings", lambda: worker_settings)
    monkeypatch.setattr(entrypoint, "configure_logging", lambda **_: None)
    # What `docker stop` sends, a moment after the worker has started.
    threading.Timer(1.0, os.kill, (os.getpid(), signal.SIGTERM)).start()

    assert entrypoint.main() == 0
    # It ran the real parts of the worker, built from the settings it loaded.
    assert [context.settings for context in assembled] == [worker_settings]
