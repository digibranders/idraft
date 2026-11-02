"""Google organic SERP tasks (docs/06-dataforseo-seo-integration.md sections 1 and 3.1).

The workload says what to search; this module turns that into a `task_post` task under the
rules of doc 06 section 3.1. The fields every task sends the same way are fixed here, not
chosen per request: the asynchronous AI Overview is always loaded, results are grouped, no
rectangles are computed, and no callback URL is sent.
"""

from __future__ import annotations

import re
from datetime import timedelta
from decimal import Decimal
from typing import Final, Literal, Self

from pydantic import Field, field_validator, model_validator

from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo.endpoint import TaskEndpoint

# The ledger's name for the endpoint.
SERP_ORGANIC: Final = "serp/google/organic"
# The same search asked and answered in one call (check now, docs/06 section 3.3).
SERP_ORGANIC_LIVE: Final = "serp/google/organic/live"
LIVE_PATH: Final = "/v3/serp/google/organic/live/advanced"
# The call gate's family for live SERP calls.
LIVE_FAMILY: Final = "serp_live"
# What one live call can cost: $0.002 a page up to 100 results, with room for a price rise.
LIVE_CALL_COST_MAX: Final = Decimal("1.00")
# Control characters, C0 and C1: a keyword is one line of text (Labs checks the same).
CONTROL: Final = re.compile(r"[\x00-\x1f\x7f-\x9f]")
# The operating systems DataForSEO offers for each device.
_SYSTEMS: Final = {"desktop": ("windows", "macos"), "mobile": ("android", "ios")}


class SerpOrganicParams(Contract):
    keyword: str = Field(min_length=1, max_length=700)
    location_code: int = Field(ge=1)
    # ISO 639-1, with a region or script where DataForSEO has one ("zh-TW", "sr-Latn").
    language_code: str = Field(pattern=r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")
    device: Literal["desktop", "mobile"] = "desktop"
    # None: the provider's default for the device.
    os: Literal["windows", "macos", "android", "ios"] | None = None
    se_domain: str | None = Field(default=None, pattern=r"^google(\.[a-z]{2,3}){1,2}$")
    depth: int = Field(ge=1, le=700)
    # The priority queue costs twice as much; only a schedule that chose it uses it.
    queue: Literal["standard", "priority", "live"] = "standard"
    # 0: no clicks, and the field is not sent (DataForSEO documents 1 to 4).
    people_also_ask_click_depth: int = Field(default=0, ge=0, le=4)

    @field_validator("keyword")
    @classmethod
    def _as_entered(cls, keyword: str) -> str:
        if keyword != keyword.strip() or CONTROL.search(keyword):
            raise ValueError("a keyword is one trimmed line")
        return keyword

    @model_validator(mode="after")
    def _os_of_the_device(self) -> Self:
        if self.os is not None and self.os not in _SYSTEMS[self.device]:
            raise ValueError(f"{self.os} is not a {self.device} system")
        return self


def as_sent(keyword: str) -> str:
    """DataForSEO decodes `%` followed by two characters in a keyword, and reads `+` as a
    space; each is sent escaped so the keyword is searched as entered."""
    return keyword.replace("%", "%25").replace("+", "%2B")


def task_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    params = request.params
    if not isinstance(params, SerpOrganicParams):
        raise TypeError(f"not a SERP request: {type(params).__name__}")
    body: dict[str, object] = {
        "keyword": as_sent(params.keyword),
        "location_code": params.location_code,
        "language_code": params.language_code,
        "device": params.device,
        "depth": params.depth,
        "priority": 2 if params.queue == "priority" else 1,
        "load_async_ai_overview": True,
        "group_organic_results": True,
        "calculate_rectangles": False,
        "tag": tag,
    }
    if params.people_also_ask_click_depth:
        body["people_also_ask_click_depth"] = params.people_also_ask_click_depth
    if params.os is not None:
        body["os"] = params.os
    if params.se_domain is not None:
        body["se_domain"] = params.se_domain
    return body


def live_body(request: CanonicalRequest) -> dict[str, object]:
    """The body of a live call: a task body without the queue and the tag, which only
    `task_post` takes."""
    body = task_body(request, tag="")
    del body["tag"], body["priority"]
    return body


ENDPOINT: Final = TaskEndpoint(
    base="/v3/serp/google/organic",
    result="task_get/advanced",
    build=task_body,
    # A standard task is done within hours; one with no result after 72 hours is given up
    # (doc 06 section 4.2). Results themselves can be fetched for 30 days.
    result_lifetime=timedelta(hours=72),
    payload_slug="serp_google_organic_advanced",
    id_list="/v3/serp/id_list",
)
