"""The DataForSEO adapter: sending tasks, finding them ready, fetching them and finding the
ones whose submission had no answer (docs/06-dataforseo-seo-integration.md section 4)."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from sightline.domain.retries import ProviderErrorKind as K
from sightline.providers.contract import (
    CanonicalRequest,
    Contract,
    Echo,
    ProviderCallError,
    SubmitResult,
)
from sightline.providers.dataforseo import provider as provider_module
from sightline.providers.dataforseo.client import DataForSeoClient
from sightline.providers.dataforseo.provider import AccountState, DataForSeo
from sightline.providers.dataforseo.serp import SERP_ORGANIC, SerpOrganicParams
from sightline.providers.dataforseo.tags import make_tag
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

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")
INSTALLATION = "test"
TASK_POST = "/v3/serp/google/organic/task_post"
TASKS_READY = "/v3/serp/google/organic/tasks_ready"
PROVIDER_ID = "10011234-1535-0066-0000-5b2e1e3c3b86"
TASK_GET = f"/v3/serp/google/organic/task_get/advanced/{PROVIDER_ID}"
ID_LIST = "/v3/tasks/id_list"
USER_DATA = "/v3/appendix/user_data"


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
async def dataforseo(api: Api, gate: FakeGate) -> AsyncIterator[DataForSeo]:
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(http, gate, login=LOGIN, password=PASSWORD, origin=ORIGIN)
        yield DataForSeo(client, installation=INSTALLATION)


def _params(keyword: str = "best crm for startups") -> SerpOrganicParams:
    return SerpOrganicParams(
        keyword=keyword, location_code=2840, language_code="en", device="desktop", depth=20
    )


def _request(task_id: int, *, attempt: int = 1, params: Contract | None = None) -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {
            "task_id": str(task_id),
            "run_id": RUN,
            "attempt": attempt,
            "priority": "standard",
            "params": params or _params(f"keyword {task_id}"),
        }
    )


def _tag(task_id: int, attempt: int = 1) -> str:
    return make_tag(INSTALLATION, task_id, attempt, RUN)


def _echoing(answer: Any) -> Any:
    """A `task_post` that answers each posted task as `answer(index, task)` says."""

    def handler(request: httpx.Request) -> httpx.Response:
        posted = json.loads(request.content)
        return as_json(envelope([answer(index, task) for index, task in enumerate(posted)]))

    return handler


def _created(index: int, task: dict[str, Any]) -> dict[str, Any]:
    return task_answer(
        status_code=20100, message="Task Created.", task_id=f"p-{index}", cost=0.0012, data=task
    )


# Submitting


async def test_tasks_are_sent_in_one_call_with_their_tags(dataforseo: DataForSeo, api: Api) -> None:
    api.on("POST", TASK_POST, _echoing(_created))

    result = await dataforseo.submit(SERP_ORGANIC, [_request(35), _request(36), _request(37)])

    posted = api.posted()
    assert [task["tag"] for task in posted] == [_tag(35), _tag(36), _tag(37)]
    assert [task["keyword"] for task in posted] == ["keyword 35", "keyword 36", "keyword 37"]
    assert [(task.task_id, task.provider_task_id, task.cost_usd) for task in result.accepted] == [
        ("35", "p-0", Decimal("0.0012")),
        ("36", "p-1", Decimal("0.0012")),
        ("37", "p-2", Decimal("0.0012")),
    ]
    assert result.rejected == ()


async def test_the_recorded_answer_is_read(dataforseo: DataForSeo, api: Api) -> None:
    api.answer("POST", TASK_POST, fixture("task_post"))

    result = await dataforseo.submit(SERP_ORGANIC, [_request(35)])

    assert [(task.task_id, task.provider_task_id, task.cost_usd) for task in result.accepted] == [
        ("35", PROVIDER_ID, Decimal("0.0012"))
    ]


async def test_a_refused_task_says_why_and_the_others_are_accepted(
    dataforseo: DataForSeo, api: Api
) -> None:
    def answer(index: int, task: dict[str, Any]) -> dict[str, Any]:
        if index == 1:
            return task_answer(
                status_code=40501, message="Invalid Field: 'keyword'.", task_id="p-1", data=task
            )
        return _created(index, task)

    api.on("POST", TASK_POST, _echoing(answer))

    result = await dataforseo.submit(SERP_ORGANIC, [_request(35), _request(36), _request(37)])

    assert [task.task_id for task in result.accepted] == ["35", "37"]
    [refused] = result.rejected
    assert refused.task_id == "36"
    assert refused.error.kind is K.INVALID_REQUEST
    assert refused.error.provider_status == 40501
    assert refused.error.message == "Invalid Field: 'keyword'."


async def test_a_task_the_answer_does_not_name_for_certain_is_left_unknown(
    dataforseo: DataForSeo, api: Api
) -> None:
    def answer(index: int, task: dict[str, Any]) -> Any:
        return [
            # Echoes a tag that is not the one sent.
            _created(0, {**task, "tag": _tag(35, attempt=2)}),
            # Echoes nothing.
            task_answer(status_code=20100, task_id="p-1", data=None),
            # Created, with no id to find it by.
            task_answer(status_code=20100, task_id=None, data=task),
            # A gateway timeout for this task: it may have been created.
            task_answer(status_code=50401, message="Timeout.", data=task),
            # Not an answer a submission gives.
            task_answer(status_code=40602, message="Task Handed.", data=task),
            # Not a task at all.
            "garbage",
        ][index]

    api.on("POST", TASK_POST, _echoing(answer))

    result = await dataforseo.submit(SERP_ORGANIC, [_request(n) for n in range(35, 41)])

    assert result.accepted == ()
    assert result.rejected == ()


@pytest.mark.parametrize(
    ("cost", "recorded"),
    [
        (0.0012, Decimal("0.0012")),
        (0, Decimal(0)),
        # Rounded up, so a budget never counts less than was spent.
        (0.00000051, Decimal("0.000001")),
        (-0.0012, None),
        ("abc", None),
        (1e20, None),
        (None, None),
    ],
)
async def test_a_cost_is_recorded_only_when_it_is_one(
    dataforseo: DataForSeo, api: Api, cost: object, recorded: Decimal | None
) -> None:
    def answer(index: int, task: dict[str, Any]) -> dict[str, Any]:
        return task_answer(status_code=20100, task_id="p-0", cost=cost, data=task)

    api.on("POST", TASK_POST, _echoing(answer))

    result = await dataforseo.submit(SERP_ORGANIC, [_request(35)])

    [accepted] = result.accepted
    assert accepted.cost_usd == recorded


async def test_a_request_that_cannot_be_built_is_refused_alone(
    dataforseo: DataForSeo, api: Api
) -> None:
    class Other(Contract):
        prompt: str

    api.on("POST", TASK_POST, _echoing(_created))
    requests = [
        _request(35),
        _request(36, params=Other(prompt="hello")),
        # Twice the same attempt at one task: one tag for two requests.
        _request(35),
        CanonicalRequest(
            task_id="not-a-number", run_id=RUN, attempt=1, priority="standard", params=_params()
        ),
        # Never bound to an attempt: its answer could not be told from another attempt's.
        CanonicalRequest(task_id="38", run_id=RUN, priority="standard", params=_params()),
    ]

    result = await dataforseo.submit(SERP_ORGANIC, requests)

    assert [task["tag"] for task in api.posted()] == [_tag(35)]
    assert [task.task_id for task in result.accepted] == ["35"]
    assert [(task.task_id, task.error.message) for task in result.rejected] == [
        ("36", "not sent: not a SERP request: Other"),
        ("35", "not sent: the same attempt at the task is already in this call"),
        ("not-a-number", "not sent: the task id is not a number"),
        ("38", "not sent: the request is not bound to an attempt"),
    ]
    assert {task.error.kind for task in result.rejected} == {K.INVALID_REQUEST}


async def test_a_call_with_nothing_left_to_send_is_not_made(
    dataforseo: DataForSeo, api: Api
) -> None:
    unbound = CanonicalRequest(task_id="38", run_id=RUN, priority="standard", params=_params())

    result = await dataforseo.submit(SERP_ORGANIC, [unbound])

    assert [task.task_id for task in result.rejected] == ["38"]
    assert api.requests == []


async def test_more_than_one_call_holds_is_refused_whole(dataforseo: DataForSeo, api: Api) -> None:
    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.submit(SERP_ORGANIC, [_request(n) for n in range(101)])

    assert caught.value.error.kind is K.INVALID_REQUEST
    assert api.requests == []


async def test_nothing_to_send_makes_no_call(dataforseo: DataForSeo, api: Api) -> None:
    result = await dataforseo.submit(SERP_ORGANIC, [])

    assert result == SubmitResult()
    assert api.requests == []


async def test_a_call_refused_whole_is_raised(dataforseo: DataForSeo, api: Api) -> None:
    api.answer("POST", TASK_POST, envelope([], status_code=40006, message="Too many tasks."))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.submit(SERP_ORGANIC, [_request(35)])

    assert caught.value.error.kind is K.INVALID_REQUEST


# Finding ready tasks


async def test_ready_tasks_are_listed_with_what_they_echo(
    dataforseo: DataForSeo, api: Api, events: list[str]
) -> None:
    api.answer("GET", TASKS_READY, fixture("tasks_ready"))

    ready = await dataforseo.list_ready(SERP_ORGANIC)

    assert events == ["turn tasks_ready", f"call GET {TASKS_READY}"]
    assert [task.provider_task_id for task in ready] == [
        PROVIDER_ID,
        "10011240-1535-0066-0000-7c4d2a1b9e07",
    ]
    assert ready[0].echo.names(35, RUN, 1)
    assert ready[1].echo == Echo()


async def test_a_ready_entry_that_cannot_be_read_is_left_for_the_sweeper(
    dataforseo: DataForSeo, api: Api
) -> None:
    entries = ["garbage", {"tag": _tag(35)}, {"id": "../user_data"}, {"id": PROVIDER_ID}]
    api.answer("GET", TASKS_READY, envelope([task_answer(result=entries)]))

    ready = await dataforseo.list_ready(SERP_ORGANIC)

    assert [task.provider_task_id for task in ready] == [PROVIDER_ID]


async def test_a_readiness_list_refused_is_raised(
    dataforseo: DataForSeo, api: Api, gate: FakeGate
) -> None:
    api.answer("GET", TASKS_READY, envelope([task_answer(status_code=40202, message="Slow.")]))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.list_ready(SERP_ORGANIC)

    assert caught.value.error.kind is K.RATE_LIMITED
    assert gate.slowed == 1


async def test_a_readiness_list_without_its_task_is_the_providers_fault(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("GET", TASKS_READY, envelope([]))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.list_ready(SERP_ORGANIC)

    assert caught.value.error.kind is K.PROVIDER_ERROR


# Fetching


async def test_a_result_is_fetched_as_the_exact_bytes(
    dataforseo: DataForSeo, api: Api, events: list[str]
) -> None:
    raw = fixture_bytes("task_get_advanced")
    api.on(
        "GET",
        TASK_GET,
        lambda _request: httpx.Response(
            200, content=raw, headers={"content-type": "application/json"}
        ),
    )

    result = await dataforseo.fetch(SERP_ORGANIC, PROVIDER_ID)

    assert events == ["turn None", f"call GET {TASK_GET}"]
    assert result.status == "ready"
    assert result.body == raw
    assert result.provider_task_id == PROVIDER_ID
    assert result.content_type == "application/json"
    assert result.cost_usd == Decimal(0)
    assert result.error is None


@pytest.mark.parametrize(
    ("status_code", "status", "kind"),
    [
        (40601, "pending", None),
        (40602, "pending", None),
        (40102, "ready", None),
        (40403, "expired", K.NOT_FOUND_EXPIRED),
        (50301, "failed", K.UPSTREAM_UNAVAILABLE),
        (40501, "failed", K.INVALID_REQUEST),
    ],
)
async def test_a_task_level_answer_says_where_the_result_is(
    dataforseo: DataForSeo, api: Api, status_code: int, status: str, kind: K | None
) -> None:
    body = envelope([task_answer(status_code=status_code, message="Said so.")])
    api.answer("GET", TASK_GET, body)

    result = await dataforseo.fetch(SERP_ORGANIC, PROVIDER_ID)

    assert result.status == status
    assert (result.error.kind if result.error else None) is kind
    assert (result.body is not None) is (status == "ready")


async def test_a_rate_limit_on_a_fetch_slows_the_limiter(
    dataforseo: DataForSeo, api: Api, gate: FakeGate
) -> None:
    api.answer("GET", TASK_GET, envelope([task_answer(status_code=40202, message="Slow.")]))

    result = await dataforseo.fetch(SERP_ORGANIC, PROVIDER_ID)

    assert result.status == "failed"
    assert result.error is not None
    assert result.error.kind is K.RATE_LIMITED
    assert gate.slowed == 1


@pytest.mark.parametrize(
    "tasks", [[], [task_answer(task_id="another")], ["garbage"], [task_answer(), task_answer()]]
)
async def test_an_answer_about_another_task_is_the_providers_fault(
    dataforseo: DataForSeo, api: Api, tasks: list[Any]
) -> None:
    api.answer("GET", TASK_GET, envelope(tasks))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.fetch(SERP_ORGANIC, PROVIDER_ID)

    assert caught.value.error.kind is K.PROVIDER_ERROR


@pytest.mark.parametrize("provider_task_id", ["", "../user_data", "a/b", "x" * 65, "id?q=1"])
async def test_an_id_that_is_not_a_task_id_is_not_fetched(
    dataforseo: DataForSeo, api: Api, provider_task_id: str
) -> None:
    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.fetch(SERP_ORGANIC, provider_task_id)

    assert caught.value.error.kind is K.INVALID_REQUEST
    assert api.requests == []


# Finding submitted tasks

SINCE = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
UNTIL = datetime(2026, 10, 1, 9, 30, tzinfo=UTC)


async def test_submitted_tasks_are_found_with_their_tags_and_costs(
    dataforseo: DataForSeo, api: Api, events: list[str]
) -> None:
    api.answer("POST", ID_LIST, fixture("id_list"))

    found = await dataforseo.find_submitted(SERP_ORGANIC, SINCE, UNTIL)

    assert events == ["turn id_list", f"call POST {ID_LIST}"]
    assert api.posted() == [
        {
            "datetime_from": "2026-10-01 09:00:00 +00:00",
            "datetime_to": "2026-10-01 09:30:00 +00:00",
            "limit": 1000,
            "offset": 0,
            "sort": "asc",
            "include_metadata": True,
        }
    ]
    ours, theirs = found
    assert ours.provider_task_id == PROVIDER_ID
    assert ours.echo.names(35, RUN, 1)
    assert ours.posted_at == datetime(2026, 10, 1, 9, 10, 2, tzinfo=UTC)
    assert ours.cost_usd == Decimal("0.0012")
    assert theirs.echo == Echo()


async def test_the_times_asked_for_are_in_utc(dataforseo: DataForSeo, api: Api) -> None:
    api.answer("POST", ID_LIST, envelope([task_answer(result=[])]))
    india = datetime(2026, 10, 1, 14, 30, tzinfo=UTC).astimezone(ZoneInfo("Asia/Kolkata"))

    await dataforseo.find_submitted(SERP_ORGANIC, india, india + timedelta(minutes=5))

    assert api.posted()[0]["datetime_from"] == "2026-10-01 14:30:00 +00:00"


async def test_a_long_list_is_read_page_by_page(
    dataforseo: DataForSeo, api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(provider_module, "ID_LIST_PAGE", 2)
    items = fixture("id_list")["tasks"][0]["result"]
    pages = [items, items[:1]]

    def handler(request: httpx.Request) -> httpx.Response:
        offset = json.loads(request.content)[0]["offset"]
        return as_json(envelope([task_answer(result=pages[offset // 2])]))

    api.on("POST", ID_LIST, handler)

    found = await dataforseo.find_submitted(SERP_ORGANIC, SINCE, UNTIL)

    assert [json.loads(request.content)[0]["offset"] for request in api.requests] == [0, 2]
    assert len(found) == 3


async def test_a_list_longer_than_one_look_reads_is_not_taken_for_all(
    dataforseo: DataForSeo, api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A task left out would be sent again, and paid twice."""
    monkeypatch.setattr(provider_module, "ID_LIST_PAGE", 2)
    monkeypatch.setattr(provider_module, "ID_LIST_PAGES", 2)
    items = fixture("id_list")["tasks"][0]["result"]
    api.answer("POST", ID_LIST, envelope([task_answer(result=items)]))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.find_submitted(SERP_ORGANIC, SINCE, UNTIL)

    assert caught.value.error.kind is K.PROVIDER_ERROR
    assert len(api.requests) == 2


