"""The two queues (docs/21-scheduler-workers.md section 5). Real Redis streams throughout."""

import asyncio
import io
import json
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from functools import partial
from pathlib import Path

import pytest
from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import NoPermissionError
from taskiq import ScheduledTask
from taskiq.exceptions import ScheduledTaskCancelledError, SendTaskError
from taskiq_redis import RedisStreamBroker

from sightline.config.logging import configure_logging
from sightline.worker import queues as queues_module
from sightline.worker import scheduler as scheduler_module
from sightline.worker.locks import RedisLock
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
    finish = asyncio.Event()

    def handler(queue: str):  # type: ignore[no-untyped-def]
        async def handle(message: Note) -> None:
            running[queue] += 1
            peak[queue] = max(peak[queue], running[queue])
            # Held until the test has seen how many run at once: no timing to get wrong.
            await finish.wait()
            running[queue] -= 1
            done.append((queue, message.number))

        return handle

    queues.register("collect", "call", handler("collect"))
    queues.register("process", "ingest", handler("process"))
    full = {"collect": 8, "process": 4}

    async with _receiving(queues, collect=8, process=4):
        for number in range(20):
            assert await queues.enqueue("call", Note(number=number), dedupe_key=f"call:{number}")
            assert await queues.enqueue(
                "ingest", Note(number=number), dedupe_key=f"ingest:{number}"
            )
        await eventually(lambda: running == full, within=30)
        # With every slot busy and messages waiting, no further handler starts, and no
        # message is taken from the stream ahead of its turn.
        await asyncio.sleep(0.5)
        assert running == full
        assert await _unacknowledged(redis, "collect") <= 9
        finish.set()
        await eventually(lambda: len(done) == 40, within=30)

    assert peak == full
    assert sorted(done) == sorted(
        [("collect", n) for n in range(20)] + [("process", n) for n in range(20)]
    )


