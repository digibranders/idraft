"""Alias matching and the disambiguation score (docs/13-ai-extraction-engine.md stages 4 and 5,
plan decision D6)."""

from __future__ import annotations

import time
import uuid

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.extraction.aliases import (
    MAX_HITS,
    AliasMatcher,
    AliasRule,
    EntityMention,
    EntityRule,
    InvalidAliasPatternError,
    MatchMode,
    MatchResult,
    TooManyMatchesError,
    check_pattern,
)
from sightline.extraction.text import normalize

ACME = uuid.UUID(int=1)
HUBSPOT = uuid.UUID(int=2)
CLOUD = uuid.UUID(int=3)
APPLE = uuid.UUID(int=4)
MONDAY = uuid.UUID(int=5)

E_ACUTE = "\N{LATIN SMALL LETTER E WITH ACUTE}"
U_UMLAUT = "\N{LATIN SMALL LETTER U WITH DIAERESIS}"
SHARP_S = "\N{LATIN SMALL LETTER SHARP S}"
APOSTROPHE = "\N{RIGHT SINGLE QUOTATION MARK}"


def _alias(
    entity_id: uuid.UUID,
    alias: str,
    mode: MatchMode = "word_boundary",
    *,
    case_sensitive: bool = False,
    negative: bool = False,
    requires_context: bool = False,
) -> AliasRule:
    return AliasRule(
        id=uuid.uuid4(),
        entity_id=entity_id,
        alias=alias,
        match_mode=mode,
        case_sensitive=case_sensitive,
        is_negative=negative,
        requires_context=requires_context,
    )


def _entity(
    entity_id: uuid.UUID,
    name: str,
    *,
    parent_entity_id: uuid.UUID | None = None,
    is_ambiguous: bool = False,
    hints: tuple[str, ...] = (),
    domains: tuple[str, ...] = (),
) -> EntityRule:
    return EntityRule(
        id=entity_id,
        canonical_name=name,
        parent_entity_id=parent_entity_id,
        is_ambiguous=is_ambiguous,
        hints=hints,
        domains=domains,
    )


def _texts(result: MatchResult, text: str, entity_id: uuid.UUID) -> list[str]:
    mention = _mention(result, entity_id)
    return [] if mention is None else [text[span.start : span.end] for span in mention.spans]


def _mention(result: MatchResult, entity_id: uuid.UUID) -> EntityMention | None:
    return next((m for m in result.mentions if m.entity_id == entity_id), None)


def _confidence(result: MatchResult, entity_id: uuid.UUID) -> float:
    mention = _mention(result, entity_id)
    assert mention is not None
    return mention.confidence


def _match(text: str, entities: list[EntityRule], aliases: list[AliasRule]) -> MatchResult:
    return AliasMatcher(entities, aliases).match(text)


def _hubspot(text: str) -> list[str]:
    return _texts(
        _match(text, [_entity(HUBSPOT, "HubSpot")], [_alias(HUBSPOT, "HubSpot")]), text, HUBSPOT
    )


# Match modes.


def test_word_boundary_ignores_case_and_needs_a_boundary_each_side() -> None:
    text = "HubSpot, hubspot and HUBSPOT beat MyHubSpot and HubSpotter."
    assert _hubspot(text) == ["HubSpot", "hubspot", "HUBSPOT"]


def test_word_boundary_allows_possessives_and_plurals() -> None:
    text = (
        "HubSpot's pricing, two HubSpots, the HubSpots' plans, "
        f"HubSpot{APOSTROPHE}s CRM and HubSpotes."
    )
    assert _hubspot(text) == ["HubSpot"] * 5


def test_anything_but_a_letter_digit_or_mark_is_a_boundary() -> None:
    text = f"(acme) acme. acme-crm 'acme' acme_x acme2 {E_ACUTE}acme"
    result = _match(text, [_entity(ACME, "Acme")], [_alias(ACME, "acme")])
    assert len(_texts(result, text, ACME)) == 5


