"""What an AI answer task asks DataForSEO for, and the adapter sending and fetching one
(docs/07-dataforseo-ai-integration.md sections 2 to 4; spike S-04)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo import ai
from idraft.providers.dataforseo.ai import (
    AI_MODE,
    CHATGPT_SCRAPER,
    ENDPOINTS,
    ENGINE_ENDPOINTS,
    GEMINI_SCRAPER,
    PROMPT_MAX,
    AiAnswerParams,
    ai_mode_body,
    scraper_body,
)
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.provider import ENDPOINTS as REGISTERED
from idraft.providers.dataforseo.provider import DataForSeo
from idraft.providers.dataforseo.serp import SerpOrganicParams
from idraft.providers.dataforseo.tags import make_tag
from tests.providers.dataforseo.support import (
    FIXTURES,
    LOGIN,
    ORIGIN,
    PASSWORD,
    Api,
    FakeGate,
    as_json,
    envelope,
    task_answer,
)

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")
TAG = "i:test:t:z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11"
PROMPT = "What are the best managed SOC providers in India?"


def _params(**changes: Any) -> AiAnswerParams:
    fields: dict[str, Any] = {"prompt": PROMPT, "location_code": 2356, "language_code": "en"}
    fields.update(changes)
    return AiAnswerParams(**fields)


def _request(params: Contract, task_id: int = 35) -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {
            "task_id": str(task_id),
            "run_id": RUN,
            "attempt": 1,
            "priority": "standard",
            "params": params,
        }
    )


def test_a_scraper_task_asks_for_the_prompt_as_saved() -> None:
    assert scraper_body(_request(_params()), TAG) == {
        "keyword": PROMPT,
        "location_code": 2356,
        "language_code": "en",
        "priority": 1,
        "tag": TAG,
    }


def test_chatgpt_is_asked_as_it_answers() -> None:
    assert "force_web_search" not in scraper_body(_request(_params()), TAG)


def test_an_ai_mode_task_is_a_windows_desktop_search() -> None:
    body = ai_mode_body(_request(_params()), TAG)

    assert (body["device"], body["os"], body["keyword"]) == ("desktop", "windows", PROMPT)


def test_an_ai_mode_task_for_mobile_asks_a_mobile_device() -> None:
    body = ai_mode_body(_request(_params(device="mobile")), TAG)

    # Mobile maps to android as the SERP adapter's _SYSTEMS do; never sent to a live API.
    assert (body["device"], body["os"], body["keyword"]) == ("mobile", "android", PROMPT)
    assert body == {**ai_mode_body(_request(_params()), TAG), "device": "mobile", "os": "android"}


@pytest.mark.parametrize("device", ["desktop", "mobile"])
def test_a_scraper_task_never_carries_a_device(device: str) -> None:
    body = scraper_body(_request(_params(device=device)), TAG)

    assert "device" not in body
    assert "os" not in body


@pytest.mark.parametrize("device", ["tablet", "", "Desktop", None])
def test_a_device_other_than_desktop_or_mobile_is_not_a_valid_ai_request(device: object) -> None:
    with pytest.raises(ValidationError):
        _params(device=device)


def test_the_device_of_an_ai_request_is_desktop_unless_set() -> None:
    assert _params().device == "desktop"


# What is sent today, as the bytes of the task_post body. An engine without a device setting, and
# the desktop default, must keep sending exactly these (no existing behavior changes, and
# ADAPTER_VERSION stays 1).
_SENT_TODAY = {
    CHATGPT_SCRAPER: (
        b'[{"keyword":"What are the best managed SOC providers in India?",'
        b'"location_code":2356,"language_code":"en","priority":1,'
        b'"tag":"%(tag)s"}]'
    ),
    GEMINI_SCRAPER: (
        b'[{"keyword":"What are the best managed SOC providers in India?",'
        b'"location_code":2356,"language_code":"en","priority":1,'
        b'"tag":"%(tag)s"}]'
    ),
    AI_MODE: (
        b'[{"keyword":"What are the best managed SOC providers in India?",'
        b'"location_code":2356,"language_code":"en","priority":1,'
        b'"tag":"%(tag)s","device":"desktop","os":"windows"}]'
    ),
}


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize(
    ("endpoint", "base"),
    [
        (CHATGPT_SCRAPER, "/v3/ai_optimization/chat_gpt/llm_scraper"),
        (GEMINI_SCRAPER, "/v3/ai_optimization/gemini/llm_scraper"),
        (AI_MODE, "/v3/serp/google/ai_mode"),
    ],
)
async def test_the_default_request_is_byte_identical_to_what_is_sent_today(
    dataforseo: tuple[DataForSeo, Api], endpoint: str, base: str, explicit: bool
) -> None:
    provider, api = dataforseo
    api.on(
        "POST",
        f"{base}/task_post",
        lambda _request: as_json(
            envelope(
                [
                    task_answer(
                        status_code=20100,
                        message="Task Created.",
                        task_id="p-1",
                        cost=0.0012,
                        data=api.posted()[0],
                    )
                ]
            )
        ),
    )
    params = _params(device="desktop") if explicit else _params()

    await provider.submit(endpoint, [_request(params)])

    tag = make_tag("test", 35, 1, RUN).encode()
    assert api.requests[-1].content == _SENT_TODAY[endpoint] % {b"tag": tag}


def test_the_priority_queue_is_the_schedules_choice() -> None:
    assert scraper_body(_request(_params(queue="priority")), TAG)["priority"] == 2


def test_a_prompt_too_long_for_ai_mode_is_not_built() -> None:
    long = "x" * (PROMPT_MAX[AI_MODE] + 1)

    assert scraper_body(_request(_params(prompt=long)), TAG)["keyword"] == long
    with pytest.raises(ValueError, match="700"):
        ai_mode_body(_request(_params(prompt=long)), TAG)


@pytest.mark.parametrize("prompt", ["", " padded ", "nul\x00inside", "x" * 2001])
def test_a_prompt_is_trimmed_text_of_at_most_2000_characters(prompt: str) -> None:
    with pytest.raises(ValidationError):
        _params(prompt=prompt)


def test_a_request_of_another_endpoint_is_refused() -> None:
    serp = SerpOrganicParams(keyword="crm", location_code=2840, language_code="en", depth=10)

    with pytest.raises(TypeError):
        scraper_body(_request(serp), TAG)


def test_every_engine_has_a_registered_endpoint_with_its_paths() -> None:
    # The engine facts of plan A name exactly the endpoints this adapter serves.
    assert ENGINE_ENDPOINTS == {
        "chatgpt_web": CHATGPT_SCRAPER,
        "gemini_web": GEMINI_SCRAPER,
        "google_ai_mode": AI_MODE,
    }
    assert PROMPT_MAX == {CHATGPT_SCRAPER: 2000, GEMINI_SCRAPER: 2000, AI_MODE: 700}
    assert {name: REGISTERED[name] for name in ENDPOINTS} == dict(ENDPOINTS)
    assert REGISTERED[CHATGPT_SCRAPER].base == "/v3/ai_optimization/chat_gpt/llm_scraper"
    assert REGISTERED[GEMINI_SCRAPER].id_list == "/v3/ai_optimization/id_list"
    assert REGISTERED[AI_MODE].base == "/v3/serp/google/ai_mode"
    assert REGISTERED[AI_MODE].id_list == "/v3/serp/id_list"
    assert all(endpoint.result == "task_get/advanced" for endpoint in ENDPOINTS.values())
    assert len({endpoint.payload_slug for endpoint in ENDPOINTS.values()}) == 3
    assert ai.ADAPTER_VERSION == 1


@pytest.fixture
async def dataforseo() -> AsyncIterator[tuple[DataForSeo, Api]]:
    events: list[str] = []
    api = Api(events)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield DataForSeo(client, installation="test"), api


@pytest.mark.parametrize(
    ("endpoint", "base"),
    [
        (CHATGPT_SCRAPER, "/v3/ai_optimization/chat_gpt/llm_scraper"),
        (GEMINI_SCRAPER, "/v3/ai_optimization/gemini/llm_scraper"),
        (AI_MODE, "/v3/serp/google/ai_mode"),
    ],
)
async def test_a_task_is_posted_to_its_endpoint_with_its_tag(
    dataforseo: tuple[DataForSeo, Api], endpoint: str, base: str
) -> None:
    provider, api = dataforseo

    def created(request: httpx.Request) -> httpx.Response:
        (task,) = api.posted()
        return as_json(
            envelope(
                [
                    task_answer(
                        status_code=20100,
                        message="Task Created.",
                        task_id="p-1",
                        cost=0.0012,
                        data=task,
                    )
                ]
            )
        )

    api.on("POST", f"{base}/task_post", created)

    result = await provider.submit(endpoint, [_request(_params())])

    assert api.posted()[0]["tag"] == make_tag("test", 35, 1, RUN)
    assert [(task.task_id, task.provider_task_id) for task in result.accepted] == [("35", "p-1")]


async def test_a_chatgpt_answer_is_fetched_as_the_exact_bytes(
    dataforseo: tuple[DataForSeo, Api],
) -> None:
    provider, api = dataforseo
    raw = (FIXTURES / "captured" / "chatgpt_scraper_answer.json").read_bytes()
    task_id = "11110640-2666-0626-0000-62929163309c"
    api.on(
        "GET",
        f"/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/{task_id}",
        lambda _request: httpx.Response(
            200, content=raw, headers={"content-type": "application/json"}
        ),
    )

    result = await provider.fetch(CHATGPT_SCRAPER, task_id)

    assert (result.status, result.body) == ("ready", raw)
