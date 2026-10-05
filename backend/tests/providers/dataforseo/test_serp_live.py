"""A SERP asked and answered in one call: check now (docs/06-dataforseo-seo-integration.md
section 3.3; rank collection plan Task 9)."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest

from sightline.domain.retries import ProviderErrorKind as K
from sightline.providers.contract import CanonicalRequest, Contract, ProviderCallError
from sightline.providers.dataforseo.client import FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.providers.dataforseo.serp import (
    LIVE_FAMILY,
    LIVE_PATH,
    SERP_ORGANIC,
    SERP_ORGANIC_LIVE,
    SerpOrganicParams,
    live_body,
)
from tests.providers.dataforseo.support import (
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    as_json,
    envelope,
    fixture,
    task_answer,
)

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")


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
        yield DataForSeo(client, installation="test")


def _request(task_id: int = 1, keyword: str = "best crm for startups") -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {
            "task_id": str(task_id),
            "run_id": RUN,
            "attempt": 1,
            "priority": "high",
            "params": SerpOrganicParams(
                keyword=keyword,
                location_code=2840,
                language_code="en",
                device="desktop",
                depth=20,
                queue="live",
            ),
        }
    )


def _answered(cost: object = 0.004) -> dict[str, Any]:
    body = fixture("task_get_advanced")
    body["tasks"][0]["cost"] = cost
    return body


# The request.


def test_a_live_body_is_a_task_body_without_what_only_task_post_takes() -> None:
    body = live_body(_request())

    assert body == {
        "keyword": "best crm for startups",
        "location_code": 2840,
        "language_code": "en",
        "device": "desktop",
        "depth": 20,
        "load_async_ai_overview": True,
        "group_organic_results": True,
        "calculate_rectangles": False,
    }


async def test_one_call_is_made_to_the_live_path_under_its_own_limit(
    dataforseo: DataForSeo, api: Api, events: list[str]
) -> None:
    api.answer("POST", LIVE_PATH, _answered())

    (result,) = await dataforseo.live(SERP_ORGANIC_LIVE, [_request()])

    assert api.posted() == [live_body(_request())]
    assert events == [f"turn {LIVE_FAMILY}", f"call POST {LIVE_PATH}"]
    assert LIVE_FAMILY in FAMILY_LIMITS
    assert (result.task_id, result.status) == ("1", "ready")


async def test_the_answer_is_kept_whole_with_the_cost_the_provider_reported(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE_PATH, _answered(cost=0.004))

    (result,) = await dataforseo.live(SERP_ORGANIC_LIVE, [_request()])

    assert result.cost_usd == Decimal("0.004")
    assert result.call_id == fixture("task_get_advanced")["tasks"][0]["id"]
    assert result.body is not None
    assert json.loads(result.body)["tasks"][0]["data"]["keyword"] == "best crm for startups"


async def test_a_cost_that_is_not_believed_is_not_recorded(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE_PATH, _answered(cost=250))

    (result,) = await dataforseo.live(SERP_ORGANIC_LIVE, [_request()])

    assert (result.status, result.cost_usd) == ("ready", None)


# Failures.


@pytest.mark.parametrize(
    ("answer", "kind"),
    [
        (httpx.Response(500, text="oops"), K.TIMEOUT),
        (httpx.Response(503, text="busy"), K.UPSTREAM_UNAVAILABLE),
        (as_json(envelope([task_answer(status_code=40209, message="Too many.")])), K.CONCURRENCY),
        (as_json(envelope([task_answer(status_code=40202, message="Slow down.")])), K.RATE_LIMITED),
    ],
)
async def test_a_failed_call_says_how_it_failed(
    dataforseo: DataForSeo, api: Api, gate: FakeGate, answer: httpx.Response, kind: K
) -> None:
    api.on("POST", LIVE_PATH, lambda _request: answer)

    (result,) = await dataforseo.live(SERP_ORGANIC_LIVE, [_request()])

    assert (result.status, result.error.kind if result.error else None) == ("failed", kind)
    assert gate.slowed == (1 if kind is K.RATE_LIMITED else 0)


async def test_an_answer_without_one_task_is_asked_for_again(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE_PATH, envelope([task_answer(), task_answer()]))

    (result,) = await dataforseo.live(SERP_ORGANIC_LIVE, [_request()])

    assert (result.status, result.error.kind if result.error else None) == ("failed", K.TIMEOUT)


async def test_a_request_that_cannot_be_sent_is_refused_without_a_call(
    dataforseo: DataForSeo, api: Api
) -> None:
    wrong = CanonicalRequest.model_validate(
        {"task_id": "2", "run_id": RUN, "attempt": 1, "priority": "high", "params": Contract()}
    )

    (result,) = await dataforseo.live(SERP_ORGANIC_LIVE, [wrong])

    assert (result.status, result.error.kind if result.error else None) == (
        "failed",
        K.INVALID_REQUEST,
    )
    assert api.requests == []


async def test_a_call_holds_one_search(dataforseo: DataForSeo, api: Api) -> None:
    with pytest.raises(ProviderCallError):
        await dataforseo.live(SERP_ORGANIC_LIVE, [_request(1), _request(2, "erp software")])
    assert api.requests == []


# The endpoint.


def test_the_live_serp_is_a_live_endpoint_of_one_search_kept_like_a_task_answer(
    dataforseo: DataForSeo,
) -> None:
    assert dataforseo.is_live(SERP_ORGANIC_LIVE)
    assert not dataforseo.is_live(SERP_ORGANIC)
    assert dataforseo.batch_size(SERP_ORGANIC_LIVE) == 1
    assert dataforseo.payload_slug(SERP_ORGANIC_LIVE) == dataforseo.payload_slug(SERP_ORGANIC)
    assert dataforseo.result_lifetime(SERP_ORGANIC_LIVE) == timedelta(hours=1)


async def test_task_calls_refuse_the_live_serp(dataforseo: DataForSeo, api: Api) -> None:
    with pytest.raises(ProviderCallError):
        await dataforseo.submit(SERP_ORGANIC_LIVE, [_request()])
    assert api.requests == []
