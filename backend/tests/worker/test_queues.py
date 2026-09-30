"""The two queues (docs/21-scheduler-workers.md section 5). Real Redis streams throughout."""

import asyncio
import io
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

import pytest
from pydantic import BaseModel
from redis.asyncio import Redis
from taskiq.exceptions import SendTaskError

from sightline.config.logging import configure_logging
from sightline.worker.queues import CONSUMER_GROUP, Queues
from sightline.worker.scheduler import run_scheduler
from tests.worker.conftest import eventually


class Note(BaseModel):
    number: int


class Other(BaseModel):
    text: str


@asynccontextmanager
async def _receiving(
    queues: Queues, *, collect: int = 8, process: int = 4
) -> AsyncIterator[asyncio.Event]:
    """Start both receivers; on exit ask them to finish and wait until they have."""
    await queues.startup()
    finish = asyncio.Event()
    receivers = [
        asyncio.create_task(queues.receive("collect", concurrency=collect, finish=finish)),
        asyncio.create_task(queues.receive("process", concurrency=process, finish=finish)),
    ]
    # The consumer groups read from "now": give the receivers a moment to join before sending.
    await asyncio.sleep(0.2)
    try:
        yield finish
    finally:
        finish.set()
        await asyncio.gather(*receivers)
        await queues.shutdown()


async def _unacknowledged(redis: Redis, queue: str) -> int:
    summary = await redis.xpending(queue, CONSUMER_GROUP)
    return int(summary["pending"])


