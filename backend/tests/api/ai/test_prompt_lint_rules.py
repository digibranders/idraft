"""The five lint rules of a prompt text (`prompt_lint`): pure, so a table of texts says what each
rule does. Every non-ASCII text is written with `\\U` escapes, so the file stays ASCII."""

from __future__ import annotations

import re
from collections.abc import Sequence

import pytest
from _pytest.mark.structures import ParameterSet

from idraft.api.ai.prompt_lint import Named, check, count_words, is_comparison

# U+1F4C8: one character, two UTF-16 code units.
CHART = "\U0001f4c8"
# 23 characters of Hiragana, Katakana and Han: a question with no spaces.
JA_QUESTION = (
    "\U000030d5\U000030ea\U000030fc\U000030e9\U000030f3\U000030b9\U0000306e\U0000305f"
    "\U00003081\U0000306e\U00006700\U00009069\U0000306a\U00004f1a\U00008a08\U000030bd"
    "\U000030d5\U000030c8\U0000306f\U00004f55\U00003067\U00003059\U0000304b"
)
# Two questions, each ending in U+FF1F.
JA_TWO_QUESTIONS = (
    "\U00004eca\U000065e5\U0000306f\U00006674\U0000308c\U0000ff1f"
    "\U0000660e\U000065e5\U0000306f\U000096e8\U0000ff1f"
)
# Two clauses, each ending in U+061F.
AR_TWO_QUESTIONS = (
    "\U00000647\U00000644 \U00000647\U00000630\U00000627 \U0000062c\U0000064a\U0000062f\U0000061f "
    "\U00000647\U00000644 \U00000647\U00000630\U00000627 \U00000631\U0000062e\U0000064a\U00000635"
    "\U0000061f"
)
# Six Cyrillic words.
RU_QUESTION = (
    "\U0000041a\U00000430\U0000043a\U00000430\U0000044f "
    "\U00000441\U00000438\U00000441\U00000442\U00000435\U0000043c\U00000430 "
    "\U00000443\U00000447\U00000435\U00000442\U00000430 "
    "\U0000043b\U00000443\U00000447\U00000448\U00000435 "
    "\U00000434\U0000043b\U0000044f "
    "\U00000431\U00000438\U00000437\U0000043d\U00000435\U00000441\U00000430"
)
# Cyrillic words of four letters.
CYR_A = "\U00000430\U00000431\U00000432\U00000433"
CYR_B = "\U00000434\U00000435\U00000436\U00000437"
CYR_C = "\U00000438\U0000043a\U0000043b\U0000043c"
SIXTY = " ".join(f"w{number}" for number in range(60))
SIXTY_ONE = f"{SIXTY} w60"


def _named(text: str, own: Sequence[str] = (), competitors: Sequence[str] = ()) -> list[Named]:
    """Each name found in the text, as the matcher would report it (code point offsets)."""
    found: list[Named] = []
    for names, is_competitor in ((own, False), (competitors, True)):
        for name in names:
            spans = tuple(
                (match.start(), match.end()) for match in re.finditer(re.escape(name), text)
            )
            assert spans, f"{name!r} is not in {text!r}"
            found.append(Named(name=name, is_competitor=is_competitor, spans=spans))
    return found


def _rules(
    text: str,
    language_code: str | None = "en",
    own: Sequence[str] = (),
    competitors: Sequence[str] = (),
) -> list[str]:
    return [item.rule for item in check(text, _named(text, own, competitors), language_code)]


def _case(
    name: str,
    text: str,
    expected: list[str],
    language_code: str | None = "en",
    own: Sequence[str] = (),
    competitors: Sequence[str] = (),
) -> ParameterSet:
    return pytest.param(text, language_code, own, competitors, expected, id=name)


POSITIVE = [
    _case("three_words", "best crm", ["word_count"]),
    _case("two_questions", "What is X? And what is Y?", ["multiple_questions"]),
    _case(
        "superlative_beside_own_alias",
        "Why is Acme the best CRM for agencies?",
        ["leading_wording"],
        own=["Acme"],
    ),
    _case(
        "superlative_beside_competitor",
        "Is HubSpot the best CRM for startups?",
        ["contains_competitor_alias", "leading_wording"],
        competitors=["HubSpot"],
    ),
    _case(
        "comparison_names_competitor",
        "HubSpot vs Acme for a small agency",
        ["contains_competitor_alias"],
        own=["Acme"],
        competitors=["HubSpot"],
    ),
    _case(
        "french_text_set_to_english",
        "Quelle est la meilleure solution de facturation ?",
        ["language_mismatch"],
    ),
    _case("sixty_one_words", SIXTY_ONE, ["word_count"]),
    _case(
        "why_is_x_the_best_without_an_alias",
        "Why is Notion the best tool for notes",
        ["leading_wording"],
    ),
]

