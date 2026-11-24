from __future__ import annotations

import pytest

from idraft.ai.keyword_phrase import (
    KeywordPick,
    MeasuredKeyword,
    best_measured_keyword,
    core_phrase,
    pick_keyword,
)

KEYWORDS = [
    MeasuredKeyword(text, volume)
    for text, volume in [
        ("soc", 27100),
        ("soc services", 8100),
        ("soc india", 4400),
        ("security operations center", 2900),
        ("managed security service provider", 1900),
        ("managed soc services", 210),
        ("soc as a service", 210),
        ("siem", 12100),
        ("mdr", 5400),
        ("penetration testing", 9900),
        ("vciso", 320),
    ]
]

# (prompt, (keyword, an existing measured one?)); None when nothing usable is left.
PICKS: list[tuple[str, tuple[str, bool] | None]] = [
    (
        "Who are the best Managed SOC service providers in India?",
        ("managed security service provider", True),
    ),
    (
        "Top managed soc service providers in India",
        ("managed security service provider", True),
    ),
    (
        "Which companies provide 24/7 managed SOC services in India?",
        ("managed soc services", True),
    ),
    ("What is the best SIEM tool for small businesses?", ("siem", True)),
    ("How does a security operations center work?", ("security operations center", True)),
    ("Top penetration testing companies in Dubai", ("penetration testing", True)),
    ("Can you recommend a vCISO service for startups?", ("vciso", True)),
    ("Best MDR providers in the United States", ("mdr", True)),
    ("Should I outsource my SOC or build one in-house?", ("soc", True)),
    ("Compare Splunk vs Sentinel for log management", ("splunk sentinel log", False)),
    (
        "What are the top cybersecurity consulting firms in Mumbai?",
        ("cybersecurity consulting mumbai", False),
    ),
    ("incident response retainer pricing", ("incident response retainer", False)),
    ("How much does a SOC 2 audit cost in India?", ("soc india", True)),
    (
        "Where can I find a managed firewall service near me?",
        ("managed security service provider", True),
    ),
    (
        "Which managed security service provider is best for banks in India?",
        ("managed security service provider", True),
    ),
    ("What is SOC as a service and who offers it?", ("soc services", True)),
    ("Best SOC india vendors", ("soc india", True)),
    (
        "Who offers managed detection and response in India?",
        ("managed detection india", False),
    ),
    (
        "Which cloud security posture management tools do you recommend?",
        ("cloud security posture", False),
    ),
    ("Best MSSP for financial services", ("mssp financial services", False)),
    ("Who are the leading providers of 24/7 SOC monitoring?", ("soc", True)),
    (
        "What companies provide security operations center services in Pune?",
        ("security operations center", True),
    ),
    ("How to choose a managed SOC partner?", ("managed soc services", True)),
    ("Top SIEM and SOAR providers in India", ("siem", True)),
    (
        "Which compliance automation platforms support ISO 27001?",
        ("compliance automation platforms", False),
    ),
    (
        "Best vulnerability management service",
        ("vulnerability management service", False),
    ),
    ("Is a SOC worth it for a mid-size company?", ("soc", True)),
    ("Which MDR service is best for small companies in Bangalore?", ("mdr", True)),
    ("Who is the best?", None),
    ("24 7 managed", None),
]


@pytest.mark.parametrize(("prompt", "expected"), PICKS)
def test_pick_keyword_for_an_eventus_prompt(prompt: str, expected: tuple[str, bool] | None) -> None:
    pick = pick_keyword(prompt, KEYWORDS)

    assert (None if pick is None else tuple(pick)) == expected


def test_a_pick_is_a_named_tuple_with_its_flag() -> None:
    assert pick_keyword("Best SIEM tools", KEYWORDS) == KeywordPick("siem", True)


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("Who are the best Managed SOC service providers in India?", "managed soc india"),
        ("Which companies provide 24/7 managed SOC services in India?", "managed soc india"),
        ("Top SIEM and SOAR providers in India", "siem soar india"),
        ("Best vulnerability management service", "vulnerability management service"),
        ("Compare Splunk vs Sentinel for log management", "splunk sentinel log"),
        ("How much does a SOC 2 audit cost in India?", "soc audit india"),
        ("Who is the best?", None),
        ("SOC", None),
    ],
)
def test_core_phrase_is_two_or_three_words(prompt: str, expected: str | None) -> None:
    phrase = core_phrase(prompt)

    assert phrase == expected
    assert phrase is None or 2 <= len(phrase.split()) <= 3


def test_one_shared_word_is_not_enough_unless_the_keyword_is_that_word() -> None:
    candidates = [MeasuredKeyword("managed firewall", 900), MeasuredKeyword("soc", 100)]

    assert best_measured_keyword("Best managed detection providers", candidates) is None
    assert best_measured_keyword("What is a SOC?", candidates) == "soc"


def test_a_single_word_keyword_must_be_a_whole_word_of_the_prompt() -> None:
    assert best_measured_keyword("Best socket makers", [MeasuredKeyword("soc", 500)]) is None


def test_more_shared_words_beat_a_higher_volume() -> None:
    candidates = [MeasuredKeyword("soc", 27100), MeasuredKeyword("soc india", 4400)]

    assert best_measured_keyword("Best SOC providers in India", candidates) == "soc india"


def test_ties_go_to_the_higher_volume_then_the_shorter_keyword() -> None:
    prompt = "Managed SOC services for banks"

    higher = [MeasuredKeyword("soc services", 100), MeasuredKeyword("managed soc", 900)]
    assert best_measured_keyword(prompt, higher) == "managed soc"
    same = [MeasuredKeyword("soc services", 100), MeasuredKeyword("managed soc", 100)]
    assert best_measured_keyword(prompt, same) == "managed soc"
    equal_words = [MeasuredKeyword("managed socs", 100), MeasuredKeyword("soc managed", 100)]
    assert best_measured_keyword(prompt, equal_words) == "soc managed"


def test_plurals_match() -> None:
    assert best_measured_keyword("SOC service providers", [MeasuredKeyword("soc services", 1)])


def test_no_candidates_falls_back_to_the_core_phrase() -> None:
    assert pick_keyword("Best SOC providers in India", []) == KeywordPick(
        "soc providers india", False
    )