def test_symbols_and_footnote_digits_end_a_name() -> None:
    for after in (
        "\N{TRADE MARK SIGN}",
        "\N{SERVICE MARK}",
        "\N{SUPERSCRIPT ONE}",
        "\N{REGISTERED SIGN}",
    ):
        assert _hubspot(f"Try HubSpot{after} today") == ["HubSpot"]


def test_an_indic_vowel_sign_is_part_of_the_word() -> None:
    ka_ma = "\N{DEVANAGARI LETTER KA}\N{DEVANAGARI LETTER MA}"
    word = ka_ma + "\N{DEVANAGARI VOWEL SIGN AA}\N{DEVANAGARI LETTER LA}"
    result = _match(f"{word} {ka_ma}", [_entity(ACME, ka_ma)], [_alias(ACME, ka_ma)])
    assert _texts(result, f"{word} {ka_ma}", ACME) == [ka_ma]


def test_kana_voicing_marks_tell_letters_apart() -> None:
    gasu = "\N{KATAKANA LETTER GA}\N{KATAKANA LETTER SU}"
    kasu = "\N{KATAKANA LETTER KA}\N{KATAKANA LETTER SU}"
    result = _match(gasu, [_entity(ACME, kasu)], [_alias(ACME, kasu, "substring")])
    assert result.mentions == ()


def test_an_alias_ending_in_a_symbol_needs_no_boundary_on_that_side() -> None:
    text = "We use C++17 and C++. Mail x@acme."
    entities = [_entity(ACME, "C++"), _entity(HUBSPOT, "@acme")]
    result = _match(text, entities, [_alias(ACME, "C++"), _alias(HUBSPOT, "@acme")])
    assert _texts(result, text, ACME) == ["C++", "C++"]
    assert _texts(result, text, HUBSPOT) == ["@acme"]


def test_case_sensitive_and_exact_case_compare_the_original_case() -> None:
    text = "Notion is a notion; NOTION too."
    for alias in (
        _alias(ACME, "Notion", case_sensitive=True),
        _alias(ACME, "Notion", "exact_case"),
    ):
        result = _match(text, [_entity(ACME, "Notion Labs")], [alias])
        assert _texts(result, text, ACME) == ["Notion"]


def test_substring_needs_no_boundary() -> None:
    text = "SalesforceIQ and MySalesforce"
    result = _match(text, [_entity(ACME, "Salesforce")], [_alias(ACME, "salesforce", "substring")])
    assert _texts(result, text, ACME) == ["Salesforce", "Salesforce"]


def test_matching_sees_through_normalization_and_reports_original_offsets() -> None:
    first = f"Caf{E_ACUTE}\N{NO-BREAK SPACE} Bot"
    second = "cafe\N{COMBINING ACUTE ACCENT} bot"
    text = (
        f"Try \N{LEFT DOUBLE QUOTATION MARK}{first}\N{RIGHT DOUBLE QUOTATION MARK} "
        f"or {second} \N{LEFT-TO-RIGHT MARK}today"
    )
    result = _match(text, [_entity(ACME, "Cafe Bot")], [_alias(ACME, "cafe bot")])
    assert _texts(result, text, ACME) == [first, second]


# Patterns.


def test_regex_runs_through_re2_on_the_normalized_text() -> None:
    text = "Acme CRM, ACME-CRM and acmecrm"
    entities = [_entity(ACME, "Acme Corp")]
    result = _match(text, entities, [_alias(ACME, r"acme[ -]?crm", "regex")])
    assert _texts(result, text, ACME) == ["Acme CRM", "ACME-CRM", "acmecrm"]
    sensitive = _alias(ACME, r"Acme[ -]?CRM", "regex", case_sensitive=True)
    assert _texts(_match(text, entities, [sensitive]), text, ACME) == ["Acme CRM"]


