"""The probe of `+` and `%` in an AI prompt (docs/ops/ai-first-run.md, step C).

Whether the real DataForSEO AI endpoints decode `+` (as a space) and `%41` (as `A`) is a fact
about the provider. Only the first real run can answer it: a fake transport cannot. These tests
do two other things, with no network and no provider call:

- they pin what the adapter SENDS: an AI task carries the prompt exactly as saved, while SERP
  escapes it (`serp.as_sent`). If the real probe finds that the AI endpoints decode, the adapter
  needs a deliberate change, and `test_serp_escapes_them_and_ai_does_not` is the test to change
  with it;
- they give the first real run a ready verdict function, `verdict(sent, echoed)`, that reads the
  keyword the provider echoes back (`tasks[0].data.keyword` of the answer) and says what the
  engine did to it.

The two probe prompts are the ones of the runbook; change them there and here together.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Mapping
from typing import Any
from urllib.parse import unquote, unquote_plus

import httpx
import pytest

from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo.ai import (
    AI_MODE,
    CHATGPT_SCRAPER,
    ENDPOINTS,
    GEMINI_SCRAPER,
    AiAnswerParams,
    ai_mode_body,
    scraper_body,
)
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.provider import DataForSeo
from idraft.providers.dataforseo.serp import SerpOrganicParams, as_sent, task_body
from tests.providers.dataforseo.support import (
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
PLUS = "Is a SOC 2 + ISO 27001 certified managed SOC provider better for a bank in India?"
PERCENT = "Is %41 in a web server log a sign of an attack or just an encoded letter A?"
PROBES = [PLUS, PERCENT]
BASES = {
    CHATGPT_SCRAPER: "/v3/ai_optimization/chat_gpt/llm_scraper",
    GEMINI_SCRAPER: "/v3/ai_optimization/gemini/llm_scraper",
    AI_MODE: "/v3/serp/google/ai_mode",
}


def _request(params: Contract) -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {"task_id": "35", "run_id": RUN, "attempt": 1, "priority": "standard", "params": params}
    )


def _ai(prompt: str) -> CanonicalRequest:
    return _request(AiAnswerParams(prompt=prompt, location_code=2356, language_code="en"))


# What the adapter sends.


@pytest.mark.parametrize("prompt", PROBES)
@pytest.mark.parametrize("endpoint", [CHATGPT_SCRAPER, GEMINI_SCRAPER])
def test_a_scraper_task_sends_plus_and_percent_exactly_as_saved(endpoint: str, prompt: str) -> None:
    # The registered builder of each scraper endpoint, not a name imported beside it.
    body = ENDPOINTS[endpoint].build(_ai(prompt), TAG)

    assert body["keyword"] == prompt
    assert body == scraper_body(_ai(prompt), TAG)


@pytest.mark.parametrize("prompt", PROBES)
def test_an_ai_mode_task_sends_them_as_saved_too(prompt: str) -> None:
    body = ENDPOINTS[AI_MODE].build(_ai(prompt), TAG)

    assert body["keyword"] == prompt
    assert body == ai_mode_body(_ai(prompt), TAG)


@pytest.fixture
async def dataforseo() -> AsyncIterator[tuple[DataForSeo, Api]]:
    events: list[str] = []
    api = Api(events)
    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        client = DataForSeoClient(
            http, FakeGate(events), login=LOGIN, password=PASSWORD, origin=ORIGIN
        )
        yield DataForSeo(client, installation="test"), api


@pytest.mark.parametrize("prompt", PROBES)
@pytest.mark.parametrize("endpoint", list(BASES))
async def test_the_post_body_that_leaves_the_client_holds_the_unescaped_keyword(
    dataforseo: tuple[DataForSeo, Api], endpoint: str, prompt: str
) -> None:
    provider, api = dataforseo
    api.on(
        "POST",
        f"{BASES[endpoint]}/task_post",
        lambda _request: as_json(envelope([task_answer(status_code=20100, task_id="p-1")])),
    )

    await provider.submit(endpoint, [_ai(prompt)])

    (sent,) = api.requests
    (task,) = json.loads(sent.content)
    assert task["keyword"] == prompt
    # No layer between the builder and the wire escapes: neither `%2B` nor `%25` is in the body,
    # and the prompt's own characters are there as typed.
    assert b"%2B" not in sent.content
    assert b"%25" not in sent.content
    assert ("+" in prompt) is (b" + " in sent.content)
    assert ("%41" in prompt) is (b"%41" in sent.content)


def test_serp_escapes_them_and_ai_does_not() -> None:
    serp = SerpOrganicParams(
        keyword=PLUS + " " + PERCENT, location_code=2356, language_code="en", depth=10
    )
    serp_body = task_body(_request(serp), TAG)
    ai_body = scraper_body(_ai(PLUS + " " + PERCENT), TAG)

    assert as_sent(PLUS) == PLUS.replace("+", "%2B")
    assert as_sent(PERCENT) == PERCENT.replace("%", "%25")
    assert serp_body["keyword"] == as_sent(PLUS + " " + PERCENT)
    assert serp_body["keyword"] != ai_body["keyword"]
    assert ai_body["keyword"] == PLUS + " " + PERCENT


# What the first real run learns: the verdict on one echo.


def echoed_keyword(answer: Mapping[str, Any]) -> str | None:
    """The keyword the provider says it ran (`tasks[0].data.keyword`), or None when the answer
    holds none."""
    tasks = answer.get("tasks")
    if not isinstance(tasks, list) or not tasks or not isinstance(tasks[0], Mapping):
        return None
    data = tasks[0].get("data")
    keyword = data.get("keyword") if isinstance(data, Mapping) else None
    return keyword if isinstance(keyword, str) else None


def verdict(sent: str, echoed: str | None) -> str:
    """What the engine did to the prompt that was sent, from the keyword it echoes.

    `not_decoded`: echoed as sent. `plus_read_as_space`: each `+` became a space.
    `percent_code_decoded`: each `%XX` became its character. `both`: both happened.
    `unknown`: no echo, or an echo that is none of these (read it by hand).
    """
    if echoed is None:
        return "unknown"
    if echoed == sent:
        return "not_decoded"
    plus_changes, percent_changes = "+" in sent, unquote(sent) != sent
    if plus_changes and percent_changes and echoed == unquote_plus(sent):
        return "both"
    if plus_changes and echoed == sent.replace("+", " "):
        return "plus_read_as_space"
    if percent_changes and echoed == unquote(sent):
        return "percent_code_decoded"
    return "unknown"


BOTH = "C++ and 100%41 pure"


@pytest.mark.parametrize(
    ("sent", "echoed", "expected"),
    [
        (PLUS, PLUS, "not_decoded"),
        (PERCENT, PERCENT, "not_decoded"),
        (PLUS, PLUS.replace("+", " "), "plus_read_as_space"),
        (PERCENT, PERCENT.replace("%41", "A"), "percent_code_decoded"),
        (BOTH, BOTH, "not_decoded"),
        # Two plus signs are two spaces, then the space that was already there.
        (BOTH, "C   and 100A pure", "both"),
        (BOTH, "C++ and 100A pure", "percent_code_decoded"),
        (BOTH, "C   and 100%41 pure", "plus_read_as_space"),
        # Nothing to decode in the prompt: an echo that differs says nothing about decoding.
        ("plain words", "other words", "unknown"),
        (PLUS, "something else entirely", "unknown"),
        (PLUS, None, "unknown"),
    ],
)
def test_the_probe_verdict_reads_an_echo(sent: str, echoed: str | None, expected: str) -> None:
    answer = envelope([task_answer(data={"keyword": echoed} if echoed is not None else {})])

    assert verdict(sent, echoed_keyword(answer)) == expected


@pytest.mark.parametrize(
    "answer",
    [
        {},
        {"tasks": []},
        {"tasks": ["x"]},
        {"tasks": [{"data": None}]},
        {"tasks": [{"data": {"keyword": 7}}]},
    ],
)
def test_an_answer_with_no_echoed_keyword_is_unknown(answer: dict[str, Any]) -> None:
    assert echoed_keyword(answer) is None
    assert verdict(PLUS, echoed_keyword(answer)) == "unknown"
