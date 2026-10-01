"""DataForSEO Labs `keyword_overview`, called live (docs/06-dataforseo-seo-integration.md
section 7; plan decision D6).

One live call takes up to 700 keywords at one location and language and answers at once; there
is no task to fetch later. Each of our tasks is one keyword, so a call carries many of them: the
answer is kept whole for each, and its cost is split over them. What the answer says of each
keyword is read here, for the ingester; a keyword Labs knows nothing of is left out of it.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Final

from pydantic import Field, field_validator

from sightline.providers.contract import CanonicalRequest, Contract

# The ledger's name for the endpoint.
KEYWORD_OVERVIEW: Final = "dataforseo_labs/google/keyword_overview"
PATH: Final = "/v3/dataforseo_labs/google/keyword_overview/live"
PAYLOAD_SLUG: Final = "dataforseo_labs_google_keyword_overview"
# Keywords in one call (DataForSEO's limit for `keyword_overview`).
BATCH_SIZE: Final = 700
# The call gate's family for Labs live calls: Labs takes 30 calls at once per account, and its
# own per-minute limit keeps far under that (docs/01 section 2.2).
FAMILY: Final = "labs_live"
# A live call has no result to wait for; a task without one after this long is given up.
RESULT_LIFETIME: Final = timedelta(hours=1)
# The longest keyword Labs takes. A longer one is refused on its own, without being sent, so it
# cannot fail the call it would share with 699 others.
KEYWORD_MAX: Final = 80
_COST_STEP: Final = Decimal("0.000001")
_LEVELS: Final = frozenset({"LOW", "MEDIUM", "HIGH"})


class UnreadableAnswerError(ValueError):
    """The body is not a Labs `keyword_overview` answer."""


class KeywordOverviewParams(Contract):
    # As the keyword is entered; Labs folds case itself.
    keyword: str = Field(min_length=1)
    location_code: int = Field(ge=1)
    language_code: str = Field(pattern=r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")

    @field_validator("keyword")
    @classmethod
    def _labs_takes_it(cls, keyword: str) -> str:
        if len(keyword) > KEYWORD_MAX:
            raise ValueError(f"Labs takes keywords of at most {KEYWORD_MAX} characters")
        if keyword != keyword.strip() or any(ord(char) < 32 for char in keyword):
            raise ValueError("a keyword is one trimmed line")
        return keyword


def params_of(request: CanonicalRequest) -> KeywordOverviewParams:
    """The request's keyword, location and language. Raises `TypeError` for a request of
    another endpoint."""
    if not isinstance(request.params, KeywordOverviewParams):
        raise TypeError("not a keyword_overview request")
    return request.params


def build(location_code: int, language_code: str, keywords: Sequence[str]) -> dict[str, object]:
    """The one task of a call. SERP and clickstream data are not asked for: they cost more and
    the ingester does not read them."""
    return {
        "keywords": list(keywords),
        "location_code": location_code,
        "language_code": language_code,
        "include_serp_info": False,
        "include_clickstream_data": False,
    }


def split_cost(total: Decimal | None, parts: int) -> list[Decimal | None]:
    """`total` over `parts` tasks, each share rounded down to the millionth and what is left
    on the first, so the shares add up to the total exactly."""
    if total is None:
        return [None] * parts
    share = (total / parts).quantize(_COST_STEP, rounding=ROUND_DOWN)
    return [total - share * (parts - 1), *([share] * (parts - 1))]


def match_key(keyword: str) -> str:
    """How a keyword of ours is matched to one of the answer: Labs lowers case and may tidy
    spaces, so both sides are compared folded, with runs of spaces as one."""
    return " ".join(keyword.casefold().split())


@dataclass(frozen=True, slots=True)
class MonthlyVolume:
    year: int
    month: int
    search_volume: int | None


@dataclass(frozen=True, slots=True)
class KeywordOverview:
    """What Labs says of one keyword. None where it says nothing, or something that is not
    what it documents."""

    keyword: str
    search_volume: int | None
    monthly_searches: tuple[MonthlyVolume, ...]  # oldest first
    cpc_usd: Decimal | None
    competition: float | None  # 0 to 1
    competition_level: str | None  # LOW, MEDIUM or HIGH
    keyword_difficulty: int | None  # 0 to 100
    main_intent: str | None
    foreign_intents: tuple[str, ...]


def _field(value: object, *path: str) -> object:
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _count(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _decimal(value: object) -> Decimal | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        value = Decimal(value)
    if isinstance(value, Decimal) and value.is_finite() and value >= 0:
        return value
    return None


def _ratio(value: object) -> float | None:
    number = _decimal(value)
    return float(number) if number is not None and number <= 1 else None


def _difficulty(value: object) -> int | None:
    count = _count(value)
    return count if count is not None and count <= 100 else None


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _months(value: object) -> tuple[MonthlyVolume, ...]:
    if not isinstance(value, list):
        return ()
    found = {}
    for entry in value:
        year, month = _count(_field(entry, "year")), _count(_field(entry, "month"))
        if year is None or month is None or not 1 <= month <= 12:
            continue
        found[(year, month)] = MonthlyVolume(year, month, _count(_field(entry, "search_volume")))
    return tuple(found[key] for key in sorted(found))


def _overview(item: object) -> KeywordOverview | None:
    keyword = _text(_field(item, "keyword"))
    if keyword is None:
        return None
    info = _field(item, "keyword_info")
    level = _field(info, "competition_level")
    foreign = _field(item, "search_intent_info", "foreign_intent")
    return KeywordOverview(
        keyword=keyword,
        search_volume=_count(_field(info, "search_volume")),
        monthly_searches=_months(_field(info, "monthly_searches")),
        cpc_usd=_decimal(_field(info, "cpc")),
        competition=_ratio(_field(info, "competition")),
        competition_level=level if isinstance(level, str) and level in _LEVELS else None,
        keyword_difficulty=_difficulty(_field(item, "keyword_properties", "keyword_difficulty")),
        main_intent=_text(_field(item, "search_intent_info", "main_intent")),
        foreign_intents=tuple(
            text for text in (foreign if isinstance(foreign, list) else []) if _text(text)
        ),
    )


def read_overview(body: bytes) -> dict[str, KeywordOverview]:
    """Each keyword of the answer, by `match_key`. Raises `UnreadableAnswerError` for a body
    that is not a Labs answer with one task and a result."""
    try:
        # Money is read as decimals, never as binary fractions.
        answer = json.loads(body, parse_float=Decimal)
    except ValueError:
        raise UnreadableAnswerError("the body is not JSON") from None
    tasks = _field(answer, "tasks")
    if not isinstance(tasks, list) or len(tasks) != 1:
        raise UnreadableAnswerError("the answer does not hold one task")
    results = _field(tasks[0], "result")
    if not isinstance(results, list):
        raise UnreadableAnswerError("the task has no result")
    found: dict[str, KeywordOverview] = {}
    for result in results:
        items = _field(result, "items")
        for item in items if isinstance(items, list) else []:
            overview = _overview(item)
            if overview is not None:
                found.setdefault(match_key(overview.keyword), overview)
    return found