def test_a_pattern_is_normalized_like_the_text() -> None:
    text = f"Nestl{E_ACUTE} and Acme{APOSTROPHE}s"
    entities = [_entity(ACME, "Nestle"), _entity(HUBSPOT, "Acme")]
    aliases = [
        _alias(ACME, f"Nestl{E_ACUTE}", "regex"),
        _alias(HUBSPOT, f"Acme{APOSTROPHE}s", "regex"),
    ]
    result = _match(text, entities, aliases)
    assert _texts(result, text, ACME) == [f"Nestl{E_ACUTE}"]
    assert _texts(result, text, HUBSPOT) == [f"Acme{APOSTROPHE}s"]


def test_a_regex_that_matches_nothing_wide_is_skipped() -> None:
    result = _match("acme", [_entity(ACME, "Acme Corp")], [_alias(ACME, "x*", "regex")])
    assert result.mentions == ()


def test_a_lone_surrogate_does_not_reach_re2() -> None:
    result = _match("\ud800 acme", [_entity(ACME, "Acme")], [_alias(ACME, "acme", "regex")])
    assert _texts(result, "\ud800 acme", ACME) == ["acme"]


@pytest.mark.parametrize("pattern", ["(acme", r"(a)\1", "(?<=a)b", "a{2000000}", "[a-z]{1000}" * 3])
def test_a_pattern_the_matcher_cannot_run_is_refused(pattern: str) -> None:
    for case_sensitive in (True, False):
        with pytest.raises(InvalidAliasPatternError):
            check_pattern(pattern, case_sensitive=case_sensitive)


def test_a_pattern_is_checked_with_its_own_case_setting() -> None:
    """Ignoring case makes `[a-z]{400}` a program six times larger."""
    check_pattern("[a-z]{400}", case_sensitive=True)
    with pytest.raises(InvalidAliasPatternError):
        check_pattern("[a-z]{400}", case_sensitive=False)


def test_a_stored_pattern_the_matcher_cannot_run_is_left_out_not_fatal() -> None:
    bad = _alias(ACME, "[a-z]{400}", "regex")
    matcher = AliasMatcher([_entity(ACME, "Acme")], [bad, _alias(ACME, "acme")])
    assert matcher.skipped_alias_ids == (bad.id,)
    assert [m.entity_id for m in matcher.match("acme").mentions] == [ACME]


def test_a_pathological_pattern_runs_in_linear_time() -> None:
    matcher = AliasMatcher([_entity(ACME, "Acme")], [_alias(ACME, "(a+)+$", "regex")])
    started = time.monotonic()
    matcher.match("a" * 50_000 + "!")
    assert time.monotonic() - started < 1.0


# Overlaps, negatives, products, domains.


def test_the_longest_match_wins() -> None:
    text = "Salesforce Marketing Cloud beats Salesforce."
    entities = [_entity(ACME, "Salesforce"), _entity(CLOUD, "Salesforce Marketing Cloud")]
    aliases = [_alias(ACME, "Salesforce"), _alias(CLOUD, "Salesforce Marketing Cloud")]
    result = _match(text, entities, aliases)
    assert _texts(result, text, CLOUD) == ["Salesforce Marketing Cloud"]
    assert _texts(result, text, ACME) == ["Salesforce"]


def test_a_span_that_would_be_discarded_takes_no_text_from_one_that_counts() -> None:
    text = "we use salesforce marketing cloud"
    entities = [
        _entity(ACME, "Salesforce"),
        _entity(CLOUD, "Salesforce Marketing Cloud", is_ambiguous=True),
    ]
    aliases = [_alias(ACME, "Salesforce"), _alias(CLOUD, "salesforce marketing cloud")]
    result = _match(text, entities, aliases)
    assert _texts(result, text, ACME) == ["salesforce"]
    assert _mention(result, CLOUD) is None


def test_discarded_spans_are_still_reported_where_nothing_counts() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True)]
    mention = _mention(_match("see you monday", entities, [_alias(MONDAY, "Monday")]), MONDAY)
    assert mention is not None
    assert [(span.status, span.score) for span in mention.spans] == [("discarded", 0.05)]


