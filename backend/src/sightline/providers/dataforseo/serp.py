"""Google organic SERP tasks (docs/06-dataforseo-seo-integration.md sections 1 and 3.1).

The workload says what to search; this module turns that into a `task_post` task under the
rules of doc 06 section 3.1. The fields every task sends the same way are fixed here, not
chosen per request: the asynchronous AI Overview is always loaded, results are grouped, no
rectangles are computed, and no callback URL is sent.
"""

from __future__ import annotations

import re
from datetime import timedelta
from typing import Final, Literal

from pydantic import Field, field_validator

from sightline.providers.contract import CanonicalRequest, Contract
from sightline.providers.dataforseo.endpoint import TaskEndpoint

# The ledger's name for the endpoint.
SERP_ORGANIC: Final = "serp/google/organic"
_CONTROL: Final = re.compile(r"[\x00-\x1f\x7f-\x9f]")


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
    queue: Literal["standard", "priority"] = "standard"
    people_also_ask_click_depth: int = Field(default=0, ge=0, le=4)

    @field_validator("keyword")
    @classmethod
    def _as_entered(cls, keyword: str) -> str:
        if keyword != keyword.strip() or _CONTROL.search(keyword):
            raise ValueError("a keyword is one trimmed line")
        return keyword


def task_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    params = request.params
    if not isinstance(params, SerpOrganicParams):
        raise TypeError(f"not a SERP request: {type(params).__name__}")
    body: dict[str, object] = {
        "keyword": params.keyword,
        "location_code": params.location_code,
        "language_code": params.language_code,
        "device": params.device,
        "depth": params.depth,
        "priority": 2 if params.queue == "priority" else 1,
        "load_async_ai_overview": True,
        "people_also_ask_click_depth": params.people_also_ask_click_depth,
        "group_organic_results": True,
        "calculate_rectangles": False,
        "tag": tag,
    }
    if params.os is not None:
        body["os"] = params.os
    if params.se_domain is not None:
        body["se_domain"] = params.se_domain
    return body


ENDPOINT: Final = TaskEndpoint(
    base="/v3/serp/google/organic",
    result="task_get/advanced",
    build=task_body,
    result_lifetime=timedelta(hours=72),
)