NEGATIVE = [
    _case("best_but_no_alias", "What is the best CRM for startups?", []),
    _case("one_run_of_question_marks", "Really?? Is it worth it", []),
    _case(
        "alias_five_words_from_top",
        "Acme pricing compared with the top tools on the market today",
        [],
        own=["Acme"],
    ),
    _case("german_set_to_german", "Welche CRM Software passt zu einer kleinen Agentur?", [], "de"),
    _case("five_words", "which crm suits small agencies", []),
    _case("sixty_words", SIXTY, []),
    _case(
        "german_has_no_superlative_list",
        "Warum ist Acme das beste CRM?",
        [],
        "de",
        own=["Acme"],
    ),
    _case("no_language_no_mismatch", "Quelle est la meilleure solution de facturation ?", [], None),
    _case("unknown_language_skips_the_script_table", RU_QUESTION, [], "xx"),
    _case("best_inside_a_word", "Is Acme a bestseller in agencies", [], own=["Acme"]),
    _case(
        "alias_that_holds_the_superlative", "Is Top Tools good for agencies", [], own=["Top Tools"]
    ),
]

NON_LATIN = [
    _case("japanese_question_in_japanese", JA_QUESTION, [], "ja"),
    _case("japanese_question_set_to_english", JA_QUESTION, ["language_mismatch"], "en"),
    _case("two_japanese_questions", JA_TWO_QUESTIONS, ["multiple_questions"], "ja"),
    _case("two_arabic_questions", AR_TWO_QUESTIONS, ["multiple_questions"], "ar"),
    _case("russian_question_in_russian", RU_QUESTION, [], "ru"),
    _case("russian_question_set_to_english", RU_QUESTION, ["language_mismatch"], "en"),
    _case(
        "english_set_to_russian", "Which CRM suits a small agency best", ["language_mismatch"], "ru"
    ),
]

BOUNDARIES = [
    # word_count: 5 to 60.
    _case("four_words", "which crm suits agencies", ["word_count"]),
    _case("five_words_is_enough", "which crm suits small agencies", []),
    _case("sixty_words_is_enough", SIXTY, []),
    _case("sixty_one_words_is_too_many", SIXTY_ONE, ["word_count"]),
    # leading_wording: the superlative within 3 words of the alias.
    _case(
        "three_words_apart", "Acme is the best CRM for us today", ["leading_wording"], own=["Acme"]
    ),
    _case("four_words_apart", "Acme is really the best CRM for us today", [], own=["Acme"]),
    _case(
        "before_the_alias", "The best tool is Acme for us today", ["leading_wording"], own=["Acme"]
    ),
    _case("number_one", "Is Acme the number one CRM today", ["leading_wording"], own=["Acme"]),
    _case("hash_one", "Acme is the #1 CRM for us", ["leading_wording"], own=["Acme"]),
    _case("shouted", "IS ACME THE LEADING CRM TODAY", ["leading_wording"], own=["ACME"]),
    # language_mismatch: at least 4 words.
    _case("three_cyrillic_words", " ".join([CYR_A, CYR_B, CYR_C]), ["word_count"]),
    _case(
        "four_cyrillic_words",
        " ".join([CYR_A, CYR_B, CYR_C, CYR_A]),
        ["word_count", "language_mismatch"],
    ),
    # language_mismatch: 60 percent of the letters.
    _case("half_of_the_letters_foreign", f"abcd efgh ijkm {CYR_A} {CYR_B} {CYR_C}", []),
    _case(
        "six_tenths_of_the_letters_foreign",
        f"abcd efgh {CYR_A} {CYR_B} {CYR_C}",
        ["language_mismatch"],
    ),
    _case(
        "two_thirds_of_the_letters_foreign",
        f"abcd efgh {CYR_A} {CYR_B} {CYR_C} {CYR_A}",
        ["language_mismatch"],
    ),
    # language_mismatch: function words of another language, at least 2 and 2 more than ours.
    _case("one_french_word", "le xyzzy plugh quux corge", []),
    _case("two_french_words", "le est xyzzy plugh quux", ["language_mismatch"]),
    _case("french_three_to_english_two", "the is le est pas xyzzy", []),
    _case("french_four_to_english_two", "the is le est pas pour xyzzy", ["language_mismatch"]),
    _case("french_set_to_german", "le est pas pour xyzzy", ["language_mismatch"], "de"),
    _case("french_set_to_a_language_not_listed", "le est pas pour xyzzy", [], "sv"),
]