def test_a_product_counts_toward_its_parent_brand() -> None:
    text = "Salesforce Marketing Cloud is good."
    entities = [
        _entity(ACME, "Salesforce"),
        _entity(CLOUD, "Salesforce Marketing Cloud", parent_entity_id=ACME),
    ]
    product_alias = _alias(CLOUD, "Salesforce Marketing Cloud")
    result = _match(text, entities, [_alias(ACME, "Salesforce"), product_alias])
    brand = _mention(result, ACME)
    assert brand is not None
    assert [(s.start, s.end, s.match_method, s.via_entity_id, s.alias_id) for s in brand.spans] == [
        (0, 26, "via_product", CLOUD, product_alias.id)
    ]
    product = _mention(result, CLOUD)
    assert product is not None
    assert [s.match_method for s in product.spans] == ["alias_word"]


def test_a_parent_outside_the_project_gets_nothing() -> None:
    text = "Salesforce Marketing Cloud"
    entities = [_entity(CLOUD, "Salesforce Marketing Cloud", parent_entity_id=ACME)]
    result = _match(text, entities, [_alias(CLOUD, "Salesforce Marketing Cloud")])
    assert [m.entity_id for m in result.mentions] == [CLOUD]


def test_a_span_inside_a_negative_span_is_dropped() -> None:
    text = "Apple pie on Monday morning, then Apple launched on Monday."
    entities = [_entity(APPLE, "Apple"), _entity(MONDAY, "Monday")]
    pie = _alias(APPLE, "apple pie", negative=True)
    morning = _alias(MONDAY, "monday morning", negative=True)
    aliases = [_alias(APPLE, "Apple"), _alias(MONDAY, "Monday"), pie, morning]
    result = _match(text, entities, aliases)
    assert _texts(result, text, APPLE) == ["Apple"]
    assert _texts(result, text, MONDAY) == ["Monday"]
    assert [(n.start, n.end, n.alias_id) for n in result.negatives_applied] == [
        (0, 9, pie.id),
        (13, 27, morning.id),
    ]


def test_every_negative_that_covers_a_span_is_reported() -> None:
    pie = _alias(APPLE, "apple pie", negative=True)
    tart = _alias(APPLE, "apple pie tart", negative=True)
    result = _match(
        "apple pie tart", [_entity(APPLE, "Apple")], [_alias(APPLE, "apple"), pie, tart]
    )
    assert result.mentions == ()
    assert {n.alias_id for n in result.negatives_applied} == {pie.id, tart.id}


def test_a_negative_that_drops_nothing_is_not_reported() -> None:
    result = _match(
        "apple pie", [_entity(APPLE, "Apple Inc")], [_alias(APPLE, "apple pie", negative=True)]
    )
    assert result.negatives_applied == ()
    # A positive elsewhere does not make a negative that holds nothing count.
    elsewhere = _match(
        "apple, then pie tart",
        [_entity(APPLE, "Apple")],
        [_alias(APPLE, "apple"), _alias(APPLE, "pie tart", negative=True)],
    )
    assert _texts(elsewhere, "apple, then pie tart", APPLE) == ["apple"]
    assert elsewhere.negatives_applied == ()


def test_many_negatives_on_a_long_text_are_quick() -> None:
    entities = [_entity(APPLE, "Apple")]
    aliases = [_alias(APPLE, "apple"), _alias(APPLE, "apple pie", negative=True)]
    started = time.monotonic()
    result = _match("apple pie " * 10_000, entities, aliases)
    assert time.monotonic() - started < 2.0
    assert result.mentions == ()
    assert len(result.negatives_applied) == 10_000