async def test_a_message_sent_before_any_worker_was_reading_is_not_lost(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    handled: list[int] = []

    async def handle(message: Note) -> None:
        handled.append(message.number)

    queues.register("collect", "submit", handle)
    # Sent into a Redis that has never seen a worker: no stream, no consumer group.
    assert await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")

    async with _receiving(queues):
        await eventually(lambda: handled == [1])


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


async def test_an_acknowledgement_redis_misses_is_tried_again(
    redis: Redis, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Never acknowledged, the message would run a second time ten minutes later."""
    monkeypatch.setattr(queues_module, "_RECONNECT_AFTER_SECONDS", 0.01)
    queues = Queues(redis_url, redis)
    handled: list[int] = []
    misses = 0
    # taskiq-redis's own acknowledgement, which the queue wraps.
    real = RedisStreamBroker._ack_generator

    def flaky(self: RedisStreamBroker, id: str, queue_name: str):  # type: ignore[no-untyped-def]
        ack = real(self, id=id, queue_name=queue_name)

        async def once_more() -> None:
            nonlocal misses
            if misses < 2:
                misses += 1
                raise RedisConnectionError("reset by peer")
            await ack()

        return once_more

    monkeypatch.setattr(RedisStreamBroker, "_ack_generator", flaky)

    async def handle(message: Note) -> None:
        handled.append(message.number)

    queues.register("collect", "submit", handle)
    async with _receiving(queues):
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
        await eventually(lambda: misses == 2, within=10)
        await eventually(lambda: _none_unacknowledged(redis), within=10)

    assert (handled, misses) == ([1], 2)


async def test_a_handler_that_runs_too_long_is_stopped_before_its_message_is_handed_over(
    redis: Redis, redis_url: str
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    # Handed over after one second: the handler may run for four fifths of it.
    queues = Queues(redis_url, redis, redeliver_after=timedelta(seconds=1))
    finished = False

    async def stuck(message: Note) -> None:
        nonlocal finished
        await asyncio.sleep(10)
        finished = True

    queues.register("collect", "submit", stuck)
    async with _receiving(queues):
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
        await eventually(lambda: _is_clear(queues, "submit:1"), within=5)

    assert not finished
    (line,) = [json.loads(line) for line in stream.getvalue().splitlines() if "job failed" in line]
    assert line["err"]["type"] == "TimeoutError"


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
        try:
            held = await _unacknowledged(redis, "collect")
        finally:
            # Whatever was found, the handler is let go, so a failure here is a failure and
            # not a test that never ends.
            release.set()
        assert held == 1
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


async def test_a_message_is_checked_when_it_is_sent(redis: Redis, redis_url: str) -> None:
    queues = Queues(redis_url, redis)

    async def handle(message: Note) -> None: ...

    queues.register("collect", "submit", handle)

    with pytest.raises(TypeError, match="takes a Note"):
        await queues.enqueue("submit", Other(text="not a note"), dedupe_key="submit:bad")
    # Nothing was sent and nothing is held.
    assert not await queues.is_waiting("submit:bad")
    assert not await redis.exists("collect")


async def test_a_message_that_is_not_what_the_job_takes_never_reaches_the_handler(
    redis: Redis, redis_url: str
) -> None:
    """A worker of another release may send what this one does not take."""
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    queues, another_release = Queues(redis_url, redis), Queues(redis_url, redis)
    handled: list[Note] = []

    async def handle(message: Note) -> None:
        handled.append(message)

    async def handled_elsewhere(message: Other) -> None: ...

    queues.register("collect", "submit", handle)
    another_release.register("collect", "submit", handled_elsewhere)

    async with _receiving(queues):
        await another_release.enqueue(
            "submit", Other(text="secret-looking text"), dedupe_key="submit:bad"
        )
        await queues.enqueue("submit", Note(number=7), dedupe_key="submit:good")
        await eventually(lambda: handled == [Note(number=7)])
        await eventually(lambda: _none_unacknowledged(redis))
        await eventually(lambda: _is_clear(queues, "submit:bad"))
    await another_release.shutdown()

    (line,) = [
        json.loads(line) for line in stream.getvalue().splitlines() if "message refused" in line
    ]
    # The log names the fields that were wrong, never what was in them.
    assert (line["job"], line["fields"]) == ("submit", ["number"])
    assert "secret-looking text" not in stream.getvalue()


async def _die_mid_handler(redis: Redis, redis_url: str) -> None:
    """A worker takes message 1 and dies in its handler: nothing acknowledges the message.

    Its handler goes on running in this event loop, where a real crash would end it. With the
    usual time limit it runs past the test, never to acknowledge anything."""
    dying = Queues(redis_url, redis)
    started = asyncio.Event()

    async def never_finishes(message: Note) -> None:
        started.set()
        await asyncio.Event().wait()

    dying.register("collect", "submit", never_finishes)
    await dying.startup()
    doomed = asyncio.create_task(dying.receive("collect", concurrency=1, finish=asyncio.Event()))
    await dying.enqueue("submit", Note(number=1), dedupe_key="submit:1")
    await asyncio.wait_for(started.wait(), timeout=5)
    doomed.cancel()
    await asyncio.gather(doomed, return_exceptions=True)
    await dying.shutdown()
    assert await _unacknowledged(redis, "collect") == 1


@pytest.mark.usefixtures("abandoned_connections")
async def test_a_message_held_by_a_consumer_that_died_goes_to_another(
    redis: Redis, redis_url: str
) -> None:
    fast = timedelta(milliseconds=200)
    await _die_mid_handler(redis, redis_url)
    survivor = Queues(redis_url, redis, redeliver_after=fast)
    handled: list[int] = []

    async def handle(message: Note) -> None:
        handled.append(message.number)

    survivor.register("collect", "submit", handle)

    async with _receiving(survivor):
        # No new message is needed to bring it back: an idle consumer looks by itself.
        await eventually(lambda: handled == [1], within=10)
        await eventually(lambda: _none_unacknowledged(redis))


@pytest.mark.usefixtures("abandoned_connections")
async def test_a_busy_consumer_still_finds_the_messages_of_one_that_died(
    redis: Redis, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(queues_module, "CLAIM_EVERY", timedelta(milliseconds=300))
    fast = timedelta(milliseconds=200)
    await _die_mid_handler(redis, redis_url)
    survivor = Queues(redis_url, redis, redeliver_after=fast)
    handled: list[int] = []

    async def handle(message: Note) -> None:
        handled.append(message.number)

    survivor.register("collect", "submit", handle)

    async with _receiving(survivor):
        # New messages keep coming, so the consumer is never idle.
        for number in range(2, 60):
            await survivor.enqueue("submit", Note(number=number), dedupe_key=f"submit:{number}")
            await asyncio.sleep(0.02)
            if 1 in handled:
                break

    assert 1 in handled
    # It was found between new messages, not after the last of them.
    assert handled[-1] != 1 or len(handled) < 58


@pytest.mark.usefixtures("abandoned_connections")
async def test_redis_dropping_its_connections_leaves_the_handlers_and_their_limit_alone(
    redis: Redis, redis_url: str
) -> None:
    """The listener waits Redis out. Replaced by a new one, it would leave the handlers it
    had started running beside the new one's, over the limit, and unwaited for at stop."""
    queues = Queues(redis_url, redis)
    running, peak = 0, 0
    handled: list[int] = []
    release = asyncio.Event()

    async def handle(message: Note) -> None:
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        if message.number == 1:
            await release.wait()
        running -= 1
        handled.append(message.number)

    queues.register("collect", "submit", handle)

    async with _receiving(queues, collect=2) as finish:
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
        await eventually(lambda: running == 1)

        # What a Redis restart looks like to a client: every connection is closed under it.
        admin = Redis.from_url(redis_url)
        await admin.client_kill_filter(_type="normal", skipme=True)
        await admin.aclose()

        for number in (2, 3, 4):
            send = partial(_enqueued, queues, Note(number=number), f"submit:{number}")
            await eventually(send, within=10, every=0.2)
        await eventually(lambda: sorted(handled) == [2, 3, 4], within=15)
        assert peak == 2

        # Stopping waits for the handler that was running when the connections went.
        finish.set()
        await asyncio.sleep(0.3)
        assert handled.count(1) == 0
        release.set()

    assert sorted(handled) == [1, 2, 3, 4]


async def _enqueued(queues: Queues, message: Note, key: str) -> bool:
    try:
        return await queues.enqueue("submit", message, dedupe_key=key) or True
    except Exception:
        return False


async def test_the_queues_work_again_after_redis_comes_back_empty(
    redis: Redis, redis_url: str
) -> None:
    """Redis holds nothing that cannot be rebuilt, so it may be wiped. The worker reads again
    without being restarted, and what was sent before it noticed is not skipped."""
    queues = Queues(redis_url, redis)
    handled: list[int] = []

    async def handle(message: Note) -> None:
        handled.append(message.number)

    queues.register("collect", "submit", handle)
    queues.register("process", "ingest", handle)

    async with _receiving(queues):
        await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
        await eventually(lambda: handled == [1])

        await redis.flushdb()
        # Sent into the empty Redis before any consumer group exists again.
        await queues.enqueue("submit", Note(number=2), dedupe_key="submit:2")
        await queues.enqueue("ingest", Note(number=3), dedupe_key="ingest:3")

        await eventually(lambda: sorted(handled) == [1, 2, 3], within=15)
        await queues.enqueue("submit", Note(number=4), dedupe_key="submit:4")
        await eventually(lambda: sorted(handled) == [1, 2, 3, 4], within=10)


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


async def test_stopping_waits_for_handlers_in_flight_and_leaves_the_rest_for_the_next_worker(
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

    # The two that had started ran to the end, and no third one started.
    assert sorted(finished) == sorted(started)
    assert len(started) <= 3
    # The rest were never taken: nothing sits with a consumer that is gone, waiting out the
    # redelivery time.
    assert await _unacknowledged(redis, "collect") == 0

    following = Queues(redis_url, redis)
    later: list[int] = []

    async def handle_later(message: Note) -> None:
        later.append(message.number)

    following.register("collect", "submit", handle_later)
    async with _receiving(following):
        await eventually(lambda: sorted(started + later) == list(range(6)), within=10)


async def test_a_stream_is_capped(
    redis: Redis, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Redis has no eviction. A backlog nobody reads does not grow until it fills memory."""
    monkeypatch.setattr(queues_module, "STREAM_MAX_LENGTH", 100)
    queues = Queues(redis_url, redis)

    async def handle(message: Note) -> None: ...

    queues.register("collect", "submit", handle)
    await queues.startup()
    for number in range(600):
        await queues.enqueue("submit", Note(number=number), dedupe_key=f"submit:{number}")
    await queues.shutdown()

    # Trimming is approximate: whole blocks of entries are dropped, never fewer than the cap.
    assert 100 <= await redis.xlen("collect") < 400


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
        queues.register_scheduled("often", _nothing, every=timedelta(milliseconds=10))
    with pytest.raises(ValueError, match="one of them"):
        queues.register_scheduled("neither", _nothing)
    with pytest.raises(ValueError, match="one of them"):
        queues.register_scheduled("both", _nothing, every=timedelta(hours=1), cron="0 * * * *")
    with pytest.raises(ValueError, match="registered twice"):
        queues.register_scheduled("submit", _nothing, every=timedelta(hours=1))


async def _nothing() -> None: ...


# -------------------------------------------------------------------------------------------------
# Scheduled jobs


def _scheduled(job: str, cron: str | None = None) -> ScheduledTask:
    if cron is not None:
        return ScheduledTask(task_name=job, labels={}, args=[], kwargs={}, cron=cron)
    return ScheduledTask(task_name=job, labels={}, args=[], kwargs={}, interval=1)


async def test_a_scheduled_run_is_sent_once(redis: Redis, redis_url: str) -> None:
    """Two schedulers at a change of the lock, or one that has just started, would each send
    the same run. The claim is made when a run is sent: an interval job for half its period,
    a cron job for its minute, whenever in the minute the second scheduler starts."""
    first, second = Queues(redis_url, redis), Queues(redis_url, redis)
    for queues in (first, second):
        queues.register_scheduled("reconcile", _nothing, every=timedelta(seconds=4))
        queues.register_scheduled("partitions", _nothing, cron="10 0 * * *")
    one, other = first.schedule_source(), second.schedule_source()

    await one.pre_send(_scheduled("reconcile"))
    with pytest.raises(ScheduledTaskCancelledError):
        await other.pre_send(_scheduled("reconcile"))
    # Another job has its own claim.
    await one.pre_send(_scheduled("partitions", cron="10 0 * * *"))
    with pytest.raises(ScheduledTaskCancelledError):
        await other.pre_send(_scheduled("partitions", cron="10 0 * * *"))

    assert 1500 < await redis.pttl("dedupe:scheduled:reconcile") <= 2000
    (minute,) = [key async for key in redis.scan_iter("dedupe:scheduled:partitions:*")]
    # Past the end of the minute the run was sent in.
    assert 60_000 < await redis.pttl(minute) <= 120_000
    # The next run, a period later, finds the claim gone.
    await redis.pexpire("dedupe:scheduled:reconcile", 1)
    await asyncio.sleep(0.05)
    await other.pre_send(_scheduled("reconcile"))
    for queues in (first, second):
        await queues.shutdown()


async def test_a_scheduled_run_is_not_sent_when_redis_cannot_be_asked(redis_url: str) -> None:
    unreachable = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2)
    queues = Queues(redis_url, unreachable)
    queues.register_scheduled("reconcile", _nothing, every=timedelta(seconds=4))

    with pytest.raises(ScheduledTaskCancelledError):
        await queues.schedule_source().pre_send(_scheduled("reconcile"))
    await unreachable.aclose()
    await queues.shutdown()


async def test_a_job_is_scheduled_by_interval_or_by_time_of_day(
    redis: Redis, redis_url: str
) -> None:
    queues = Queues(redis_url, redis)
    queues.register_scheduled("reconcile", _nothing, every=timedelta(minutes=5))
    queues.register_scheduled("partitions", _nothing, cron="10 0 * * *")
    source = queues.schedule_source()

    await source.startup()
    schedules = {task.task_name: task for task in await source.get_schedules()}

    assert (schedules["reconcile"].interval, schedules["reconcile"].cron) == (300, None)
    assert (schedules["partitions"].interval, schedules["partitions"].cron) == (None, "10 0 * * *")
    await queues.shutdown()


async def _exists(redis: Redis, key: str) -> bool:
    return bool(await redis.exists(key))


def _recording(queues: Queues, name: str, attempts: list[str]) -> None:
    """Note which process's scheduler tries to send."""
    source = queues.schedule_source()
    send = source.pre_send

    async def pre_send(task: ScheduledTask) -> None:
        attempts.append(name)
        await send(task)

    source.pre_send = pre_send  # type: ignore[method-assign]
    queues.schedule_source = lambda: source  # type: ignore[method-assign]


async def test_one_scheduler_runs_at_a_time_and_keeps_its_lock_alive(
    redis: Redis, redis_url: str
) -> None:
    """Two worker processes: each has a scheduler, and one holds the scheduler lock for as
    long as it runs, well past the lock's own time to live."""
    runs: list[float] = []
    attempts: list[str] = []

    async def maintenance() -> None:
        runs.append(asyncio.get_running_loop().time())

    first, second = Queues(redis_url, redis), Queues(redis_url, redis)
    for name, queues in (("first", first), ("second", second)):
        queues.register_scheduled("reconcile", maintenance, every=timedelta(seconds=1))
        _recording(queues, name, attempts)
    quick = {"lock_ttl": timedelta(milliseconds=600), "renew_every": timedelta(milliseconds=200)}

    stop = asyncio.Event()
    async with _receiving(first), _receiving(second):
        schedulers = [
            asyncio.create_task(run_scheduler(queues, redis, stop, **quick))
            for queues in (first, second)
        ]
        await eventually(partial(_exists, redis, "lock:taskiq-scheduler"))
        holder = await redis.get("lock:taskiq-scheduler")
        await asyncio.sleep(3.6)
        still = await redis.get("lock:taskiq-scheduler")
        stop.set()
        await asyncio.gather(*schedulers)

    # The lock never changed hands, so one scheduler did all the sending.
    assert still == holder
    assert len(set(attempts)) == 1, attempts
    # One run a second for 3.6 seconds.
    assert 3 <= len(runs) <= 5, runs
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
    first.register_scheduled("reconcile", job("first"), every=timedelta(seconds=1))
    second.register_scheduled("reconcile", job("second"), every=timedelta(seconds=1))
    quick = {"lock_ttl": timedelta(milliseconds=600), "renew_every": timedelta(milliseconds=200)}

    stop_first, stop_second = asyncio.Event(), asyncio.Event()
    await first.startup()
    finish_first = asyncio.Event()
    first_receiver = asyncio.create_task(
        first.receive("process", concurrency=2, finish=finish_first)
    )
    async with _receiving(second):
        holder = asyncio.create_task(run_scheduler(first, redis, stop_first, **quick))
        await asyncio.sleep(0.3)
        waiting = asyncio.create_task(run_scheduler(second, redis, stop_second, **quick))
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

    assert set(runs[count:]) == {"second"}


async def test_a_scheduler_that_falls_over_is_started_again(
    redis: Redis, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    queues = Queues(redis_url, redis)
    starts = 0

    async def falls_over_once(*args: object, **kwargs: object) -> None:
        nonlocal starts
        starts += 1
        if starts == 1:
            raise RuntimeError("the schedule could not be read")
        await asyncio.Event().wait()

    monkeypatch.setattr(scheduler_module, "run_scheduler_task", falls_over_once)
    stop = asyncio.Event()
    quick = {"lock_ttl": timedelta(milliseconds=600), "renew_every": timedelta(milliseconds=100)}

    running = asyncio.create_task(run_scheduler(queues, redis, stop, **quick))
    await eventually(lambda: starts == 2, within=5)
    stop.set()
    # It ends because it was asked to, not with the scheduler's error.
    await asyncio.wait_for(running, timeout=5)

    (line,) = [
        json.loads(line) for line in stream.getvalue().splitlines() if "scheduler ended" in line
    ]
    assert (line["level"], line["err"]["type"]) == ("error", "RuntimeError")
    assert not await redis.exists("lock:taskiq-scheduler")
    await queues.shutdown()


async def test_a_scheduler_that_loses_its_lock_stops_sending(
    redis: Redis, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The process stalled and its lock expired: another process may be scheduling now."""
    queues = Queues(redis_url, redis)
    running_now, starts = 0, 0

    async def scheduling(*args: object, **kwargs: object) -> None:
        nonlocal running_now, starts
        starts += 1
        running_now += 1
        try:
            await asyncio.Event().wait()
        finally:
            running_now -= 1

    monkeypatch.setattr(scheduler_module, "run_scheduler_task", scheduling)
    stop = asyncio.Event()
    quick = {"lock_ttl": timedelta(milliseconds=600), "renew_every": timedelta(milliseconds=100)}
    running = asyncio.create_task(run_scheduler(queues, redis, stop, **quick))
    await eventually(lambda: running_now == 1, within=5)

    # Another process takes the lock while this one was not looking.
    await redis.delete("lock:taskiq-scheduler")
    thief = RedisLock(redis, "taskiq-scheduler", timedelta(seconds=1))
    assert await thief.acquire()
    await eventually(lambda: running_now == 0, within=5)
    # It does not take the other's lock away, and tries again once the lock is free.
    assert await redis.get("lock:taskiq-scheduler") is not None
    await thief.release()
    await eventually(lambda: starts == 2, within=5)

    stop.set()
    await asyncio.wait_for(running, timeout=5)
    await queues.shutdown()


async def test_a_scheduler_without_redis_keeps_trying_and_stops_when_asked(
    redis_url: str,
) -> None:
    stream = io.StringIO()
    configure_logging(service="worker", version="test", level="info", stream=stream)
    unreachable = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2)
    queues = Queues(redis_url, unreachable)
    stop = asyncio.Event()
    quick = {"lock_ttl": timedelta(milliseconds=600), "renew_every": timedelta(milliseconds=100)}

    running = asyncio.create_task(run_scheduler(queues, unreachable, stop, **quick))
    await asyncio.sleep(0.6)
    assert not running.done()
    stop.set()
    await asyncio.wait_for(running, timeout=5)

    assert stream.getvalue().count("scheduler lock not reachable") >= 2
    await unreachable.aclose()
    await queues.shutdown()


# -------------------------------------------------------------------------------------------------
# The Redis user the worker connects as


def _documented_acl() -> dict[str, list[str]]:
    """The rules of the `app` user, from the infrastructure document that deploys them."""
    document = Path(__file__).parents[3] / "docs" / "22-infrastructure-devops.md"
    (rule,) = re.findall(r"^user app on #\S+ (.+)$", document.read_text(), flags=re.MULTILINE)
    words = [word for word in str(rule).split() if word not in ("resetkeys", "resetchannels")]
    keys = [word[1:] for word in words if word.startswith("~")]
    commands = [word for word in words if word[0] in "+-" and not word.startswith(("+@", "-@"))]
    categories = [word for word in words if word.startswith(("+@", "-@"))]
    assert len(keys) + len(commands) + len(categories) == len(words), words
    return {"keys": keys, "commands": commands, "categories": categories}


async def test_the_queues_work_as_the_redis_user_the_deployment_gives_them(
    redis: Redis, redis_url: str
) -> None:
    """Every key and command the queues, the claims and the locks use must be allowed to the
    `app` user, or the worker fails in production only."""
    acl = _documented_acl()
    await redis.acl_setuser(
        "app",
        enabled=True,
        reset=True,
        passwords=["+secret"],
        categories=acl["categories"],
        commands=acl["commands"],
        keys=acl["keys"],
    )
    as_app = redis_url.replace("redis://", "redis://app:secret@")
    client = Redis.from_url(as_app)
    fast = timedelta(milliseconds=200)
    queues = Queues(as_app, client, redeliver_after=fast)
    handled: list[int] = []
    scheduled = 0

    async def handle(message: Note) -> None:
        handled.append(message.number)

    async def maintenance() -> None:
        nonlocal scheduled
        scheduled += 1

    queues.register("collect", "submit", handle)
    queues.register("process", "ingest", handle)
    queues.register_scheduled("reconcile", maintenance, every=timedelta(seconds=1))
    stop = asyncio.Event()
    try:
        # The user is what the document says: it may not wipe the store.
        with pytest.raises(NoPermissionError):
            await client.flushdb()
        async with _receiving(queues):
            scheduler = asyncio.create_task(run_scheduler(queues, client, stop))
            await queues.enqueue("submit", Note(number=1), dedupe_key="submit:1")
            await queues.enqueue("ingest", Note(number=2), dedupe_key="ingest:2")
            await eventually(lambda: sorted(handled) == [1, 2], within=10)
            await eventually(lambda: _is_clear(queues, "submit:1"))
            # Long enough for a look for messages left by a dead consumer, and a scheduled run.
            await eventually(lambda: scheduled >= 1, within=10)
            stop.set()
            await scheduler
    finally:
        await client.aclose()
        await redis.acl_deluser("app")
