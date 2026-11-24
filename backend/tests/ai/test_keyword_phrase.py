from __future__ import annotations

import pytest

from idraft.ai.keyword_phrase import MAX_WORDS, head_phrase

CASES = [
    (
        "Who are the best Managed SOC service providers in India?",
        "managed soc service providers india",
    ),
    (
        "Which companies offer 24/7 managed detection and response?",
        "companies 24 7 managed detection response",
    ),
    ("What is the best SIEM tool for small businesses?", "siem tool small businesses"),
    ("How does a security operations center work?", "security operations center work"),
    ("Top penetration testing companies in Dubai", "penetration testing companies dubai"),
    ("Can you recommend a vCISO service for startups?", "vciso service startups"),
    ("Best MDR providers in the United States", "mdr providers united states"),
    ("Should I outsource my SOC or build one in-house?", "outsource soc build one in-house"),
    ("Compare Splunk vs Sentinel for log management", "compare splunk vs sentinel log management"),
    (
        "What are the top cybersecurity consulting firms in Mumbai?",
        "cybersecurity consulting firms mumbai",
    ),
    ("Is Eventus Security a good SOC provider?", "eventus security soc provider"),
    ("incident response retainer pricing", "incident response retainer pricing"),
    ("How much does a SOC 2 audit cost in India?", "much soc 2 audit cost india"),
    ("Where can I find a managed firewall service near me?", "find managed firewall service near"),
    (
        "List the leading threat intelligence platforms",
        "list leading threat intelligence platforms",
    ),
    (
        "Which vulnerability management tools do enterprises use?",
        "vulnerability management tools enterprises use",
    ),
    ("Why is zero trust important for banks?", "zero trust important banks"),
    (
        "Best cloud security posture management vendors for AWS in 2026",
        "cloud security posture management vendors 2026",
    ),
    ("Who offers compliance as a service in Singapore?", "compliance service singapore"),
    ("  How to choose an MSSP?!  ", "choose mssp"),
]


@pytest.mark.parametrize(("text", "expected"), CASES)
def test_a_prompt_gives_its_head_phrase(text: str, expected: str) -> None:
    assert head_phrase(text) == expected


def test_a_phrase_has_at_most_the_word_limit_and_keeps_the_place() -> None:
    phrase = head_phrase(
        "Which managed detection response security operations center vendors in Pune?"
    )
    assert phrase is not None
    assert len(phrase.split()) == MAX_WORDS
    assert phrase.endswith("pune")


@pytest.mark.parametrize("text", ["", "   ", "Who is the best?", "?!"])
def test_a_text_with_no_informative_word_has_no_phrase(text: str) -> None:
    assert head_phrase(text) is None