def test_overlapping_matches_on_a_long_text_resolve_quickly() -> None:
    """A substring alias of one letter on the alias test's 100 KB limit."""
    entities = [_entity(ACME, "A"), _entity(HUBSPOT, "Aa")]
    aliases = [_alias(ACME, "a", "substring"), _alias(HUBSPOT, "aa", "substring")]
    started = time.monotonic()
    result = _match("a" * 100_000, entities, aliases)
    assert time.monotonic() - started < 5.0
    assert [len(m.spans) for m in result.mentions] == [50_000]


def test_more_matches_than_the_limit_are_refused() -> None:
    aliases = [_alias(ACME, "a" * length, "substring") for length in range(1, 4)]
    with pytest.raises(TooManyMatchesError):
        _match("a" * (MAX_HITS // 3 + 10), [_entity(ACME, "A")], aliases)


def test_domain_shaped_aliases_come_from_the_entity_domains() -> None:
    text = (
        "Visit acme.io, www.acme.io or Acme.IO/pricing; "
        "not acme.io.evil.com, acme.ios, acme.io-x, my-acme.io or notacme.io."
    )
    entities = [_entity(ACME, "Acme Corp", domains=("www.acme.io", "acme.io"))]
    result = _match(text, entities, [])
    mention = _mention(result, ACME)
    assert mention is not None
    assert [text[s.start : s.end] for s in mention.spans] == ["acme.io", "acme.io", "Acme.IO"]
    assert {s.match_method for s in mention.spans} == {"alias_domain"}
    assert {s.alias_id for s in mention.spans} == {None}


def test_an_international_domain_matches_as_it_is_written() -> None:
    text = f"Siehe b{U_UMLAUT}cher.de"
    entities = [_entity(ACME, f"B{U_UMLAUT}cher", domains=("xn--bcher-kva.de",))]
    assert _texts(_match(text, entities, []), text, ACME) == [f"b{U_UMLAUT}cher.de"]


def test_a_host_idna_refuses_is_matched_as_it_is() -> None:
    result = _match("see my_app.acme.io", [_entity(ACME, "Acme", domains=("my_app.acme.io",))], [])
    assert _texts(result, "see my_app.acme.io", ACME) == ["my_app.acme.io"]


def test_a_host_that_leaves_nothing_to_match_is_ignored() -> None:
    assert _match("www.", [_entity(ACME, "Acme", domains=("www.",))], []).mentions == ()


def test_one_entity_matched_twice_on_one_span_reports_it_once() -> None:
    text = "acme.io"
    entities = [_entity(ACME, "Acme", domains=("acme.io",))]
    result = _match(text, entities, [_alias(ACME, "acme.io"), _alias(ACME, "acme.io", "substring")])
    mention = _mention(result, ACME)
    assert mention is not None
    assert [(s.start, s.end, s.match_method) for s in mention.spans] == [(0, 7, "alias_word")]


def test_two_entities_on_the_same_span_both_count() -> None:
    entities = [_entity(ACME, "Acme"), _entity(HUBSPOT, "Acme Corp")]
    result = _match("acme", entities, [_alias(ACME, "acme"), _alias(HUBSPOT, "acme")])
    assert {m.entity_id for m in result.mentions} == {ACME, HUBSPOT}


# The score (D6).


def test_a_plain_entity_is_accepted_at_095() -> None:
    result = _match("Acme", [_entity(ACME, "Acme")], [_alias(ACME, "Acme")])
    mention = _mention(result, ACME)
    assert mention is not None
    assert (mention.confidence, mention.status) == (0.95, "accepted")
    assert mention.spans[0].status == "accepted"


def _monday(text: str, hints: tuple[str, ...] = ("project management",)) -> tuple[float, str]:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True, hints=hints)]
    mention = _mention(_match(text, entities, [_alias(MONDAY, "Monday")]), MONDAY)
    assert mention is not None
    return mention.confidence, mention.status


