"""DataForSEO Labs `keyword_overview`, called live (docs/06-dataforseo-seo-integration.md
section 7; plan decision D6)."""

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
from sightline.providers.dataforseo import labs
from sightline.providers.dataforseo.client import FAMILY_LIMITS, DataForSeoClient
from sightline.providers.dataforseo.labs import (
    KEYWORD_OVERVIEW,
    KeywordOverviewParams,
    match_key,
    read_overview,
    split_cost,
)
from sightline.providers.dataforseo.provider import DataForSeo
from sightline.providers.dataforseo.serp import SERP_ORGANIC
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
LIVE = "/v3/dataforseo_labs/google/keyword_overview/live"


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


def _request(
    task_id: int, keyword: str, *, location: int = 2840, language: str = "en"
) -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {
            "task_id": str(task_id),
            "run_id": RUN,
            "attempt": 1,
            "priority": "standard",
            "params": KeywordOverviewParams(
                keyword=keyword, location_code=location, language_code=language
            ),
        }
    )


def _answered(cost: object = 0.01224) -> dict[str, Any]:
    body = fixture("keyword_overview_live")
    body["tasks"][0]["cost"] = cost
    return body


# The request.


async def test_one_call_per_location_and_language(
    dataforseo: DataForSeo, api: Api, events: list[str]
) -> None:
    api.answer("POST", LIVE, _answered())
    requests = [
        _request(1, "best crm"),
        _request(2, "CRM Software"),
        _request(3, "crm", location=2826),
    ]

    results = await dataforseo.live(KEYWORD_OVERVIEW, requests)

    assert [api.posted(n) for n in range(2)] == [
        [
            {
                "keywords": ["best crm", "CRM Software"],
                "location_code": 2840,
                "language_code": "en",
                "include_serp_info": False,
                "include_clickstream_data": False,
            }
        ],
        [
            {
                "keywords": ["crm"],
                "location_code": 2826,
                "language_code": "en",
                "include_serp_info": False,
                "include_clickstream_data": False,
            }
        ],
    ]
    # Each call takes a turn under the Labs family's own limit.
    assert events == [f"turn {labs.FAMILY}", f"call POST {LIVE}"] * 2
    assert sorted(result.task_id for result in results) == ["1", "2", "3"]


async def test_each_task_gets_the_answer_and_its_share_of_the_cost(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE, _answered())
    requests = [_request(n, f"keyword {n}") for n in range(1, 8)]

    results = await dataforseo.live(KEYWORD_OVERVIEW, requests)

    assert {result.status for result in results} == {"ready"}
    # The one answer, as received, for every task of the call.
    (body,) = {result.body for result in results}
    assert body is not None
    assert json.loads(body) == _answered()
    # $0.01224 over seven tasks: $0.001748 each, and the four millionths left on the first.
    by_task = {result.task_id: result.cost_usd for result in results}
    assert by_task["1"] == Decimal("0.001752")
    assert {by_task[str(n)] for n in range(2, 8)} == {Decimal("0.001748")}
    assert sum((cost or Decimal(0) for cost in by_task.values()), Decimal(0)) == Decimal("0.01224")


@pytest.mark.parametrize(
    ("total", "parts", "expected"),
    [
        (Decimal("0.012"), 1, [Decimal("0.012")]),
        (Decimal("0.01224"), 3, [Decimal("0.00408")] * 3),
        (Decimal("0.000001"), 3, [Decimal("0.000001"), Decimal(0), Decimal(0)]),
        (None, 2, [None, None]),
        (Decimal("0.012"), 0, []),
    ],
)
def test_a_cost_is_split_to_the_millionth_with_the_rest_on_the_first(
    total: Decimal | None, parts: int, expected: list[Decimal | None]
) -> None:
    assert split_cost(total, parts) == expected


# The answer.


