"""The two AI referral classifiers over GA4 session rows (docs/18 sections 7.3 and 7.4)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

import pytest

from idraft.domain.ai_referrals import ReferralRow, Rule, SessionRow, classify

DAY = date(2026, 11, 20)

# docs/18 section 7.4, rule set version 1: (field, type, pattern, assistant, confidence).
_SEED: tuple[
    tuple[Literal["referrer_host", "utm_source"], Literal["exact", "suffix"], str, str, str], ...
] = (
    ("referrer_host", "exact", "chatgpt.com", "chatgpt", "high"),
    ("referrer_host", "exact", "chat.openai.com", "chatgpt", "high"),
    ("referrer_host", "exact", "openai.com", "chatgpt", "ambiguous"),
    ("referrer_host", "suffix", "perplexity.ai", "perplexity", "high"),
    ("referrer_host", "exact", "gemini.google.com", "gemini", "high"),
    ("referrer_host", "exact", "bard.google.com", "gemini", "high"),
    ("referrer_host", "exact", "copilot.microsoft.com", "copilot", "high"),
    ("referrer_host", "exact", "copilot.cloud.microsoft", "copilot", "high"),
    ("referrer_host", "exact", "edgeservices.bing.com", "copilot", "high"),
    ("referrer_host", "exact", "claude.ai", "claude", "high"),
    ("referrer_host", "exact", "chat.deepseek.com", "deepseek", "high"),
    ("referrer_host", "exact", "grok.com", "grok", "high"),
    ("referrer_host", "exact", "x.ai", "grok", "ambiguous"),
    ("referrer_host", "exact", "meta.ai", "meta_ai", "high"),
    ("referrer_host", "exact", "chat.mistral.ai", "mistral", "high"),
    ("referrer_host", "exact", "you.com", "you", "high"),
    ("referrer_host", "exact", "duckduckgo.com", "duckassist", "ambiguous"),
    ("utm_source", "exact", "chatgpt.com", "chatgpt", "high"),
    ("utm_source", "exact", "perplexity", "perplexity", "high"),
    ("utm_source", "exact", "copilot", "copilot", "high"),
)


def _rule(
    field: Literal["referrer_host", "utm_source"],
    match_type: Literal["exact", "suffix"],
    pattern: str,
    assistant: str,
    confidence: Literal["high", "ambiguous"] = "high",
    *,
    rule_id: int = 99,
    version: int = 1,
) -> Rule:
    return Rule(
        rule_set_version=version,
        rule_id=rule_id,
        match_field=field,
        match_type=match_type,
        pattern=pattern,
        assistant_code=assistant,
        confidence=confidence,
    )


def _seed_rules() -> list[Rule]:
    return [
        _rule(
            field,
            match_type,
            pattern,
            assistant,
            "high" if confidence == "high" else "ambiguous",
            rule_id=index,
        )
        for index, (field, match_type, pattern, assistant, confidence) in enumerate(_SEED, 1)
    ]


def _row(
    *,
    source: str = "chatgpt.com",
    medium: str = "referral",
    manual_source: str = "(not set)",
    channel_group: str = "Referral",
    sessions: int = 10,
    engaged: int = 6,
    key_events: str = "2",
    revenue: str = "0",
    day: date = DAY,
) -> SessionRow:
    return SessionRow(
        day=day,
        source=source,
        medium=medium,
        manual_source=manual_source,
        channel_group=channel_group,
        sessions=sessions,
        engaged_sessions=engaged,
        key_events=Decimal(key_events),
        revenue=Decimal(revenue),
    )


def _only(rows: list[ReferralRow]) -> ReferralRow:
    assert len(rows) == 1
    return rows[0]


def test_a_ga4_channel_row_counts_under_the_lowercased_source() -> None:
    row = _row(source="ChatGPT.com", channel_group="AI Assistant", medium="ai-assistant")

    got = _only(classify([row], []))

    assert got.classifier == "ga4_ai_assistant_channel"
    assert got.rules_version == 0
    assert got.assistant_code == "chatgpt.com"
    assert (got.sessions, got.engaged_sessions) == (10, 6)


def test_the_channel_group_is_compared_without_case() -> None:
    got = classify([_row(source="claude.ai", channel_group="ai assistant")], [])

    assert [r.classifier for r in got] == ["ga4_ai_assistant_channel"]


@pytest.mark.parametrize("source", ["(not set)", "(direct)", "", "  "])
def test_a_ga4_channel_row_without_a_source_is_unknown(source: str) -> None:
    got = _only(classify([_row(source=source, channel_group="AI Assistant")], []))

    assert got.assistant_code == "unknown"


def test_a_row_outside_the_channel_is_not_a_ga4_row() -> None:
    assert classify([_row(source="chatgpt.com", channel_group="Organic Search")], []) == []


def test_a_utm_source_match_beats_a_referrer_match() -> None:
    rules = [
        _rule("referrer_host", "exact", "chatgpt.com", "from_referrer", rule_id=1),
        _rule("utm_source", "exact", "campaign", "from_utm", rule_id=2),
    ]

    got = _only(classify([_row(source="chatgpt.com", manual_source="campaign")], rules))

    assert got.assistant_code == "from_utm"


def test_an_exact_rule_beats_a_suffix_rule_of_the_same_field() -> None:
    rules = [
        _rule("referrer_host", "suffix", "perplexity.ai", "suffix_rule", rule_id=1),
        _rule("referrer_host", "exact", "www.perplexity.ai", "exact_rule", rule_id=2),
    ]

    got = _only(classify([_row(source="www.perplexity.ai")], rules))

    assert got.assistant_code == "exact_rule"


def test_a_suffix_rule_matches_the_host_and_its_subdomains_but_not_a_lookalike() -> None:
    rules = [_rule("referrer_host", "suffix", "perplexity.ai", "perplexity")]
    sources = ["perplexity.ai", "www.perplexity.ai", "notperplexity.ai", "perplexity.ai.evil.io"]

    got = classify([_row(source=s, sessions=1) for s in sources], rules)

    assert [(r.assistant_code, r.sessions) for r in got] == [("perplexity", 2)]


@pytest.mark.parametrize("source", ["openai.com", "x.ai", "duckduckgo.com"])
def test_ambiguous_rules_never_match(source: str) -> None:
    assert classify([_row(source=source)], _seed_rules()) == []


@pytest.mark.parametrize("source", ["google", "google.com", "bing", "bing.com", "msn.com"])
def test_search_engines_are_never_ai_even_with_a_hostile_rule(source: str) -> None:
    hostile = [
        *_seed_rules(),
        _rule("referrer_host", "exact", source, "hostile", rule_id=50),
        _rule("referrer_host", "suffix", source, "hostile", rule_id=51),
        _rule("utm_source", "exact", source, "hostile", rule_id=52),
    ]

    assert classify([_row(source=source, manual_source=source)], hostile) == []


@pytest.mark.parametrize("pattern", ["google.com", "bing.com", "msn.com", " Google.COM "])
@pytest.mark.parametrize("field", ["referrer_host", "utm_source"])
def test_a_rule_for_a_search_host_is_dropped_so_its_subdomains_are_not_ai(
    pattern: str, field: Literal["referrer_host", "utm_source"]
) -> None:
    hostile = [_rule(field, "suffix", pattern, "hostile")]
    host = pattern.strip().lower()

    got = classify(
        [_row(source=f"www.{host}", manual_source=f"www.{host}"), _row(source=f"x.{host}")],
        hostile,
    )

    assert got == []


@pytest.mark.parametrize(
    ("host", "assistant"),
    [
        ("gemini.google.com", "gemini"),
        ("copilot.microsoft.com", "copilot"),
        ("edgeservices.bing.com", "copilot"),
    ],
)
def test_seed_rules_on_a_subdomain_of_a_search_host_still_classify(
    host: str, assistant: str
) -> None:
    got = _only(classify([_row(source=host)], _seed_rules()))

    assert got.assistant_code == assistant


@pytest.mark.parametrize(
    ("source", "manual_source"),
    [("(not set)", "google.com"), ("chatgpt.com", "google"), ("chatgpt.com", "bing.com")],
)
def test_a_search_host_on_either_side_of_the_row_drops_the_row(
    source: str, manual_source: str
) -> None:
    # A suffix "com" rule is not a search host pattern, so only the row-level guard stops it.
    rules = [
        _rule("utm_source", "suffix", "com", "hostile", rule_id=1),
        _rule("referrer_host", "exact", "chatgpt.com", "chatgpt", rule_id=2),
    ]

    assert classify([_row(source=source, manual_source=manual_source)], rules) == []


def test_the_first_rule_in_input_order_does_not_decide_between_exact_rules() -> None:
    rules = [
        _rule("referrer_host", "exact", "chatgpt.com", "second", rule_id=7),
        _rule("referrer_host", "exact", "chatgpt.com", "first", rule_id=3),
    ]

    forward = classify([_row(source="chatgpt.com")], rules)
    backward = classify([_row(source="chatgpt.com")], list(reversed(rules)))

    assert forward == backward
    assert _only(forward).assistant_code == "first"


def test_the_longest_suffix_wins_then_the_lowest_rule_id() -> None:
    rules = [
        _rule("referrer_host", "suffix", "ai", "short", rule_id=1),
        _rule("referrer_host", "suffix", "chat.example.ai", "long_b", rule_id=9),
        _rule("referrer_host", "suffix", "chat.example.ai", "long_a", rule_id=4),
    ]

    forward = classify([_row(source="eu.chat.example.ai")], rules)
    backward = classify([_row(source="eu.chat.example.ai")], list(reversed(rules)))

    assert forward == backward
    assert _only(forward).assistant_code == "long_a"


def test_a_direct_row_is_never_ai_but_a_utm_match_on_its_manual_source_counts() -> None:
    rules = [
        _rule("referrer_host", "exact", "(direct)", "hostile", rule_id=1),
        _rule("utm_source", "exact", "chatgpt.com", "chatgpt", rule_id=2),
    ]

    assert classify([_row(source="(direct)")], rules) == []
    got = _only(classify([_row(source="(direct)", manual_source="chatgpt.com")], rules))
    assert got.assistant_code == "chatgpt"


def test_a_row_with_no_source_at_all_is_never_ai() -> None:
    rules = [_rule("referrer_host", "suffix", "", "hostile")]

    assert classify([_row(source="(not set)"), _row(source="")], rules) == []


def test_rows_with_the_same_key_sum_without_floats() -> None:
    rows = [
        _row(sessions=3, engaged=2, key_events="0.10", revenue="10.10"),
        _row(sessions=4, engaged=1, key_events="0.20", revenue="20.20"),
    ]

    got = _only(classify(rows, _seed_rules()))

    assert (got.sessions, got.engaged_sessions) == (7, 3)
    assert got.key_events == Decimal("0.30")
    assert got.total_revenue == Decimal("30.30")
    assert isinstance(got.total_revenue, Decimal)


def test_a_row_in_both_classifiers_appears_in_both() -> None:
    row = _row(source="chatgpt.com", channel_group="AI Assistant", sessions=5)

    got = classify([row], _seed_rules())

    assert [(r.classifier, r.rules_version, r.assistant_code, r.sessions) for r in got] == [
        ("ga4_ai_assistant_channel", 0, "chatgpt.com", 5),
        ("own_rules", 1, "chatgpt", 5),
    ]


def test_the_seed_rules_classify_a_realistic_day() -> None:
    rows = [
        _row(source="chatgpt.com", channel_group="AI Assistant", sessions=40),
        _row(source="chat.openai.com", sessions=5),
        _row(source="www.perplexity.ai", sessions=7),
        _row(source="perplexity", manual_source="perplexity", medium="cpc", sessions=3),
        _row(source="gemini.google.com", sessions=2),
        _row(source="google", medium="organic", channel_group="Organic Search", sessions=900),
        _row(source="bing.com", medium="organic", channel_group="Organic Search", sessions=80),
        _row(source="duckduckgo.com", sessions=11),
        _row(source="(direct)", medium="(none)", channel_group="Direct", sessions=300),
    ]

    got = classify(rows, _seed_rules())

    assert [(r.classifier, r.assistant_code, r.sessions) for r in got] == [
        ("ga4_ai_assistant_channel", "chatgpt.com", 40),
        ("own_rules", "chatgpt", 45),
        ("own_rules", "gemini", 2),
        ("own_rules", "perplexity", 10),
    ]


def test_case_and_whitespace_do_not_change_a_match() -> None:
    rows = [
        _row(source="  ChatGPT.COM ", sessions=1),
        _row(source="chatgpt.com", sessions=2),
        _row(source="x", manual_source=" CHATGPT.com", sessions=4),
    ]

    got = _only(classify(rows, _seed_rules()))

    assert (got.assistant_code, got.sessions) == ("chatgpt", 7)


def test_the_output_order_is_by_day_classifier_and_assistant() -> None:
    later = date(2026, 11, 21)
    rows = [
        _row(source="claude.ai", day=later),
        _row(source="grok.com", channel_group="AI Assistant"),
        _row(source="claude.ai", channel_group="AI Assistant"),
        _row(source="chatgpt.com"),
    ]

    got = classify(rows, _seed_rules())

    assert [(r.day, r.classifier, r.assistant_code) for r in got] == [
        (DAY, "ga4_ai_assistant_channel", "claude.ai"),
        (DAY, "ga4_ai_assistant_channel", "grok.com"),
        (DAY, "own_rules", "chatgpt"),
        (DAY, "own_rules", "claude"),
        (DAY, "own_rules", "grok"),
        (later, "own_rules", "claude"),
    ]
    assert classify(list(reversed(rows)), _seed_rules()) == got


def test_zero_sessions_are_kept() -> None:
    got = _only(classify([_row(sessions=0, engaged=0, key_events="0")], _seed_rules()))

    assert got.sessions == 0


@pytest.mark.parametrize(
    ("sessions", "engaged", "key_events", "revenue", "field"),
    [
        (-1, 1, "0", "0", "sessions"),
        (1, -1, "0", "0", "engaged_sessions"),
        (1, 1, "-0.5", "0", "key_events"),
        (1, 1, "NaN", "0", "key_events"),
        (1, 1, "0", "NaN", "revenue"),
        (1, 1, "0", "Infinity", "revenue"),
    ],
)
def test_a_bad_number_raises_and_names_the_field(
    sessions: int, engaged: int, key_events: str, revenue: str, field: str
) -> None:
    row = _row(sessions=sessions, engaged=engaged, key_events=key_events, revenue=revenue)

    with pytest.raises(ValueError, match=field):
        classify([row], _seed_rules())


def test_a_bad_number_on_a_row_that_is_not_ai_still_raises() -> None:
    row = _row(source="google", channel_group="Organic Search", sessions=-3)

    with pytest.raises(ValueError, match="sessions"):
        classify([row], _seed_rules())


def test_a_refund_makes_revenue_negative_without_an_error() -> None:
    got = _only(classify([_row(revenue="-12.50")], _seed_rules()))

    assert got.total_revenue == Decimal("-12.50")


def test_mixed_rule_set_versions_raise() -> None:
    rules = [
        _rule("referrer_host", "exact", "claude.ai", "claude", version=1),
        _rule("referrer_host", "exact", "grok.com", "grok", version=2),
    ]

    with pytest.raises(ValueError, match="rule_set_version"):
        classify([_row()], rules)


def test_no_rows_gives_an_empty_list() -> None:
    assert classify([], _seed_rules()) == []