def test_an_ambiguous_name_needs_context() -> None:
    # Base 0.30, a hint +0.35, capitalized mid-sentence +0.15, lowercase -0.25.
    assert _monday("For project management we use Monday daily.") == (0.80, "accepted")
    assert _monday("Monday is fine for project management.") == (0.65, "uncertain")
    assert _monday("We use Monday.") == (0.45, "uncertain")
    assert _monday("project management with monday") == (0.40, "uncertain")
    # The whole hint, not its first word.
    assert _monday("For project planning we use Monday daily.") == (0.45, "uncertain")
    assert _monday("see you monday") == (0.05, "discarded")


def test_lowercase_costs_only_a_name_that_is_capitalized() -> None:
    entities = [_entity(MONDAY, "monday", is_ambiguous=True)]
    mention = _mention(_match("see you monday", entities, [_alias(MONDAY, "monday")]), MONDAY)
    assert mention is not None
    assert mention.confidence == 0.30


def test_a_hint_counts_within_40_tokens_of_either_end() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True, hints=("crm",))]
    near = _match(f"crm {' '.join(['word'] * 39)} Monday", entities, [_alias(MONDAY, "Monday")])
    far = _match(f"crm {' '.join(['word'] * 40)} Monday", entities, [_alias(MONDAY, "Monday")])
    # Both are capitalized mid-sentence (+0.15); only the near one has the hint (+0.35).
    assert [_confidence(near, MONDAY), _confidence(far, MONDAY)] == [0.80, 0.45]
    # 40 tokens from the hint's last token, and 40 to its first.
    assert _monday(f"Use project management {' '.join(['word'] * 39)} Monday")[0] == 0.80
    assert _monday(f"Monday {' '.join(['word'] * 38)} then project management")[0] == 0.65


def test_an_alias_that_requires_context_gets_no_capital_bonus() -> None:
    """The bonus is for common-word names; an abbreviation is capitalized anyway."""
    entities = [_entity(ACME, "Acme", hints=("crm",))]
    aliases = [_alias(ACME, "AC", requires_context=True)]
    mention = _mention(_match("We like AC.", entities, aliases), ACME)
    assert mention is not None
    assert (mention.confidence, mention.status) == (0.30, "discarded")


def test_the_best_span_sets_the_status_and_spans_keep_their_own_scores() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True, hints=("crm",))]
    text = "monday. " + " ".join(["word"] * 50) + " The crm we use is Monday."
    mention = _mention(_match(text, entities, [_alias(MONDAY, "Monday")]), MONDAY)
    assert mention is not None
    assert [(span.score, span.status) for span in mention.spans] == [
        (0.05, "discarded"),
        (0.80, "accepted"),
    ]
    assert (mention.confidence, mention.status) == (0.80, "accepted")


@pytest.mark.parametrize(
    "text",
    [
        "Monday",
        "1. Monday",
        "12) Monday",
        "- Monday",
        "* Monday",
        "Tools:\nMonday",
        "Tools: Monday",
        "Done.\N{NO-BREAK SPACE}Monday",
        "Wait\N{HORIZONTAL ELLIPSIS} Monday",
        "\N{LEFT DOUBLE QUOTATION MARK}Monday",
        "| Monday |",
        "_Monday_",
        "`Monday`",
        "(Monday)",
    ],
)
def test_a_name_that_opens_a_sentence_or_item_gets_no_capital_bonus(text: str) -> None:
    assert _monday(text, hints=())[0] == 0.30


@pytest.mark.parametrize("text", ["We use Monday", "see a) Monday", "x1) Monday", "is **Monday**"])
def test_a_name_inside_a_sentence_gets_the_capital_bonus(text: str) -> None:
    assert _monday(text, hints=())[0] == 0.45


# Results and properties.


def test_mentions_come_in_text_order_of_their_first_counting_span() -> None:
    text = "monday then HubSpot then Acme then HubSpot then We use Monday"
    entities = [
        _entity(ACME, "Acme"),
        _entity(HUBSPOT, "HubSpot"),
        _entity(MONDAY, "Monday", is_ambiguous=True),
    ]
    aliases = [_alias(ACME, "Acme"), _alias(HUBSPOT, "HubSpot"), _alias(MONDAY, "Monday")]
    result = _match(text, entities, aliases)
    assert [m.entity_id for m in result.mentions] == [HUBSPOT, ACME, MONDAY]
    assert [s.start for s in result.mentions[0].spans] == [12, 35]