async def test_each_queue_runs_its_handlers_at_its_own_concurrency(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    running = {"collect": 0, "process": 0}
    peak = {"collect": 0, "process": 0}
    done: list[tuple[str, int]] = []

    def handler(queue: str):  # type: ignore[no-untyped-def]
        async def handle(message: Note) -> None:
            running[queue] += 1
            peak[queue] = max(peak[queue], running[queue])
            await asyncio.sleep(0.1)
            running[queue] -= 1
            done.append((queue, message.number))

        return handle

    queues.register("collect", "call", handler("collect"))
    queues.register("process", "ingest", handler("process"))

    async with _receiving(queues, collect=8, process=4):
        for number in range(20):
            assert await queues.enqueue("call", Note(number=number), dedupe_key=f"call:{number}")
            assert await queues.enqueue(
                "ingest", Note(number=number), dedupe_key=f"ingest:{number}"
            )
        await eventually(lambda: len(done) == 40)

    assert peak == {"collect": 8, "process": 4}
    assert sorted(done) == sorted(
        [("collect", n) for n in range(20)] + [("process", n) for n in range(20)]
    )


async def test_a_message_is_sent_once_while_its_key_is_held_and_again_after(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    release = asyncio.Event()
    handled: list[int] = []

    async def handle(message: Note) -> None:
        await release.wait()
        handled.append(message.number)

    queues.register("collect", "submit", handle)

    async with _receiving(queues):
        assert await queues.enqueue("submit", Note(number=1), dedupe_key="submit:abc")
        # Waiting or running: a second producer finds the key and sends nothing.
        assert not await queues.enqueue("submit", Note(number=2), dedupe_key="submit:abc")
        assert await queues.is_waiting("submit:abc")
        assert 3500 < await redis.ttl("dedupe:submit:abc") <= 3600
        release.set()
        await eventually(lambda: handled == [1])
        # The handler cleared the key when it finished.
        await eventually(lambda: _is_clear(queues, "submit:abc"))
        assert await queues.enqueue("submit", Note(number=3), dedupe_key="submit:abc")
        await eventually(lambda: handled == [1, 3])


async def _is_clear(queues: Queues, key: str) -> bool:
    return not await queues.is_waiting(key)


async def test_a_message_is_acknowledged_only_after_its_handler_finishes(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    started, release = asyncio.Event(), asyncio.Event()

    async def handle(message: Note) -> None:
        started.set()
        await release.wait()

    queues.register("collect", "slow", handle)

    async with _receiving(queues):
        await queues.enqueue("slow", Note(number=1), dedupe_key="slow:1")
        await asyncio.wait_for(started.wait(), timeout=5)
        assert await _unacknowledged(redis, "collect") == 1
        release.set()
        await eventually(lambda: _none_unacknowledged(redis))


async def _none_unacknowledged(redis: Redis) -> bool:
    return await _unacknowledged(redis, "collect") == 0


async def test_a_handler_that_raises_is_logged_and_nothing_is_retried(
    redis: Redis, redis_url: str
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    queues = Queues(redis_url, redis)
    calls = 0

    async def handle(message: Note) -> None:
        nonlocal calls
        calls += 1
        raise RuntimeError("the provider answered nonsense")

    queues.register("collect", "submit", handle)

    async with _receiving(queues):
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
        await eventually(lambda: calls == 1)
        await eventually(lambda: _none_unacknowledged(redis))
        await eventually(lambda: _is_clear(queues, "submit:1"))
        await asyncio.sleep(0.3)

    # The queue does not know whether a provider was paid, so it never tries again by itself.
    assert calls == 1
    (line,) = [json.loads(line) for line in stream.getvalue().splitlines() if "job failed" in line]
    assert (line["job"], line["level"], line["err"]["type"]) == ("submit", "error", "RuntimeError")


async def test_a_message_that_is_not_what_the_job_takes_never_reaches_the_handler(
    redis: Redis, redis_url: str
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    queues = Queues(redis_url, redis)
    handled: list[Note] = []

    async def handle(message: Note) -> None:
        handled.append(message)

    queues.register("collect", "submit", handle)

    async with _receiving(queues):
        await queues.enqueue("submit", Other(text="secret-looking text"), dedupe_key="submit:bad")
        await queues.enqueue("submit", Note(number=7), dedupe_key="submit:good")
        await eventually(lambda: handled == [Note(number=7)])
        await eventually(lambda: _none_unacknowledged(redis))
        await eventually(lambda: _is_clear(queues, "submit:bad"))

    (line,) = [
        json.loads(line) for line in stream.getvalue().splitlines() if "message refused" in line
    ]
    # The log names the fields that were wrong, never what was in them.
    assert (line["job"], line["fields"]) == ("submit", ["number"])
    assert "secret-looking text" not in stream.getvalue()


@pytest.mark.usefixtures("abandoned_connections")
async def test_a_message_held_by_a_consumer_that_died_goes_to_another(
    redis: Redis, redis_url: str
) -> None:
    fast = timedelta(milliseconds=200)
    dying, survivor = (
        Queues(redis_url, redis, redeliver_after=fast),
        Queues(redis_url, redis, redeliver_after=fast),
    )
    started = asyncio.Event()
    handled: list[int] = []

    async def never_finishes(message: Note) -> None:
        started.set()
        await asyncio.Event().wait()

    async def handle(message: Note) -> None:
        handled.append(message.number)

    dying.register("collect", "submit", never_finishes)
    survivor.register("collect", "submit", handle)

    await dying.startup()
    doomed = asyncio.create_task(dying.receive("collect", concurrency=1, finish=asyncio.Event()))
    await asyncio.sleep(0.2)
    await dying.enqueue("submit", Note(number=1), dedupe_key="submit:1")
    await asyncio.wait_for(started.wait(), timeout=5)
    # The process dies mid-handler: nothing acknowledges the message.
    doomed.cancel()
    await asyncio.gather(doomed, return_exceptions=True)
    await dying.shutdown()
    assert await _unacknowledged(redis, "collect") == 1

    async with _receiving(survivor):
        await asyncio.sleep(0.3)
        # The stream hands over abandoned messages when it next delivers a new one.
        await survivor.enqueue("submit", Note(number=2), dedupe_key="submit:2")
        await eventually(lambda: sorted(handled) == [1, 2])
        await eventually(lambda: _none_unacknowledged(redis))


@pytest.mark.usefixtures("abandoned_connections")
async def test_the_receivers_come_back_after_redis_drops_their_connections(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    handled: list[int] = []

    async def handle(message: Note) -> None:
        handled.append(message.number)

    queues.register("collect", "submit", handle)

    async with _receiving(queues):
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
        await eventually(lambda: handled == [1])

        # What a Redis restart looks like to a client: every connection is closed under it.
        admin = Redis.from_url(redis_url)
        await admin.client_kill_filter(_type="normal", skipme=True)
        await admin.aclose()

        await eventually(
            lambda: _enqueued(queues, Note(number=2), "submit:2"), within=10, every=0.2
        )
        await eventually(lambda: handled == [1, 2], within=10)


async def _enqueued(queues: Queues, message: Note, key: str) -> bool:
    try:
        return await queues.enqueue("submit", message, dedupe_key=key) or True
    except Exception:
        return False


async def test_a_send_that_fails_does_not_leave_its_key_behind(
    redis: Redis, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    queues = Queues(redis_url, redis)

    async def handle(message: Note) -> None: ...

    queues.register("collect", "submit", handle)
    await queues.startup()

    async def broken(*args: object, **kwargs: object) -> None:
        raise ConnectionError("redis is gone")

    monkeypatch.setattr(queues.broker("collect"), "kick", broken)
    with pytest.raises(SendTaskError):
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")

    # Otherwise the work would be blocked for an hour by a message that was never sent.
    assert not await queues.is_waiting("submit:1")
    await queues.shutdown()


async def test_stopping_waits_for_handlers_in_flight_and_starts_no_more(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    started: list[int] = []
    finished: list[int] = []

    async def handle(message: Note) -> None:
        started.append(message.number)
        await asyncio.sleep(0.4)
        finished.append(message.number)

    queues.register("collect", "submit", handle)

    async with _receiving(queues, collect=2) as finish:
        for number in range(6):
            await queues.enqueue("submit", Note(number=number), dedupe_key=f"submit:{number}")
        await eventually(lambda: len(started) == 2)
        finish.set()

    # The two that had started ran to the end. The rest stay in Redis for the next process.
    assert sorted(finished) == sorted(started)
    assert len(started) == 2
    assert await redis.xlen("collect") == 6


async def test_a_job_is_registered_once_and_takes_one_model(redis: Redis, redis_url: str) -> None:
    queues = Queues(redis_url, redis)

    async def handle(message: Note) -> None: ...

    async def takes_a_number(message: int) -> None: ...

    queues.register("collect", "submit", handle)
    with pytest.raises(ValueError, match="registered twice"):
        queues.register("process", "submit", handle)
    with pytest.raises(TypeError, match="one Pydantic model"):
        queues.register("collect", "bad", takes_a_number)  # type: ignore[type-var]
    with pytest.raises(ValueError, match="once a second"):
        queues.register_scheduled("process", "often", _nothing, every=timedelta(milliseconds=10))


async def _nothing() -> None: ...


async def test_a_scheduled_job_runs_once_per_period_with_two_schedulers(
    redis: Redis, redis_url: str
) -> None:
    """Two worker processes: each has a scheduler, and one holds the scheduler lock."""
    runs: list[float] = []

    async def maintenance() -> None:
        runs.append(asyncio.get_running_loop().time())

    first, second = Queues(redis_url, redis), Queues(redis_url, redis)
    for queues in (first, second):
        queues.register_scheduled("process", "reconcile", maintenance, every=timedelta(seconds=1))

    stop = asyncio.Event()
    async with _receiving(first), _receiving(second):
        schedulers = [
            asyncio.create_task(run_scheduler(queues.broker("process"), redis, stop))
            for queues in (first, second)
        ]
        await asyncio.sleep(3.6)
        stop.set()
        await asyncio.gather(*schedulers)

    # One run a second for 3.6 seconds. Two schedulers without the lock would make about seven.
    assert 3 <= len(runs) <= 4, runs
    assert not await redis.exists("lock:taskiq-scheduler")


async def test_when_the_scheduler_holding_the_lock_stops_another_takes_over(
    redis: Redis, redis_url: str
) -> None:
    runs: list[str] = []

    def job(who: str):  # type: ignore[no-untyped-def]
        async def maintenance() -> None:
            runs.append(who)

        return maintenance

    first, second = Queues(redis_url, redis), Queues(redis_url, redis)
    first.register_scheduled("process", "reconcile", job("first"), every=timedelta(seconds=1))
    second.register_scheduled("process", "reconcile", job("second"), every=timedelta(seconds=1))
    quick = {"lock_ttl": timedelta(milliseconds=600), "renew_every": timedelta(milliseconds=200)}

    stop_first, stop_second = asyncio.Event(), asyncio.Event()
    await first.startup()
    finish_first = asyncio.Event()
    first_receiver = asyncio.create_task(
        first.receive("process", concurrency=2, finish=finish_first)
    )
    async with _receiving(second):
        holder = asyncio.create_task(
            run_scheduler(first.broker("process"), redis, stop_first, **quick)
        )
        await asyncio.sleep(0.3)
        waiting = asyncio.create_task(
            run_scheduler(second.broker("process"), redis, stop_second, **quick)
        )
        await eventually(lambda: len(runs) >= 1, within=5)

        # The first process stops: its scheduler ends and gives the lock up.
        stop_first.set()
        await holder
        finish_first.set()
        await first_receiver
        await first.shutdown()
        count = len(runs)

        await eventually(lambda: len(runs) >= count + 2, within=6)
        stop_second.set()
        await waiting

    assert "second" in runs[count:]
