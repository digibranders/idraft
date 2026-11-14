"""The prompt type rule (contract C1 change log, the owner's rule in docs/19 decided 2026-11-12;
rows BE-PROMPTS-10, PD-N02): pure, no database. Non-Latin text is written as escapes so the file
stays ASCII."""

from __future__ import annotations

import pytest

from idraft.api.ai.prompt_lint import suggest_prompt_type


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("HubSpot vs Pipedrive", "comparison"),
        ("Asana versus Trello?", "comparison"),
        ("HubSpot vs. Pipedrive for a startup", "comparison"),
        ("HUBSPOT VS PIPEDRIVE", "comparison"),
        ("How to migrate a CRM", "how_to"),
        ("Can you tell me how to migrate a CRM", "how_to"),
        ("What is a CRM?", "question"),
        ("Is Acme good for agencies", "question"),
        ("Should we buy a CRM", "question"),
        ("Kann ich Acme testen?", "question"),
        ("Quelle CRM choisir ?", "question"),
        ("best crm", "other"),
        ("Vsauce channels", "other"),
        ("Compare CRM prices", "other"),
        ("Dockerized CRM tools", "other"),
        # First match wins: a comparison before how to before a question.
        ("How to choose HubSpot vs Pipedrive?", "comparison"),
        ("How to pick a CRM?", "how_to"),
        # A leading interrogative needs its own word.
        ("Whatever CRM works", "other"),
        ("Isolated CRM tools", "other"),
        # The question mark may be fullwidth or Arabic, and spaces after it do not matter.
        ("\U000030b3\U000030ce CRM \U0000306f\U0000826f\U00003044\U0000ff1f", "question"),
        ("\U00000647\U00000644 CRM \U0000062c\U0000064a\U00000062\U0000061f", "question"),
        ("best crm?  ", "question"),
        ("\U000030b3\U000030ce CRM \U0000306f\U0000826f\U00003044", "other"),
    ],
)
def test_the_type_rule_reads_the_wording(text: str, expected: str) -> None:
    assert suggest_prompt_type(text) == expected
