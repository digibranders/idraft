"""What the 16 KB bound on the stored extras does to a list of fan-out queries (WP-14 T8;
BE-FANOUT-03): the measurement behind the contract note, as tests with no database. A list is cut
only when the extras do not fit, to a prefix of the list; a typical answer (1 to 10 queries) keeps
all of them. The order in which the lists are cut is `test_ai_parse.py`'s."""

from __future__ import annotations

import json
from typing import Any

import pytest

from idraft.providers.dataforseo.ai_parse import EXTRAS_MAX_BYTES, _bounded

QUERY_CHARS = 60


def _queries(count: int, *, accented: bool = False) -> list[str]:
    letter = chr(0xE9) if accented else "q"  # e with an acute accent: two bytes in UTF-8
    return [f"{number:04d} ".ljust(QUERY_CHARS, letter) for number in range(count)]


def _extras(queries: list[str], *, brands: int = 0, ads: int = 0) -> dict[str, Any]:
    return {
        "check_url": None,
        "brand_entities": [{"title": f"Brand {n}", "category": "company"} for n in range(brands)],
        "fan_out_queries": queries,
        "search_results": 0,
        "ads": [{"url": f"https://ads.example.com/{n}/"} for n in range(ads)],
        "unreadable_sources": 0,
    }


def _size(extras: dict[str, Any]) -> int:
    return len(json.dumps(extras, ensure_ascii=False).encode())


def test_a_typical_answer_keeps_every_query() -> None:
    payload = _extras(_queries(10), brands=20, ads=2)

    kept = _bounded(payload)

    assert "truncated" not in kept
    assert kept["fan_out_queries"] == payload["fan_out_queries"]
    assert len(kept["fan_out_queries"]) == 10


def test_a_list_of_queries_alone_is_kept_up_to_the_bound() -> None:
    """120 queries of 60 characters are about 7.7 KB of JSON: well inside the 16 KB."""
    payload = _extras(_queries(120))

    kept = _bounded(payload)

    assert 7000 < _size(payload) < EXTRAS_MAX_BYTES
    assert "truncated" not in kept
    assert len(kept["fan_out_queries"]) == 120


def test_halving_keeps_a_prefix_of_the_queries() -> None:
    """400 queries are about 25 KB: the list is halved until it fits, so the first 200 stay
    (about 250 would fit: halving overshoots) and never an arbitrary subset."""
    payload = _extras(_queries(400))

    kept = _bounded(payload)

    stored = kept["fan_out_queries"]
    assert _size(payload) > EXTRAS_MAX_BYTES
    assert kept["truncated"] is True
    assert len(stored) >= 200
    assert stored == payload["fan_out_queries"][: len(stored)]


@pytest.mark.parametrize(
    "payload",
    [
        _extras(_queries(10), brands=20, ads=2),
        _extras(_queries(120)),
        _extras(_queries(400)),
        _extras(_queries(1000, accented=True)),
        _extras(_queries(1000, accented=True), brands=40, ads=60),
    ],
    ids=["typical", "120 queries", "400 queries", "1000 accented", "accented with other lists"],
)
def test_the_stored_extras_never_exceed_the_bound(payload: dict[str, Any]) -> None:
    kept = _bounded(payload)

    assert _size(kept) <= EXTRAS_MAX_BYTES
