"""The DataForSEO HTTP client: its turn under the limit, and what a failed call means
(docs/06-dataforseo-seo-integration.md sections 3.2 and 9)."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from collections.abc import AsyncIterator
from datetime import timedelta
from decimal import Decimal

import httpx
import pytest

from idraft.domain.retries import ProviderErrorKind as K
from idraft.providers.contract import ProviderCallError
from idraft.providers.dataforseo import client as client_module
from idraft.providers.dataforseo.client import TURN_WAIT, DataForSeoClient
from idraft.providers.dataforseo.errors import MESSAGE_MAX
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    as_json,
    envelope,
    fixture,
    fixture_bytes,
    task_answer,
)

PATH = "/v3/appendix/user_data"


@pytest.fixture
def events() -> list[str]:
    return []


@pytest.fixture
def api(events: list[str]) -> Api:
    return Api(events)


@pytest.fixture
def gate(events: list[str]) -> FakeGate:
    return FakeGate(events)


@pytest.fixture
async def client(api: Api, gate: FakeGate) -> AsyncIterator[DataForSeoClient]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        yield DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)


def _raising(error: Exception) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return httpx.MockTransport(handler)


async def _failure(
    transport: httpx.MockTransport,
    *,
    sending: bool,
    gate: FakeGate | None = None,
    follow_redirects: bool = False,
) -> ProviderCallError:
    async with httpx.AsyncClient(transport=transport, follow_redirects=follow_redirects) as http:
        client = DataForSeoClient(
            http, gate or FakeGate([]), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        with pytest.raises(ProviderCallError) as caught:
            await client.call("POST" if sending else "GET", PATH, sending=sending, body=[{}])
    return caught.value


async def test_a_call_takes_its_turn_first_and_sends_basic_auth(
    client: DataForSeoClient, api: Api, gate: FakeGate, events: list[str]
) -> None:
    api.answer("GET", PATH, fixture("user_data"))

    answer = await client.call("GET", PATH, family="user_data")

    assert events == ["turn user_data", f"call GET {PATH}"]
    assert gate.waits == [TURN_WAIT]
    token = base64.b64encode(f"{LOGIN}:{PASSWORD}".encode()).decode()
    assert api.requests[0].headers["authorization"] == f"Basic {token}"
    assert str(api.requests[0].url) == f"{ORIGIN}{PATH}"
    assert answer.envelope.status_code == 20000


async def test_a_post_sends_its_tasks_as_json(client: DataForSeoClient, api: Api) -> None:
    api.answer("POST", "/v3/x/task_post", fixture("task_post"))

    await client.call("POST", "/v3/x/task_post", sending=True, body=[{"keyword": "crm"}])

    assert api.posted() == [{"keyword": "crm"}]
    assert api.requests[0].headers["content-type"] == "application/json"


async def test_the_answer_is_kept_as_received_and_its_numbers_exact(
    client: DataForSeoClient, api: Api
) -> None:
    raw = fixture_bytes("task_post")
    api.on(
        "GET",
        PATH,
        lambda _request: httpx.Response(
            200, content=raw, headers={"content-type": "application/json; charset=utf-8"}
        ),
    )

    answer = await client.call("GET", PATH)

    assert answer.content == raw
    assert answer.content_type == "application/json"
    task = answer.tasks[0]
    assert task is not None
    assert task.cost == Decimal("0.0012")


async def test_no_turn_means_no_call(api: Api, events: list[str]) -> None:
    gate = FakeGate(events, gives_turns=False)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
        with pytest.raises(ProviderCallError) as caught:
            await client.call("POST", PATH, sending=True, body=[{}])

    # Not the provider's limit: nothing is slowed for it, and it is not an attempt.
    assert caught.value.error.kind is K.NOT_SENT
    assert gate.slowed == 0
    assert api.requests == []


async def test_a_gate_that_cannot_be_reached_means_no_call(api: Api, events: list[str]) -> None:
    gate = FakeGate(events, fails=True)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
        with pytest.raises(ProviderCallError) as caught:
            await client.call("POST", PATH, sending=True, body=[{}])

    # Not sent, so not an unknown outcome.
    assert caught.value.error.kind is K.NOT_SENT
    assert "ConnectionError" in caught.value.error.message
    assert api.requests == []


async def test_a_mistake_in_asking_for_a_turn_means_no_call_and_no_throttling(
    api: Api,
) -> None:
    class Mistaken(FakeGate):
        async def enter(self, family: str | None, *, within: timedelta) -> bool:
            raise KeyError(family)

    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(http, Mistaken([]), login=LOGIN, password=PASSWORD, origin=ORIGIN)
        with pytest.raises(ProviderCallError) as caught:
            await client.call("POST", PATH, family="nothing", sending=True, body=[{}])

    # Not sent, so never an unknown outcome; not our limiter's doing either.
    assert caught.value.error.kind is K.PROVIDER_ERROR
    assert caught.value.error.message == "the call was not made: KeyError"
    assert api.requests == []


async def test_a_limiter_that_cannot_be_slowed_does_not_hide_the_answer() -> None:
    gate = FakeGate([], cannot_slow=True)
    body = envelope([], status_code=40202, message="Rate limit exceeded.")

    failure = await _failure(
        httpx.MockTransport(lambda _request: as_json(body)), sending=False, gate=gate
    )

    assert failure.error.kind is K.RATE_LIMITED
    assert gate.slowed == 1


async def test_a_limiter_slow_to_slow_down_is_not_waited_for(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(client_module, "SLOW_DOWN_WAIT", 0.05)

    class Stuck(FakeGate):
        async def slow_down(self) -> None:
            await asyncio.sleep(10)

    body = envelope([], status_code=40202, message="Rate limit exceeded.")
    started = time.monotonic()

    failure = await _failure(
        httpx.MockTransport(lambda _request: as_json(body)), sending=False, gate=Stuck([])
    )

    assert failure.error.kind is K.RATE_LIMITED
    assert time.monotonic() - started < 1


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("refused"),
        httpx.ConnectTimeout("slow handshake"),
        httpx.PoolTimeout("no connection free"),
        httpx.UnsupportedProtocol("no scheme"),
    ],
)
@pytest.mark.parametrize("sending", [True, False])
async def test_a_connection_that_never_opened_sent_nothing(
    error: Exception, *, sending: bool
) -> None:
    failure = await _failure(_raising(error), sending=sending)

    # Not an attempt at the task: a network outage of minutes must not end tasks.
    assert failure.error.kind is K.NOT_SENT
    assert failure.error.message.startswith("the provider could not be reached")


@pytest.mark.parametrize("error", [httpx.ReadTimeout("no answer"), httpx.WriteTimeout("slow")])
@pytest.mark.parametrize(("sending", "kind"), [(True, K.TIMEOUT), (False, K.PROVIDER_ERROR)])
async def test_a_timeout_after_sending_is_unknown_only_when_tasks_were_sent(
    error: Exception, *, sending: bool, kind: K
) -> None:
    """A read that timed out is simply read again: `timeout` means the provider may have a
    task, and nothing else."""
    failure = await _failure(_raising(error), sending=sending)

    assert failure.error.kind is kind
    assert failure.error.message == type(error).__name__


@pytest.mark.parametrize(("sending", "kind"), [(True, K.TIMEOUT), (False, K.PROVIDER_ERROR)])
async def test_a_dropped_connection_is_unknown_only_when_tasks_were_sent(
    *, sending: bool, kind: K
) -> None:
    failure = await _failure(
        _raising(httpx.RemoteProtocolError("server disconnected")), sending=sending
    )

    assert failure.error.kind is kind


async def test_too_many_calls_slow_the_limiter_and_keep_the_wait(gate: FakeGate) -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(429, headers={"Retry-After": "12"})
    )

    failure = await _failure(transport, sending=True, gate=gate)

    assert failure.error.kind is K.RATE_LIMITED
    assert failure.error.retry_after == timedelta(seconds=12)
    assert gate.slowed == 1


async def test_a_rate_limit_in_the_body_slows_the_limiter(gate: FakeGate) -> None:
    body = envelope([], status_code=40202, message="Rate limit exceeded.")

    failure = await _failure(
        httpx.MockTransport(lambda _request: as_json(body)), sending=False, gate=gate
    )

    assert failure.error.kind is K.RATE_LIMITED
    assert failure.error.provider_status == 40202
    assert gate.slowed == 1


@pytest.mark.parametrize(
    ("status", "body", "kind"),
    [
        (401, {"status_code": 40100, "status_message": "Not authorized."}, K.AUTH),
        (402, {"status_code": 40200, "status_message": "Payment required."}, K.PAYMENT),
        (200, envelope([], status_code=40100, message="Not authorized."), K.AUTH),
        (200, envelope([], status_code=40203, message="Cost limit reached."), K.ACCOUNT_LIMIT),
        (503, {"status_code": 50301, "status_message": "Unavailable."}, K.UPSTREAM_UNAVAILABLE),
    ],
)
async def test_a_refused_call_says_why(
    status: int, body: dict[str, object], kind: K, gate: FakeGate
) -> None:
    failure = await _failure(
        httpx.MockTransport(lambda _request: as_json(body, status)), sending=True, gate=gate
    )

    assert failure.error.kind is kind
    assert failure.error.message == body["status_message"]
    assert gate.slowed == 0


@pytest.mark.parametrize("status", [500, 504])
async def test_a_server_error_while_sending_is_an_unknown_outcome(status: int) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(status, text="<html>"))

    assert (await _failure(transport, sending=True)).error.kind is K.TIMEOUT
    assert (await _failure(transport, sending=False)).error.kind is K.PROVIDER_ERROR


async def test_a_redirect_is_not_followed_whatever_the_shared_client_does() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(302, headers={"Location": "https://elsewhere.test/"})

    failure = await _failure(httpx.MockTransport(handler), sending=False, follow_redirects=True)

    assert failure.error.kind is K.PROVIDER_ERROR
    assert failure.error.provider_status == 302
    assert [request.url.host for request in requests] == ["api.dataforseo.test"]


async def test_a_refused_call_that_names_tasks_it_created_is_read_task_by_task(
    client: DataForSeoClient, api: Api
) -> None:
    """The tasks it created are paid for: refusing the whole call would lose them."""
    created = task_answer(status_code=20100, task_id="p-1", data={"tag": "x"})
    api.answer("POST", PATH, envelope([created], status_code=40501, message="Invalid Field."))

    answer = await client.call("POST", PATH, sending=True, body=[{}])

    assert [task.id for task in answer.tasks if task is not None] == ["p-1"]


async def test_a_refused_call_that_created_nothing_is_refused(
    client: DataForSeoClient, api: Api
) -> None:
    refused = task_answer(status_code=40501, task_id="p-1")
    api.answer("POST", PATH, envelope([refused], status_code=40501, message="Invalid Field."))

    with pytest.raises(ProviderCallError) as caught:
        await client.call("POST", PATH, sending=True, body=[{}])

    assert caught.value.error.kind is K.INVALID_REQUEST


async def test_a_refused_read_is_refused_whatever_its_tasks_say(
    client: DataForSeoClient, api: Api
) -> None:
    created = task_answer(status_code=20000, task_id="p-1")
    api.answer("GET", PATH, envelope([created], status_code=40100, message="Not authorized."))

    with pytest.raises(ProviderCallError) as caught:
        await client.call("GET", PATH)

    assert caught.value.error.kind is K.AUTH


@pytest.mark.parametrize(
    "content", [b"<html>busy</html>", b"[1, 2]", b'{"tasks": []}', b"[" * 100_000 + b"]" * 100_000]
)
@pytest.mark.parametrize(("sending", "kind"), [(True, K.TIMEOUT), (False, K.PROVIDER_ERROR)])
async def test_an_answer_that_cannot_be_read_is_unknown_only_when_tasks_were_sent(
    content: bytes, *, sending: bool, kind: K
) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=content))

    failure = await _failure(transport, sending=sending)

    assert failure.error.kind is kind


@pytest.mark.parametrize(("sending", "kind"), [(True, K.TIMEOUT), (False, K.PROVIDER_ERROR)])
async def test_an_answer_too_large_to_keep_is_refused(
    monkeypatch: pytest.MonkeyPatch, *, sending: bool, kind: K
) -> None:
    monkeypatch.setattr(client_module, "BODY_MAX", 1_000)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=b" " * 1_001))

    failure = await _failure(transport, sending=sending)

    assert failure.error.kind is kind
    assert "larger" in failure.error.message


async def test_the_providers_words_are_kept_short(gate: FakeGate) -> None:
    body = {"status_code": 40100, "status_message": "x" * 5_000}

    failure = await _failure(
        httpx.MockTransport(lambda _request: as_json(body, 401)), sending=False, gate=gate
    )

    assert failure.error.message == "x" * MESSAGE_MAX


async def test_a_task_that_cannot_be_read_is_told_apart(client: DataForSeoClient, api: Api) -> None:
    good = task_answer(cost="0.0006")
    api.answer("GET", PATH, envelope([good, {"id": 7}, "not a task"]))

    answer = await client.call("GET", PATH)

    assert [task is not None for task in answer.tasks] == [True, False, False]


async def test_credentials_reach_no_log_line_and_no_error(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    transport = httpx.MockTransport(
        lambda request: as_json({"status_code": 40100, "status_message": "Not authorized."}, 401)
    )

    failure = await _failure(transport, sending=True)
    connect = await _failure(_raising(httpx.ConnectError("refused")), sending=True)

    token = base64.b64encode(f"{LOGIN}:{PASSWORD}".encode()).decode()
    seen = caplog.text + str(failure) + repr(failure.error) + str(connect) + repr(connect.error)
    for secret in (PASSWORD, token):
        assert secret not in seen


async def test_the_client_does_not_show_its_password() -> None:
    async with httpx.AsyncClient() as http:
        client = DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD)

    token = base64.b64encode(f"{LOGIN}:{PASSWORD}".encode()).decode()
    for shown in (repr(client), str(vars(client))):
        assert PASSWORD not in shown
        assert token not in shown


async def test_a_client_needs_credentials() -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises(ValueError, match="login"):
            DataForSeoClient(http, FakeGate([]), login=" ", password=PASSWORD)
        with pytest.raises(ValueError, match="password"):
            DataForSeoClient(http, FakeGate([]), login=LOGIN, password="")


@pytest.mark.parametrize(
    "origin",
    [
        "http://api.dataforseo.com",
        "api.dataforseo.com",
        "https://",
        "https://user@api.dataforseo.com",
        "https://api.dataforseo.com/v3",
        "https://api.dataforseo.com?x=1",
    ],
)
async def test_the_credentials_go_only_to_an_https_host(origin: str) -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises(ValueError, match="https"):
            DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD, origin=origin)


async def test_an_origin_is_kept_as_its_host() -> None:
    async with httpx.AsyncClient() as http:
        client = DataForSeoClient(
            http, FakeGate([]), login=LOGIN, password=PASSWORD, origin="https://api.test:8443/"
        )

    assert repr(client) == "DataForSeoClient(origin='https://api.test:8443')"
