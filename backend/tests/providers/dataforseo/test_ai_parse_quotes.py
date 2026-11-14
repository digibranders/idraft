"""The quote of a cited source (WP-26 BE-SOURCES-21): the passage the provider says it took from
the page. Gemini's scraper gives a `snippet` on the sources of its blocks, Google AI Mode a `text`
on its references; the ChatGPT scraper gives none."""

from __future__ import annotations

import json
from typing import Any

import pytest

from idraft.providers.dataforseo.ai_parse import (
    QUOTE_MAX_CHARS,
    READS_PATHS,
    NormalizedAnswer,
    parse_ai_answer,
)
from tests.providers.dataforseo.support import FIXTURES

CAPTURED = FIXTURES / "captured"
PAGE = "https://news.example/soc"


def _scraper(sources: list[dict[str, Any]], *, listed: list[dict[str, Any]] | None = None) -> bytes:
    """A Gemini scraper answer whose one block cites `sources`; `listed` is the answer's own
    source list (none by default)."""
    text = "Several firms run managed SOCs in India, with round the clock monitoring."
    result = {
        "model": "gemini-3.5-flash",
        "datetime": "2026-11-11 06:41:08 +00:00",
        "markdown": text,
        "sources": listed or [],
        "items": [{"type": "gemini_text", "markdown": text, "sources": sources}],
    }
    task = {"status_code": 20000, "result": [result]}
    return json.dumps({"status_code": 20000, "tasks": [task]}).encode()


def _ai_mode(references: list[dict[str, Any]]) -> bytes:
    text = "Several firms run managed SOCs in India, with round the clock monitoring."
    overview = {"type": "ai_overview", "markdown": text, "references": references, "items": []}
    result = {"datetime": "2026-11-11 06:41:08 +00:00", "items": [overview]}
    task = {"status_code": 20000, "result": [result]}
    return json.dumps({"status_code": 20000, "tasks": [task]}).encode()


def _quote_of(answer: NormalizedAnswer) -> str | None:
    assert len(answer.sources) == 1
    return answer.sources[0].quote


def _gemini(sources: list[dict[str, Any]], **kwargs: Any) -> NormalizedAnswer:
    return parse_ai_answer("gemini_web", _scraper(sources, **kwargs))


def test_the_captured_gemini_answer_gives_a_quote_for_each_source_a_block_cites() -> None:
    answer = parse_ai_answer("gemini_web", (CAPTURED / "gemini_scraper_answer.json").read_bytes())

    assert len(answer.sources) == 5
    # Two sources are only in the list, which carries no snippet; the three cited ones have one,
    # taken from a block although the list named the page first.
    assert [source.quote is not None for source in answer.sources] == [
        False,
        True,
        True,
        False,
        True,
    ]
    last = answer.sources[4].quote
    assert last is not None
    assert last.startswith("Factosecure is emerging as a startup-focused")


def test_the_captured_chatgpt_answer_gives_no_quote() -> None:
    answer = parse_ai_answer("chatgpt_web", (CAPTURED / "chatgpt_scraper_answer.json").read_bytes())

    assert [source.quote for source in answer.sources] == [None] * len(answer.sources)


def test_the_captured_ai_mode_answer_reads_the_text_of_its_references() -> None:
    answer = parse_ai_answer("google_ai_mode", (CAPTURED / "ai_mode_answer.json").read_bytes())

    cards = [source for source in answer.sources if source.kind == "reference_card"]
    assert len(cards) == 2
    assert all(card.quote for card in cards)
    # The element links of an AI Mode answer carry no passage.
    assert all(source.quote is None for source in answer.sources if source.kind == "inline")


def test_a_scraper_snippet_is_the_quote() -> None:
    answer = _gemini([{"url": PAGE, "snippet": "Managed SOC at a fixed price."}])

    assert _quote_of(answer) == "Managed SOC at a fixed price."


def test_an_ai_mode_reference_text_is_the_quote() -> None:
    answer = parse_ai_answer(
        "google_ai_mode", _ai_mode([{"url": PAGE, "text": "Managed SOC at a fixed price."}])
    )

    assert _quote_of(answer) == "Managed SOC at a fixed price."


def test_the_first_non_empty_quote_of_a_page_wins_even_from_a_later_block() -> None:
    listed = [{"url": PAGE, "snippet": "   "}]
    cited = [{"url": PAGE, "snippet": "First passage."}, {"url": PAGE, "snippet": "Second."}]

    answer = _gemini(cited, listed=listed)

    assert _quote_of(answer) == "First passage."


def test_two_addresses_of_one_page_share_the_first_quote() -> None:
    answer = _gemini(
        [
            {"url": PAGE, "snippet": "First passage."},
            {"url": f"{PAGE}?utm_source=chatgpt.com", "snippet": "Second."},
        ]
    )

    assert _quote_of(answer) == "First passage."


@pytest.mark.parametrize("snippet", [None, "", "  \n\t ", 7, ["a"], {"a": "b"}])
def test_a_blank_or_non_string_quote_is_none(snippet: object) -> None:
    answer = _gemini([{"url": PAGE, "snippet": snippet}])

    assert _quote_of(answer) is None


def test_a_source_without_the_field_has_no_quote() -> None:
    assert _quote_of(_gemini([{"url": PAGE}])) is None


def test_whitespace_in_a_quote_is_collapsed() -> None:
    answer = _gemini([{"url": PAGE, "snippet": "  Managed \n\n SOC\t at   a fixed price. "}])

    assert _quote_of(answer) == "Managed SOC at a fixed price."


def test_a_quote_is_cut_at_a_thousand_characters() -> None:
    answer = _gemini([{"url": PAGE, "snippet": "word " * 500}])

    quote = _quote_of(answer)
    assert QUOTE_MAX_CHARS == 1000
    assert quote is not None
    assert len(quote) <= QUOTE_MAX_CHARS
    assert len(quote) > QUOTE_MAX_CHARS - 5
    assert not quote.endswith(" ")


def test_a_quote_of_exactly_a_thousand_characters_is_kept_whole() -> None:
    answer = _gemini([{"url": PAGE, "snippet": "x" * QUOTE_MAX_CHARS}])

    assert _quote_of(answer) == "x" * QUOTE_MAX_CHARS


def test_a_nul_and_a_lone_surrogate_never_reach_the_quote() -> None:
    body = _scraper([{"url": PAGE, "snippet": "Managed\x00 SOC \ud800 pricing."}])

    answer = parse_ai_answer("gemini_web", body)

    quote = _quote_of(answer)
    assert quote is not None
    assert "\x00" not in quote
    quote.encode("utf-8")  # a lone surrogate would raise here
    assert quote == "Managed SOC ? pricing."


def test_a_hostile_quote_stays_text() -> None:
    hostile = "<script>alert(1)</script> [x](javascript:alert(1))"

    answer = _gemini([{"url": PAGE, "snippet": hostile}])

    assert _quote_of(answer) == hostile


def test_reads_paths_cover_the_quote_fields() -> None:
    assert "tasks[].result[].sources[].snippet" in READS_PATHS
    assert "tasks[].result[].items[].sources[].snippet" in READS_PATHS
    assert "tasks[].result[].items[].references[].text" in READS_PATHS
