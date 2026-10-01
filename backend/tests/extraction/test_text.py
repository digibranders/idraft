"""Text normalization for alias matching, with a map back to the original
(docs/13-ai-extraction-engine.md stage 4)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.extraction.text import normalize, normalize_pattern

SHARP_S = "\N{LATIN SMALL LETTER SHARP S}"
APOSTROPHE = "\N{RIGHT SINGLE QUOTATION MARK}"


@pytest.mark.parametrize(
    ("text", "folded"),
    [
        ("HubSpot", "hubspot"),
        ("Caf\N{LATIN SMALL LETTER E WITH ACUTE}", "cafe"),
        ("Cafe\N{COMBINING ACUTE ACCENT}", "cafe"),
        ("\N{FULLWIDTH LATIN CAPITAL LETTER H}\N{FULLWIDTH LATIN SMALL LETTER U}b", "hub"),
        ("\N{LATIN SMALL LIGATURE FI}nance", "finance"),
        (f"Stra{SHARP_S}e", "strasse"),
        # Folds without leaving a combining dot.
        ("\N{LATIN CAPITAL LETTER I WITH DOT ABOVE}stanbul", "istanbul"),
        (f"Acme{APOSTROPHE}s", "acme's"),
        ("\N{LEFT DOUBLE QUOTATION MARK}Acme\N{RIGHT DOUBLE QUOTATION MARK}", '"acme"'),
        ("Acme\N{EM DASH}CRM\N{EN DASH}x", "acme-crm-x"),
        ("Ac\N{ZERO WIDTH SPACE}me\N{SOFT HYPHEN}", "acme"),
        ("Acme \t\n  CRM", "acme crm"),
        ("Acme\N{NO-BREAK SPACE}CRM", "acme crm"),
        # A spacing diacritic decomposes to a space, which joins the run before it.
        ("Acme \N{DIAERESIS}CRM", "acme crm"),
        # Symbols and footnote digits separate words instead of decomposing into letters.
        ("Acme\N{TRADE MARK SIGN}CRM", "acme crm"),
        ("Acme\N{SUPERSCRIPT ONE}", "acme "),
        # Direction marks are format characters, dropped like zero-width ones.
        ("Ac\N{LEFT-TO-RIGHT MARK}me\N{RIGHT-TO-LEFT EMBEDDING}", "acme"),
        ("a\ud800b", "a\N{REPLACEMENT CHARACTER}b"),
        # Marks that are not Latin, Greek or Cyrillic accents stay.
        (
            "\N{KATAKANA LETTER GA}",
            "\N{KATAKANA LETTER KA}\N{COMBINING KATAKANA-HIRAGANA VOICED SOUND MARK}",
        ),
        (
            "\N{DEVANAGARI LETTER KA}\N{DEVANAGARI SIGN VIRAMA}",
            "\N{DEVANAGARI LETTER KA}\N{DEVANAGARI SIGN VIRAMA}",
        ),
    ],
)
def test_each_rule_of_stage_4(text: str, folded: str) -> None:
    assert normalize(text, fold_case=True).text == folded


def test_case_is_kept_when_not_folding() -> None:
    text = (
        "Caf\N{LATIN SMALL LETTER E WITH ACUTE} "
        "\N{LEFT DOUBLE QUOTATION MARK}HubSpot\N{RIGHT DOUBLE QUOTATION MARK}"
    )
    assert normalize(text, fold_case=False).text == 'Cafe "HubSpot"'


def test_a_span_maps_back_to_the_original_characters() -> None:
    original = f"Try  Stra{SHARP_S}e{APOSTROPHE}s CRM"
    normalized = normalize(original, fold_case=True)
    assert normalized.text == "try strasse's crm"
    start = normalized.text.index("strasse")
    assert normalized.original_span(start, start + len("strasse")) == (5, 11)
    assert original[5:11] == f"Stra{SHARP_S}e"
    # Half of the two letters that one character folded into still maps to the whole of it.
    assert normalized.original_span(start + 5, start + 6) == (9, 10)


def test_collapsed_whitespace_spans_the_whole_run() -> None:
    original = "Acme \t\N{ZERO WIDTH SPACE}\n CRM"
    normalized = normalize(original, fold_case=True)
    assert normalized.text == "acme crm"
    assert normalized.original_span(4, 5) == (4, 9)
    assert normalized.original_span(0, len(normalized.text)) == (0, len(original))


def test_a_pattern_is_normalized_where_it_is_not_ascii() -> None:
    pattern = f"Nestl\N{LATIN SMALL LETTER E WITH ACUTE}[ ]?{APOSTROPHE}s\\b"
    assert normalize_pattern(pattern) == "Nestle[ ]?'s\\b"


def test_empty_text_normalizes_to_empty() -> None:
    normalized = normalize("", fold_case=True)
    assert normalized.text == ""


def test_an_empty_span_is_refused() -> None:
    with pytest.raises(ValueError, match="span"):
        normalize("acme", fold_case=True).original_span(2, 2)


@given(st.text(max_size=60), st.booleans(), st.data())
def test_every_span_slices_the_original_to_text_that_normalizes_to_it(
    text: str, fold_case: bool, data: st.DataObject
) -> None:
    normalized = normalize(text, fold_case=fold_case)
    if not normalized.text.strip():
        return
    start = data.draw(st.integers(0, len(normalized.text) - 1))
    end = data.draw(st.integers(start + 1, len(normalized.text)))
    piece = normalized.text[start:end]
    original_start, original_end = normalized.original_span(start, end)
    # A span cut inside a folded character maps to the whole character, which normalizes to
    # at least the piece; whole tokens map exactly.
    assert piece.strip() in normalize(text[original_start:original_end], fold_case=fold_case).text


@given(st.text(max_size=60), st.booleans())
def test_each_character_comes_from_its_own_slice_and_the_maps_never_go_back(
    text: str, fold_case: bool
) -> None:
    normalized = normalize(text, fold_case=fold_case)
    starts, ends = normalized.starts, normalized.ends
    assert list(starts) == sorted(starts)
    assert list(ends) == sorted(ends)
    for index, char in enumerate(normalized.text):
        assert char in normalize(text[starts[index] : ends[index]], fold_case=fold_case).text
