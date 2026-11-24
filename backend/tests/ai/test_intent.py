"""`classify_prompt_intent`: the intent and funnel stage a prompt's wording gives."""

import pytest

from idraft.ai.intent import FUNNEL_OF, FunnelStage, Intent, classify_prompt_intent

CASES: list[tuple[str, Intent]] = [
    # The Eventus prompts that had no intent.
    ("Who are the best Managed SOC service providers in India", "commercial"),
    ("Which companies provide 24/7 Managed SOC services", "commercial"),
    ("Compare the top 10 Managed SOC providers in India", "commercial"),
    ("How much does Managed SOC outsourcing cost in India", "transactional"),
    ("Which Managed SOC vendors offer proof of concept", "commercial"),
    ("What is SOC as a service", "informational"),
    # Commercial.
    ("Acme vs Globex for endpoint protection", "commercial"),
    ("Alternatives to CrowdStrike", "commercial"),
    ("Is Splunk better than Elastic for logs", "commercial"),
    ("Recommend a managed detection and response vendor", "commercial"),
    ("Okta reviews from security teams", "commercial"),
    ("Top-rated SIEM tools for small banks", "commercial"),
    ("Which is the best SIEM", "commercial"),
    # Transactional.
    ("Buy a threat intelligence feed", "transactional"),
    ("Hire a penetration tester", "transactional"),
    ("Book a demo of a managed SOC", "transactional"),
    ("Managed SOC pricing", "transactional"),
    ("Get a quote for a vulnerability scan", "transactional"),
    ("Is there a free trial for an EDR product", "transactional"),
    ("Cheapest SOC outsourcing", "transactional"),
    # Informational.
    ("How does a SOC detect ransomware", "informational"),
    ("How to set up log forwarding", "informational"),
    ("Why do companies outsource a SOC", "informational"),
    ("Explain the difference between SIEM and SOAR", "informational"),
    ("Difference between MDR and EDR", "informational"),
    ("What are SOC best practices", "informational"),
    ("How does SOC pricing work", "informational"),
    ("Managed SOC benefits for banks", "informational"),
    # Local.
    ("Cybersecurity consultants near me", "local"),
    ("Nearby penetration testing firms", "local"),
    ("Local IT security companies in Pune", "local"),
    ("What is local SEO", "informational"),
    # Navigational.
    ("Eventus login", "navigational"),
    ("Okta official site", "navigational"),
    ("Sign in to Splunk Cloud", "navigational"),
    ("eventussecurity.com", "navigational"),
    # Local beats commercial; a place name alone is not a local marker.
    ("Best SOC provider near me", "local"),
    ("Managed SOC provider in Mumbai", "informational"),
]


@pytest.mark.parametrize(("text", "intent"), CASES)
def test_the_wording_gives_the_intent_and_its_funnel_stage(text: str, intent: Intent) -> None:
    assert classify_prompt_intent(text) == (intent, FUNNEL_OF[intent])


@pytest.mark.parametrize(
    ("intent", "stage"),
    [
        ("informational", "tofu"),
        ("commercial", "mofu"),
        ("local", "mofu"),
        ("transactional", "bofu"),
        ("navigational", "bofu"),
    ],
)
def test_the_funnel_stage_follows_the_intent(intent: Intent, stage: FunnelStage) -> None:
    assert FUNNEL_OF[intent] == stage


@pytest.mark.parametrize("text", ["", "   ", "\n\t"])
def test_empty_text_has_no_intent(text: str) -> None:
    assert classify_prompt_intent(text) == ("unknown", "unknown")


def test_case_and_spacing_do_not_matter() -> None:
    assert classify_prompt_intent("  COMPARE   the TOP providers ") == ("commercial", "mofu")