def test_an_entity_with_only_discarded_spans_comes_last() -> None:
    entities = [_entity(ACME, "Acme"), _entity(MONDAY, "Monday", is_ambiguous=True)]
    result = _match("monday, then Acme", entities, [_alias(ACME, "Acme"), _alias(MONDAY, "Monday")])
    assert [m.entity_id for m in result.mentions] == [ACME, MONDAY]


def test_an_alias_for_an_entity_that_is_not_given_is_refused() -> None:
    with pytest.raises(ValueError, match="entity"):
        AliasMatcher([], [_alias(ACME, "acme")])


def test_an_alias_that_normalizes_to_nothing_is_ignored() -> None:
    invisible = "\N{ZERO WIDTH SPACE} \N{ZERO WIDTH SPACE}"
    result = _match("acme", [_entity(ACME, "Acme Corp")], [_alias(ACME, invisible)])
    assert result.mentions == ()
    assert _match("acme", [_entity(ACME, invisible)], []).mentions == ()


def test_an_entity_is_found_by_its_name_without_any_alias() -> None:
    text = "HubSpot, hubspot and MyHubSpot"
    result = _match(text, [_entity(HUBSPOT, "HubSpot")], [])
    mention = _mention(result, HUBSPOT)
    assert mention is not None
    assert [(text[s.start : s.end], s.match_method, s.alias_id) for s in mention.spans] == [
        ("HubSpot", "alias_name", None),
        ("hubspot", "alias_name", None),
    ]


def test_a_stored_alias_with_the_names_text_takes_its_place() -> None:
    alias = _alias(HUBSPOT, "HubSpot")
    mention = _mention(_match("HubSpot", [_entity(HUBSPOT, "HubSpot")], [alias]), HUBSPOT)
    assert mention is not None
    assert [(s.match_method, s.alias_id) for s in mention.spans] == [("alias_word", alias.id)]


def test_an_ambiguous_name_matched_by_itself_still_needs_context() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True, hints=("crm",))]
    assert _confidence(_match("see you monday", entities, []), MONDAY) == 0.05
    assert _confidence(_match("The crm we use is Monday.", entities, []), MONDAY) == 0.80


def test_no_aliases_match_nothing() -> None:
    assert AliasMatcher([], []).match("anything").mentions == ()


words = st.sampled_from(
    ["Acme", "acme", "ACME", f"Caf{E_ACUTE}", f"Stra{SHARP_S}e", "HubSpot", "x", "acmes"]
)
separators = st.sampled_from(
    [
        " ",
        ", ",
        "\N{NO-BREAK SPACE}",
        "\N{ZERO WIDTH SPACE}",
        "'s ",
        "-",
        "\n",
        "",
        "\N{TRADE MARK SIGN}",
    ]
)


@given(st.lists(st.tuples(words, separators), max_size=12))
def test_every_span_slices_the_text_to_something_that_normalizes_to_its_alias(
    pieces: list[tuple[str, str]],
) -> None:
    text = "".join(word + separator for word, separator in pieces)
    aliases = [
        _alias(ACME, "acme"),
        _alias(HUBSPOT, "Strasse", "substring"),
        _alias(CLOUD, "cafe", case_sensitive=False),
    ]
    entities = [_entity(ACME, "Acme"), _entity(HUBSPOT, "Strasse"), _entity(CLOUD, "Cafe")]
    keys = {alias.entity_id: normalize(alias.alias, fold_case=True).text for alias in aliases}
    for mention in _match(text, entities, aliases).mentions:
        for span in mention.spans:
            assert (
                normalize(text[span.start : span.end], fold_case=True).text
                == keys[mention.entity_id]
            )