async def test_what_a_listed_task_does_not_say_clearly_is_left_unknown(
    dataforseo: DataForSeo, api: Api
) -> None:
    items = [
        {"id": "a", "datetime_posted": "yesterday", "cost": True},
        {"id": "b", "datetime_posted": 1_727_773_802, "cost": "0.0006"},
    ]
    api.answer("POST", ID_LIST, envelope([task_answer(result=items)]))

    found = await dataforseo.find_submitted(SERP_ORGANIC, SINCE, UNTIL)

    assert [(task.posted_at, task.cost_usd, task.echo) for task in found] == [
        (None, None, Echo()),
        (None, None, Echo()),
    ]


async def test_an_unreadable_listed_task_is_not_taken_for_absent(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", ID_LIST, envelope([task_answer(result=[{"url": "no id"}])]))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.find_submitted(SERP_ORGANIC, SINCE, UNTIL)

    assert caught.value.error.kind is K.PROVIDER_ERROR


async def test_a_period_is_two_aware_times_in_order(dataforseo: DataForSeo) -> None:
    with pytest.raises(ValueError, match="time zone"):
        await dataforseo.find_submitted(SERP_ORGANIC, datetime(2026, 10, 1), UNTIL)
    with pytest.raises(ValueError, match="before"):
        await dataforseo.find_submitted(SERP_ORGANIC, UNTIL, SINCE)


# The account


async def test_the_account_state_is_read(
    dataforseo: DataForSeo, api: Api, events: list[str]
) -> None:
    api.answer("GET", USER_DATA, fixture("user_data"))

    state = await dataforseo.account_state()

    assert events == ["turn user_data", f"call GET {USER_DATA}"]
    assert state == AccountState(
        balance_usd=Decimal("87.4521"), calls_per_minute=2000, spent_today_usd=Decimal("1.2345")
    )


async def test_what_the_account_does_not_say_is_left_unknown(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("GET", USER_DATA, envelope([task_answer(result=[{"money": {"balance": 3}}])]))

    state = await dataforseo.account_state()

    assert state == AccountState(
        balance_usd=Decimal(3), calls_per_minute=None, spent_today_usd=None
    )


async def test_an_account_state_without_a_balance_is_the_providers_fault(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("GET", USER_DATA, envelope([task_answer(result=[{"money": {}}])]))

    with pytest.raises(ProviderCallError) as caught:
        await dataforseo.account_state()

    assert caught.value.error.kind is K.PROVIDER_ERROR


# The endpoints


@pytest.mark.parametrize("installation", ["", "Prod", "a:b", "x" * 17])
async def test_an_installation_its_tags_could_not_carry_is_refused(installation: str) -> None:
    async with httpx.AsyncClient() as http:
        client = DataForSeoClient(http, FakeGate([]), login=LOGIN, password=PASSWORD)
        with pytest.raises(ValueError, match="installation"):
            DataForSeo(client, installation=installation)


def test_the_adapter_describes_its_endpoints(dataforseo: DataForSeo) -> None:
    assert dataforseo.code == "dataforseo"
    assert dataforseo.batch_size(SERP_ORGANIC) == 100
    assert dataforseo.result_lifetime(SERP_ORGANIC) == timedelta(hours=72)
    assert dataforseo.lists_submissions is True


async def test_an_endpoint_it_does_not_know_is_refused(dataforseo: DataForSeo, api: Api) -> None:
    with pytest.raises(ValueError, match="unknown"):
        dataforseo.batch_size("serp/bing/organic")
    with pytest.raises(ValueError, match="unknown"):
        dataforseo.result_lifetime("serp/bing/organic")
    # Refused as a call, so the tasks are known not to have been sent.
    calls = [
        dataforseo.submit("serp/bing/organic", [_request(35)]),
        dataforseo.list_ready("serp/bing/organic"),
        dataforseo.fetch("serp/bing/organic", PROVIDER_ID),
        dataforseo.find_submitted("serp/bing/organic", SINCE, UNTIL),
    ]
    for call in calls:
        with pytest.raises(ProviderCallError) as caught:
            await call
        assert caught.value.error.kind is K.INVALID_REQUEST
    assert api.requests == []