@pytest.mark.parametrize(
    ("text", "language_code", "own", "competitors", "expected"),
    [*POSITIVE, *NEGATIVE, *NON_LATIN, *BOUNDARIES],
)
def test_a_text_gets_the_rules_it_breaks(
    text: str,
    language_code: str | None,
    own: Sequence[str],
    competitors: Sequence[str],
    expected: list[str],
) -> None:
    findings = check(text, _named(text, own, competitors), language_code)

    assert [item.rule for item in findings] == expected
    assert all(item.message.isascii() and item.message.endswith(".") for item in findings)


def test_the_rules_come_in_the_order_of_the_contract() -> None:
    text = "est top HubSpot? la?"

    assert _rules(text, "en", competitors=["HubSpot"]) == [
        "contains_competitor_alias",
        "leading_wording",
        "multiple_questions",
        "word_count",
        "language_mismatch",
    ]


def test_a_competitor_beside_a_superlative_is_found_where_it_stands() -> None:
    text = "Is HubSpot the best CRM for startups?"

    competitor, leading = check(text, _named(text, competitors=["HubSpot"]), "en")

    assert (competitor.severity, competitor.span) == ("warning", (3, 10))
    assert (leading.severity, leading.span) == ("warning", (15, 19))
    assert "HubSpot" in competitor.message


def test_a_competitor_in_a_comparison_is_a_note() -> None:
    text = "HubSpot vs Acme for a small agency"

    (competitor,) = check(text, _named(text, own=["Acme"], competitors=["HubSpot"]), "en")

    assert (competitor.severity, competitor.span) == ("info", (0, 7))
    assert competitor.message == "Compares with HubSpot."


def test_each_competitor_is_named_once_at_its_first_place() -> None:
    text = "Is Asana or Trello or Asana better for small agencies"

    first, second = check(text, _named(text, competitors=["Asana", "Trello"]), "en")

    assert (first.span, second.span) == ((3, 8), (12, 18))


def test_spans_count_utf16_code_units() -> None:
    text = f"{CHART} Is HubSpot good for agencies?"

    (competitor,) = check(text, _named(text, competitors=["HubSpot"]), "en")

    assert competitor.span == (6, 13)


def test_a_superlative_after_an_emoji_is_placed_in_utf16_units() -> None:
    text = f"{CHART} Is Acme the best CRM"

    (leading,) = check(text, _named(text, own=["Acme"]), "en")

    assert leading.span == (15, 19)


@pytest.mark.parametrize(
    ("text", "comparison"),
    [
        ("HubSpot vs Acme", True),
        ("HubSpot vs. Acme", True),
        ("HubSpot VS Acme", True),
        ("HubSpot versus Acme", True),
        ("Does HubSpot canvas work", False),
        ("Is HubSpot good for versions", False),
        ("What is the best CRM", False),
    ],
)
def test_a_comparison_is_a_word_bounded_vs_or_versus(text: str, comparison: bool) -> None:
    assert is_comparison(text) is comparison


@pytest.mark.parametrize(
    ("text", "words"),
    [
        ("", 0),
        ("   ", 0),
        ("one two  three", 3),
        ("a\tb\nc", 3),
        (JA_QUESTION, 12),
        (JA_TWO_QUESTIONS, 6),
        ("CRM\U00003092 use", 3),
        (
            "\U00000e2a\U00000e27\U00000e31\U00000e2a\U00000e14\U00000e35\U00000e04\U00000e23"
            "\U00000e31\U00000e1a",
            5,
        ),
        (RU_QUESTION, 6),
    ],
)
def test_words_are_counted_by_white_space_and_by_half_the_characters_in_unspaced_scripts(
    text: str, words: int
) -> None:
    assert count_words(text) == words


def test_the_message_of_a_mismatch_names_both_languages() -> None:
    text = "Quelle est la meilleure solution de facturation ?"

    (mismatch,) = check(text, [], "en")

    assert mismatch.message == "Reads as French, and the prompt is set to English."
    assert mismatch.span is None


def test_the_message_of_a_script_mismatch_names_the_script() -> None:
    (mismatch,) = check(RU_QUESTION, [], "en")

    assert mismatch.message == "Reads as Cyrillic, and the prompt is set to English."