def test_the_answer_is_read_into_one_result_per_keyword() -> None:
    found = read_overview(fixture_bytes("keyword_overview_live"))

    best = found[match_key("Best  CRM")]
    assert (best.search_volume, best.cpc_usd, best.competition, best.competition_level) == (
        1900,
        Decimal("14.23"),
        Decimal("0.67"),
        "HIGH",
    )
    assert (best.keyword_difficulty, best.main_intent, best.foreign_intents) == (
        58,
        "commercial",
        ("informational",),
    )
    # Oldest first, whatever order Labs sends.
    assert [(m.year, m.month) for m in best.monthly_searches][:2] == [(2025, 9), (2025, 10)]
    assert best.monthly_searches[-1].search_volume == 2400
    known_nothing = found[match_key("CRM Software")]
    assert (
        known_nothing.search_volume,
        known_nothing.cpc_usd,
        known_nothing.competition,
        known_nothing.keyword_difficulty,
        known_nothing.main_intent,
        known_nothing.monthly_searches,
    ) == (None, None, None, None, None, ())
    # A keyword Labs left out of the answer is not in the result.
    assert match_key("no such keyword anywhere") not in found


def test_values_that_are_not_what_labs_documents_are_read_as_unknown() -> None:
    body = fixture("keyword_overview_live")
    item = body["tasks"][0]["result"][0]["items"][0]
    item["keyword_info"].update(
        {"competition": "high", "competition_level": "EXTREME", "cpc": -1, "search_volume": True}
    )
    item["keyword_properties"]["keyword_difficulty"] = 140
    item["keyword_info"]["monthly_searches"] = [
        {"year": 2026, "month": 13, "search_volume": 5},
        {"year": 2026, "month": 3, "search_volume": 5},
        {"year": 2026, "month": 3, "search_volume": 7},
    ]
    item["search_intent_info"]["main_intent"] = "curious"

    best = read_overview(json.dumps(body).encode())[match_key("best crm")]

    assert (best.competition, best.competition_level, best.cpc_usd, best.search_volume) == (
        None,
        None,
        None,
        None,
    )
    assert (best.keyword_difficulty, best.main_intent) == (None, None)
    # A month given twice counts once, as given last.
    assert [(m.month, m.search_volume) for m in best.monthly_searches] == [(3, 7)]


def test_an_answer_that_is_not_labs_json_is_refused() -> None:
    with pytest.raises(labs.UnreadableAnswerError):
        read_overview(b"<html>")
    with pytest.raises(labs.UnreadableAnswerError):
        read_overview(json.dumps(envelope([])).encode())


# Failures.


async def test_a_refused_call_fails_its_tasks_with_the_providers_reason(
    dataforseo: DataForSeo, api: Api, gate: FakeGate
) -> None:
    api.answer(
        "POST",
        LIVE,
        envelope(
            [task_answer(status_code=40501, message="Invalid Field: 'keywords'.", result=None)]
        ),
    )

    results = await dataforseo.live(KEYWORD_OVERVIEW, [_request(1, "crm"), _request(2, "erp")])

    assert {(r.status, r.error.kind if r.error else None) for r in results} == {
        ("failed", K.INVALID_REQUEST)
    }
    assert all(r.body is None and r.cost_usd is None for r in results)


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
    api.on("POST", LIVE, lambda _request: answer)

    (result,) = await dataforseo.live(KEYWORD_OVERVIEW, [_request(1, "crm")])

    assert (result.status, result.error.kind if result.error else None) == ("failed", kind)
    assert gate.slowed == (1 if kind is K.RATE_LIMITED else 0)


async def test_one_location_failing_leaves_the_others_ready(
    dataforseo: DataForSeo, api: Api
) -> None:
    def answer(request: httpx.Request) -> httpx.Response:
        posted = json.loads(request.content)
        if posted[0]["location_code"] == 2826:
            return httpx.Response(500, text="oops")
        return as_json(_answered())

    api.on("POST", LIVE, answer)

    results = await dataforseo.live(
        KEYWORD_OVERVIEW, [_request(1, "crm"), _request(2, "crm", location=2826)]
    )

    assert {r.task_id: r.status for r in results} == {"1": "ready", "2": "failed"}


async def test_a_request_that_cannot_be_sent_is_refused_on_its_own(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE, _answered())
    wrong = CanonicalRequest.model_validate(
        {"task_id": "2", "run_id": RUN, "attempt": 1, "priority": "standard", "params": Contract()}
    )

    results = await dataforseo.live(KEYWORD_OVERVIEW, [_request(1, "crm"), wrong])

    assert {r.task_id: (r.status, r.error.kind if r.error else None) for r in results} == {
        "1": ("ready", None),
        "2": ("failed", K.INVALID_REQUEST),
    }
    assert api.posted()[0]["keywords"] == ["crm"]


