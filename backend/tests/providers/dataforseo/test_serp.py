"""What a SERP task asks DataForSEO for (docs/06-dataforseo-seo-integration.md section 3.1)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo.serp import SerpOrganicParams, task_body

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")
TAG = "i:test:t:z:a:1:r:0192f0a13c447e108a512b7d9c0e4f11"


def _params(**changes: Any) -> SerpOrganicParams:
    fields: dict[str, Any] = {
        "keyword": "best crm for startups",
        "location_code": 2840,
        "language_code": "en",
        "device": "desktop",
        "depth": 20,
    }
    fields.update(changes)
    return SerpOrganicParams(**fields)


def _request(params: Contract, priority: str = "standard") -> CanonicalRequest:
    return CanonicalRequest.model_validate(
        {"task_id": "35", "run_id": RUN, "attempt": 1, "priority": priority, "params": params}
    )


def test_a_task_asks_for_what_the_rules_say() -> None:
    body = task_body(_request(_params()), TAG)

    assert body == {
        "keyword": "best crm for startups",
        "location_code": 2840,
        "language_code": "en",
        "device": "desktop",
        "depth": 20,
        "priority": 1,
        "load_async_ai_overview": True,
        "group_organic_results": True,
        "calculate_rectangles": False,
        "tag": TAG,
    }


@pytest.mark.parametrize(
    ("keyword", "sent"),
    [
        ("c++ tutorial", "c%2B%2B tutorial"),
        ("100% cotton", "100%25 cotton"),
        # Escaped once, in order: a keyword that already looks escaped is searched as typed.
        ("%2B means plus", "%252B means plus"),
    ],
)
def test_a_keyword_is_sent_so_it_is_searched_as_entered(keyword: str, sent: str) -> None:
    assert task_body(_request(_params(keyword=keyword)), TAG)["keyword"] == sent


def test_no_callback_is_asked_for() -> None:
    body = task_body(_request(_params()), TAG)

    assert not {"pingback_url", "postback_url", "postback_data"} & body.keys()


def test_the_priority_queue_is_the_workloads_choice_not_the_dispatchers() -> None:
    """A manual run is dispatched first; it is not sent to the queue that costs twice."""
    assert task_body(_request(_params(), priority="high"), TAG)["priority"] == 1
    assert task_body(_request(_params(queue="priority")), TAG)["priority"] == 2


def test_optional_fields_are_sent_only_when_set() -> None:
    body = task_body(
        _request(
            _params(
                device="mobile", os="ios", se_domain="google.co.uk", people_also_ask_click_depth=1
            )
        ),
        TAG,
    )

    assert body["device"] == "mobile"
    assert body["os"] == "ios"
    assert body["se_domain"] == "google.co.uk"
    assert body["people_also_ask_click_depth"] == 1


def test_a_task_of_another_workload_is_not_built() -> None:
    class Other(Contract):
        prompt: str

    with pytest.raises(TypeError, match="SERP"):
        task_body(_request(Other(prompt="hello")), TAG)


@pytest.mark.parametrize(
    "changes",
    [
        {"keyword": ""},
        {"keyword": " padded"},
        {"keyword": "padded "},
        {"keyword": "two\nlines"},
        {"keyword": "x" * 701},
        {"location_code": 0},
        {"language_code": "english"},
        {"language_code": "EN"},
        {"device": "tablet"},
        {"os": "linux"},
        {"se_domain": "bing.com"},
        {"se_domain": "google.com/search"},
        {"depth": 0},
        {"depth": 701},
        {"people_also_ask_click_depth": 5},
        {"queue": "slow"},
        {"device": "desktop", "os": "ios"},
        {"device": "mobile", "os": "windows"},
        {"pingback_url": "https://example.com/"},
    ],
)
def test_a_request_the_provider_would_refuse_is_not_made(changes: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        _params(**changes)


@pytest.mark.parametrize("language", ["en", "pt", "zh-TW", "sr-Latn"])
def test_documented_language_codes_are_taken(language: str) -> None:
    assert _params(language_code=language).language_code == language
