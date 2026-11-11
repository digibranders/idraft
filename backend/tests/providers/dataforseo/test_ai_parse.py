"""The AI answer normalizer, version 1 (docs/07-dataforseo-ai-integration.md section 5): the three
answers captured in spike S-04 and small synthetic answers for what the spike did not see."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from idraft.providers.dataforseo.ai_parse import (
    EXTRAS_MAX_BYTES,
    READS_PATHS,
    AiSchemaMismatchError,
    NormalizedAnswer,
    parse_ai_answer,
    unreadable,
)
from idraft.providers.dataforseo.schema_hash import reads, schema_hash, schema_paths
from tests.providers.dataforseo.support import FIXTURES

AI = FIXTURES / "ai"
CAPTURED = FIXTURES / "captured"


def _load(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(path.read_text())
    return loaded


def _parse(engine_code: str, path: Path) -> NormalizedAnswer:
    return parse_ai_answer(engine_code, path.read_bytes())


def _answer(result: Any, *, status_code: int = 20000) -> dict[str, Any]:
    return {"status_code": 20000, "tasks": [{"status_code": status_code, "result": result}]}


# The captured answers (S-04, 2026-11-11).


def test_a_chatgpt_answer_is_its_markdown_with_the_sources_in_order() -> None:
    answer = _parse("chatgpt_web", CAPTURED / "chatgpt_scraper_answer.json")
    result = _load(CAPTURED / "chatgpt_scraper_answer.json")["tasks"][0]["result"][0]

    assert answer.status == "complete"
    assert answer.is_valid
    assert answer.answer_text == result["markdown"]
    assert answer.model_reported == "gpt-6"
    assert answer.observed_at == datetime(2026, 11, 11, 6, 41, 8, tzinfo=UTC)
    assert (answer.device, answer.language_code) == ("desktop", "en")
    assert answer.fan_out_count == 1
    # Nine listed, one listed twice.
    assert len(answer.sources) == 8
    first = answer.sources[0]
    assert first.kind == "source_list"
    assert first.raw_url.endswith("utm_source=chatgpt.com")
    assert first.url is not None
    assert first.url.url == (
        "https://www.itechguides.com/"
        "top-12-managed-security-service-providers-mssp-in-india-2026-shortlist"
    )
    assert first.url.referral_tag == "chatgpt.com"
    assert first.source_name == "iTechGuides"
    # Cited by three blocks, the first of them the third item.
    assert (first.occurrences, first.answer_block_index) == (3, 2)
    extras = answer.provider_extras
    assert extras is not None
    assert str(extras["check_url"]).startswith("https://chatgpt.com/?prompt=")
    assert len(extras["brand_entities"]) == 12
    assert extras["search_results"] == 12
    assert extras["ads"] == []


def test_a_gemini_answer_merges_the_sources_it_lists_more_than_once() -> None:
    answer = _parse("gemini_web", CAPTURED / "gemini_scraper_answer.json")

    assert answer.status == "complete"
    assert answer.model_reported == "3.5 Flash-Lite"
    assert answer.fan_out_count == 0
    hosts = [source.url.host.name for source in answer.sources if source.url is not None]
    # Thirteen listed: text fragments and repeats fold into five pages.
    assert hosts == [
        "www.cybernx.com",
        "infilux.in",
        "netnxt.com",
        "eventussecurity.com",
        "factosecure.com",
    ]
    assert [source.occurrences for source in answer.sources] == [1, 2, 2, 1, 4]
    # Listed but cited by no block: no block to point at.
    assert answer.sources[3].answer_block_index is None


def test_an_ai_mode_answer_is_its_overview_with_references_then_links() -> None:
    answer = _parse("google_ai_mode", CAPTURED / "ai_mode_answer.json")
    item = _load(CAPTURED / "ai_mode_answer.json")["tasks"][0]["result"][0]["items"][0]

    assert answer.status == "complete"
    assert answer.answer_text == item["markdown"]
    assert answer.model_reported is None
    assert [source.kind for source in answer.sources[:3]] == [
        "reference_card",
        "reference_card",
        "inline",
    ]
    assert answer.sources[0].source_name == "Embee Software"
    # Two references and ten more links; the link to the first reference is the reference.
    assert len(answer.sources) == 12
    assert answer.check_url is not None
    assert answer.check_url.startswith("https://www.google.com/search?q=")


# What the spike did not see (doc 07 sections 5.4 and 5.5).


def test_an_ad_is_neither_answer_text_nor_a_citation() -> None:
    answer = _parse("chatgpt_web", AI / "chatgpt_ad.json")

    assert answer.answer_text == (
        "Acme SOC runs a 24x7 security operations centre in Mumbai and Pune.\n\n"
    )
    assert [source.raw_url for source in answer.sources] == [
        "https://acme-soc.example/services?utm_source=chatgpt.com"
    ]
    assert answer.provider_extras is not None
    assert answer.provider_extras["ads"] == [
        {
            "type": "chat_gpt_ad",
            "domain": "rival-watch.example",
            "url": "https://rival-watch.example/offer",
            "title": "Rival Watch",
            "is_rendered": True,
        }
    ]


@pytest.mark.parametrize(
    ("name", "status"),
    [
        ("chatgpt_refused", "refused"),
        ("chatgpt_empty", "empty"),
        ("chatgpt_partial", "partial"),
    ],
)
def test_refusals_empties_and_partials_are_told_apart(name: str, status: str) -> None:
    answer = _parse("chatgpt_web", AI / f"{name}.json")

    assert answer.status == status
    assert answer.is_valid is (status == "partial")


def test_a_short_answer_is_a_refusal() -> None:
    body = _answer([{"markdown": "No.", "items": [{"type": "chat_gpt_text", "markdown": "No."}]}])

    assert parse_ai_answer("chatgpt_web", body).status == "refused"


def test_a_refusal_with_a_curly_apostrophe_is_a_refusal() -> None:
    apostrophe = "\N{RIGHT SINGLE QUOTATION MARK}"
    text = f"I{apostrophe}m sorry, but I can{apostrophe}t compare vendors for you."
    body = _answer([{"markdown": text, "items": [{"type": "chat_gpt_text", "markdown": text}]}])

    assert parse_ai_answer("chatgpt_web", body).status == "refused"


def test_a_task_the_provider_refused_is_an_error_with_its_code() -> None:
    answer = _parse("chatgpt_web", AI / "task_error.json")

    assert (answer.status, answer.error_code) == ("error", "40501")
    assert answer.answer_text is None
    assert not answer.is_valid


FILLER = (
    " Acme SOC, Rival Watch and Orbit Defence each run a 24x7 security operations centre in India,"
    " with managed detection, incident response and compliance reporting for mid-sized firms."
)


def _cited_answer(text: str, *urls: str) -> dict[str, Any]:
    """A ChatGPT answer whose one block cites every url, listed again in the source list."""
    sources = [{"type": "chat_gpt_source", "title": "T", "url": url} for url in urls]
    block = {"type": "chat_gpt_text", "markdown": text, "sources": sources}
    return _answer([{"markdown": text, "sources": sources, "items": [block]}])


@pytest.mark.parametrize(
    "opening",
    [
        "I can't help with choosing just one, but here are the five best SOC providers in India:",
        "I'm unable to help narrow this to one vendor without your budget. Here are ten options:",
    ],
)
def test_a_hedged_answer_that_opens_with_a_refusal_phrase_is_still_an_answer(opening: str) -> None:
    text = opening + FILLER * 2
    assert len(text) >= 300

    answer = parse_ai_answer("chatgpt_web", _cited_answer(text, "https://acme-soc.example/"))

    assert answer.status == "complete"
    assert answer.is_valid


def test_a_short_answer_that_opens_with_a_refusal_phrase_is_a_refusal_even_with_sources() -> None:
    text = "I can't help with comparing security vendors for you." + FILLER
    assert 40 < len(text) < 300

    answer = parse_ai_answer("chatgpt_web", _cited_answer(text, "https://acme-soc.example/"))

    assert answer.status == "refused"


def test_a_refusal_phrase_further_into_the_answer_is_not_a_refusal() -> None:
    text = "Here is what I found. I can't help with pricing, which is not public." + FILLER

    assert parse_ai_answer("chatgpt_web", _cited_answer(text)).status == "complete"


def test_a_long_refusal_without_any_source_is_a_refusal() -> None:
    text = "I cannot help with that request." + FILLER * 2
    assert len(text) >= 300
    body = _answer([{"markdown": text, "items": [{"type": "chat_gpt_text", "markdown": text}]}])

    assert parse_ai_answer("chatgpt_web", body).status == "refused"


@pytest.mark.parametrize(
    ("code", "text"),
    [("40501", "40501"), (20100, "20100"), (None, "missing"), (50000, "50000")],
)
def test_only_a_task_status_of_exactly_20000_is_read(code: object, text: str) -> None:
    body = _answer([{"markdown": "Acme SOC runs a 24x7 operations centre in Mumbai."}])
    body["tasks"][0]["status_code"] = code

    answer = parse_ai_answer("chatgpt_web", body)

    assert (answer.status, answer.error_code, answer.answer_text) == ("error", text, None)


def test_an_address_that_is_not_a_web_page_is_kept_without_a_canonical_url() -> None:
    answer = parse_ai_answer(
        "chatgpt_web",
        _cited_answer(
            "Acme SOC runs a 24x7 security operations centre in Mumbai.",
            "javascript:void(0)",
            "ftp://files.acme-soc.example/report.pdf",
            "https://acme-soc.example/",
        ),
    )

    assert [(source.raw_url, source.url is None) for source in answer.sources] == [
        ("javascript:void(0)", True),
        ("ftp://files.acme-soc.example/report.pdf", True),
        ("https://acme-soc.example/", False),
    ]
    assert answer.provider_extras is not None
    assert answer.provider_extras["unreadable_sources"] == 2


@pytest.mark.parametrize("stamp", [None, "yesterday", "2026-11-12", "2026-13-45 99:00:00 +00:00"])
def test_a_missing_or_malformed_datetime_is_no_observation_time(stamp: str | None) -> None:
    body = _cited_answer("Acme SOC runs a 24x7 security operations centre in Mumbai.")
    body["tasks"][0]["result"][0]["datetime"] = stamp

    assert parse_ai_answer("chatgpt_web", body).observed_at is None


def test_a_gemini_answer_is_its_markdown_and_carries_its_time() -> None:
    answer = _parse("gemini_web", CAPTURED / "gemini_scraper_answer.json")
    result = _load(CAPTURED / "gemini_scraper_answer.json")["tasks"][0]["result"][0]

    assert answer.answer_text == result["markdown"]
    assert answer.observed_at == datetime(2026, 11, 11, 6, 42, 14, tzinfo=UTC)


def test_an_ai_mode_answer_carries_its_time() -> None:
    answer = _parse("google_ai_mode", CAPTURED / "ai_mode_answer.json")

    assert answer.observed_at == datetime(2026, 11, 11, 6, 40, 56, tzinfo=UTC)


def test_an_advertised_address_is_not_cited_even_when_the_source_list_has_it() -> None:
    ad = {
        "type": "chat_gpt_ad",
        "markdown": "Sponsored: Rival Watch.",
        "url": "https://rival-watch.example/offer",
        "domain": "rival-watch.example",
    }
    text = "Acme SOC runs a 24x7 security operations centre in Mumbai and Pune."
    organic = {"type": "chat_gpt_source", "title": "Acme", "url": "https://acme-soc.example/"}
    advertised = {
        "type": "chat_gpt_source",
        "title": "Rival",
        "url": "https://rival-watch.example/offer?utm_source=chatgpt.com",
    }
    block = {"type": "chat_gpt_text", "markdown": text, "sources": [organic]}
    body = _answer(
        [{"markdown": text, "sources": [organic, advertised], "items": [block, ad]}],
    )

    answer = parse_ai_answer("chatgpt_web", body)

    assert [source.raw_url for source in answer.sources] == ["https://acme-soc.example/"]


@pytest.mark.parametrize("paid_type", ["ai_overview_paid", "paid"])
def test_an_advertised_address_in_an_ai_mode_overview_is_not_cited(paid_type: str) -> None:
    text = "Acme SOC runs a 24x7 security operations centre in Mumbai and Pune."
    paid = {
        "type": paid_type,
        "markdown": "Sponsored.",
        "url": "https://rival-watch.example/offer",
    }
    element = {
        "type": "ai_overview_element",
        "markdown": text,
        "links": [
            {"url": "https://acme-soc.example/"},
            {"url": "https://rival-watch.example/offer"},
        ],
    }
    reference = {"url": "https://rival-watch.example/offer", "source": "Rival"}
    overview = {"type": "ai_overview", "markdown": text, "references": [reference]}
    overview["items"] = [element, paid]
    body = _answer([{"items": [overview]}])

    answer = parse_ai_answer("google_ai_mode", body)

    assert [source.raw_url for source in answer.sources] == ["https://acme-soc.example/"]


def test_several_ai_mode_overviews_are_one_answer_in_order() -> None:
    first = {
        "type": "ai_overview",
        "markdown": "Acme SOC runs a 24x7 operations centre in Mumbai.",
        "references": [{"url": "https://acme-soc.example/", "source": "Acme"}],
        "items": [],
    }
    second = {
        "type": "ai_overview",
        "markdown": "Rival Watch runs a 24x7 operations centre in Pune.",
        "references": [{"url": "https://rival-watch.example/", "source": "Rival"}],
        "items": [],
    }

    answer = parse_ai_answer("google_ai_mode", _answer([{"items": [first, second]}]))

    assert answer.answer_text == f"{first['markdown']}\n\n{second['markdown']}"
    assert [source.raw_url for source in answer.sources] == [
        "https://acme-soc.example/",
        "https://rival-watch.example/",
    ]


def test_a_task_without_a_result_is_empty() -> None:
    assert parse_ai_answer("gemini_web", _answer(None)).status == "empty"


def test_the_model_is_read_with_its_whitespace_collapsed() -> None:
    answer = _parse("gemini_web", AI / "gemini_nbsp_model.json")

    assert answer.model_reported == "3.5 Flash-Lite"
    # The same page with and without a text fragment is one source.
    assert [(source.raw_url, source.occurrences) for source in answer.sources] == [
        ("https://acme-soc.example/", 2)
    ]


def test_an_unreadable_answer_is_an_error_kept_with_its_code() -> None:
    at = datetime(2026, 11, 12, tzinfo=UTC)

    answer = unreadable("schema_mismatch", observed_at=at)

    assert (answer.status, answer.error_code, answer.observed_at) == (
        "error",
        "schema_mismatch",
        at,
    )
    assert answer.sources == ()


@pytest.mark.parametrize(
    ("body", "path"),
    [
        (b"not json", "$"),
        (b"[1, 2]", "$"),
        (b'{"tasks": []}', "tasks[]"),
        (json.dumps(_answer([{"items": {"type": "x"}}])).encode(), "tasks[].result[].items"),
        (json.dumps(_answer([{"items": ["x"]}])).encode(), "tasks[].result[].items[0]"),
    ],
)
def test_an_answer_of_another_shape_is_refused_with_where(body: bytes, path: str) -> None:
    with pytest.raises(AiSchemaMismatchError) as raised:
        parse_ai_answer("chatgpt_web", body)

    assert raised.value.path == path


def test_text_the_database_cannot_keep_is_cleaned() -> None:
    body = _answer(
        [{"markdown": "Acme\x00 SOC runs a security operations centre in Mumbai.", "items": None}]
    )

    answer = parse_ai_answer("chatgpt_web", body)

    assert answer.answer_text == "Acme SOC runs a security operations centre in Mumbai."


def test_the_extras_are_cut_to_fit_their_column() -> None:
    brands = [{"title": f"Brand {n} " + "x" * 200, "category": "company"} for n in range(400)]
    body = _answer(
        [
            {
                "markdown": "Acme SOC runs a security operations centre in Mumbai.",
                "items": None,
                "brand_entities": brands,
            }
        ]
    )

    extras = parse_ai_answer("chatgpt_web", body).provider_extras

    assert extras is not None
    assert extras["truncated"] is True
    assert 0 < len(extras["brand_entities"]) < 400
    assert len(json.dumps(extras, ensure_ascii=False).encode()) <= EXTRAS_MAX_BYTES


# The fixtures and their registry (docs/26-testing-quality.md section 3.3).


def _registry() -> Mapping[str, Any]:
    loaded: Mapping[str, Any] = json.loads((AI / "registry.json").read_text())
    return loaded


@pytest.mark.gold
def test_each_fixtures_schema_hash_matches_its_record() -> None:
    for record in _registry()["fixtures"]:
        document = _load(FIXTURES / record["file"])
        assert schema_hash(document) == record["schema_hash"], record["id"]


@pytest.mark.gold
def test_every_path_the_parser_reads_exists_in_the_fixtures() -> None:
    union: set[str] = set()
    for record in _registry()["fixtures"]:
        union |= schema_paths(_load(FIXTURES / record["file"]))

    missing = [path for path in READS_PATHS if not reads(frozenset(union), path)]

    assert missing == []


@pytest.mark.gold
def test_every_fixture_parses_to_the_status_its_record_names() -> None:
    for record in _registry()["fixtures"]:
        answer = parse_ai_answer(record["engine_code"], (FIXTURES / record["file"]).read_bytes())
        assert answer.status == record["status"], record["id"]