async def test_a_keyword_labs_cannot_take_is_refused_on_its_own(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE, _answered())

    results = await dataforseo.live(
        KEYWORD_OVERVIEW, [_request(1, "crm"), _request(2, "x" * 81), _request(1, "crm again")]
    )

    assert {(r.task_id, r.status) for r in results} == {
        ("1", "ready"),
        ("2", "failed"),
        ("1", "failed"),
    }
    assert api.posted()[0]["keywords"] == ["crm"]
    with pytest.raises(ValueError, match="one trimmed line"):
        KeywordOverviewParams(keyword="crm\N{DELETE}", location_code=2840, language_code="en")


async def test_keywords_are_escaped_and_a_spelling_labs_reads_as_another_is_sent_once(
    dataforseo: DataForSeo, api: Api
) -> None:
    api.answer("POST", LIVE, _answered())

    results = await dataforseo.live(
        KEYWORD_OVERVIEW,
        [_request(1, "c++ 100%"), _request(2, "CRM software"), _request(3, "crm  Software")],
    )

    assert api.posted()[0]["keywords"] == ["c%2B%2B 100%25", "CRM software"]
    assert {r.status for r in results} == {"ready"}
    # The call's id names the answer the tasks share.
    assert {r.call_id for r in results} == {fixture("keyword_overview_live")["tasks"][0]["id"]}


def test_matching_ignores_case_spacing_and_unicode_form() -> None:
    decomposed = "cafe\N{COMBINING ACUTE ACCENT}  Menu"
    assert match_key(decomposed) == match_key("caf\N{LATIN SMALL LETTER E WITH ACUTE} menu")


def test_an_answer_with_no_results_says_nothing_of_any_keyword() -> None:
    body = envelope([task_answer(status_code=40102, message="No Search Results.", result=None)])

    assert read_overview(json.dumps(body).encode()) == {}


@pytest.mark.parametrize(("cost", "expected"), [(5, None), (None, None), ("free", None)])
async def test_a_cost_that_is_not_believed_is_left_out(
    dataforseo: DataForSeo, api: Api, cost: object, expected: Decimal | None
) -> None:
    api.answer("POST", LIVE, _answered(cost=cost))

    (result,) = await dataforseo.live(KEYWORD_OVERVIEW, [_request(1, "crm")])

    assert (result.status, result.cost_usd) == ("ready", expected)


async def test_more_than_a_batch_is_not_sent(dataforseo: DataForSeo, api: Api) -> None:
    requests = [_request(n, f"keyword {n}") for n in range(701)]

    with pytest.raises(ProviderCallError) as raised:
        await dataforseo.live(KEYWORD_OVERVIEW, requests)

    assert raised.value.error.kind is K.INVALID_REQUEST
    assert api.requests == []


# The endpoint.


def test_the_live_endpoint_is_known_to_the_adapter(dataforseo: DataForSeo) -> None:
    assert dataforseo.batch_size(KEYWORD_OVERVIEW) == 700
    assert dataforseo.is_live(KEYWORD_OVERVIEW)
    assert not dataforseo.is_live(SERP_ORGANIC)
    assert dataforseo.payload_slug(KEYWORD_OVERVIEW) == "dataforseo_labs_google_keyword_overview"
    assert dataforseo.result_lifetime(KEYWORD_OVERVIEW) == timedelta(hours=1)
    assert labs.FAMILY in FAMILY_LIMITS


async def test_task_calls_refuse_the_live_endpoint_and_live_calls_a_task_endpoint(
    dataforseo: DataForSeo, api: Api
) -> None:
    with pytest.raises(ProviderCallError):
        await dataforseo.submit(KEYWORD_OVERVIEW, [_request(1, "crm")])
    with pytest.raises(ProviderCallError):
        await dataforseo.live(SERP_ORGANIC, [_request(1, "crm")])
    assert api.requests == []
