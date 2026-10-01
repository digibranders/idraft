"""Keyword text: normalization for identity, and what is refused (docs/08 sections 1 and 3.3)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.keywords.text import KEYWORD_MAX, KeywordRefusedError, check_keyword, normalize


@pytest.mark.parametrize(
    ("entered", "normalized"),
    [
        ("CRM Software", "crm software"),
        ("  crm \t software  ", "crm software"),
        ("\N{FULLWIDTH LATIN CAPITAL LETTER C}RM", "crm"),
        ("crm\N{NO-BREAK SPACE}software", "crm software"),
        # Lower case, not case folding: a German "Straße" and "Strasse" are two searches.
        ("Stra\N{LATIN SMALL LETTER SHARP S}e", "stra\N{LATIN SMALL LETTER SHARP S}e"),
        ("Cafe\N{COMBINING ACUTE ACCENT}", "caf\N{LATIN SMALL LETTER E WITH ACUTE}"),
    ],
)
def test_normalization_is_nfkc_lower_case_with_collapsed_whitespace(
    entered: str, normalized: str
) -> None:
    assert normalize(entered) == normalized


@given(st.text(min_size=1, max_size=60))
def test_normalizing_twice_changes_nothing(entered: str) -> None:
    once = normalize(entered)
    assert normalize(once) == once


def test_a_format_character_between_a_letter_and_its_accent_still_composes() -> None:
    """The case the second NFKC step is for: once the zero-width space is gone, the accent
    joins the letter."""
    entered = "e\N{ZERO WIDTH SPACE}\N{COMBINING ACUTE ACCENT}"
    assert normalize(entered) == "\N{LATIN SMALL LETTER E WITH ACUTE}"
    assert normalize(normalize(entered)) == normalize(entered)


@pytest.mark.parametrize(
    "entered",
    [
        "site:example.com crm",
        "crm intitle:pricing",
        "INURL:blog crm",
        "allintitle: crm software",
        "crm filetype:pdf",
        "define:crm",
        "crm before:2024",
        "crm after:2020-01-01",
        "crm -free",
        "c# -sharp",
        '"crm software" pricing',
        "\N{LEFT DOUBLE QUOTATION MARK}crm software\N{RIGHT DOUBLE QUOTATION MARK}",
        # Full-width look-alikes are the same operators once normalized.
        "\N{FULLWIDTH LATIN SMALL LETTER S}\N{FULLWIDTH LATIN SMALL LETTER I}"
        "\N{FULLWIDTH LATIN SMALL LETTER T}\N{FULLWIDTH LATIN SMALL LETTER E}:example.com",
        "site\N{FULLWIDTH COLON}example.com",
        "\N{FULLWIDTH QUOTATION MARK}crm software\N{FULLWIDTH QUOTATION MARK}",
    ],
)
def test_search_operators_are_refused(entered: str) -> None:
    with pytest.raises(KeywordRefusedError) as raised:
        check_keyword(entered)
    assert raised.value.code == "search_operator_not_allowed"


@pytest.mark.parametrize(
    "entered",
    [
        "crm for small-business",
        "c++ ide",
        "what is site reliability",
        "time: 10:30",
        "k-pop news",
        "dad's crm",
        "re:invent",
        "node.js",
        "-40 fahrenheit to celsius",
        "-webkit-appearance",
        '24" monitor',
        "contact info: phone number",
        "browser cache: clear",
        "link: building tips",
        "related: posts plugin",
    ],
)
def test_ordinary_keywords_pass(entered: str) -> None:
    assert check_keyword(entered) == entered.strip()


def test_a_keyword_is_cleaned_trimmed_and_at_most_700_characters() -> None:
    assert check_keyword("  crm  ") == "crm"
    # Casing kept; invisible characters and runs of whitespace are not part of a search.
    assert (
        check_keyword("\N{ZERO WIDTH NO-BREAK SPACE}CRM\t\n  Software\N{ZERO WIDTH SPACE}")
        == "CRM Software"
    )
    assert check_keyword("x" * KEYWORD_MAX) == "x" * KEYWORD_MAX
    # Counted on what is stored, after cleaning.
    assert check_keyword("x" * KEYWORD_MAX + "\N{ZERO WIDTH SPACE}") == "x" * KEYWORD_MAX
    with pytest.raises(KeywordRefusedError) as too_long:
        check_keyword("x" * (KEYWORD_MAX + 1))
    assert too_long.value.code == "keyword_too_long"
    for empty in ("", "   ", "\N{ZERO WIDTH SPACE}"):
        with pytest.raises(KeywordRefusedError) as missing:
            check_keyword(empty)
        assert missing.value.code == "keyword_missing"


@pytest.mark.parametrize("entered", ["crm\N{NULL}x", "crm\N{ESCAPE}x", "crm" + chr(0xD800)])
def test_control_characters_and_lone_surrogates_are_refused(entered: str) -> None:
    with pytest.raises(KeywordRefusedError) as raised:
        check_keyword(entered)
    assert raised.value.code == "keyword_invalid"
