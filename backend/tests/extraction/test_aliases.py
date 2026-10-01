"""Alias matching and the disambiguation score (docs/13-ai-extraction-engine.md stages 4 and 5,
plan decision D6)."""

from __future__ import annotations

import time
import uuid

import pytest
from hypothesis import given
from hypothesis import strategies as st

from sightline.extraction.aliases import (
    AliasMatcher,
    AliasRule,
    EntityMention,
    EntityRule,
    InvalidAliasPatternError,
    MatchMode,
    MatchResult,
    check_pattern,
)
from sightline.extraction.text import normalize

ACME = uuid.UUID(int=1)
HUBSPOT = uuid.UUID(int=2)
CLOUD = uuid.UUID(int=3)
APPLE = uuid.UUID(int=4)
MONDAY = uuid.UUID(int=5)


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


# Match modes.


def test_word_boundary_ignores_case_and_needs_a_boundary_each_side() -> None:
    text = "HubSpot, hubspot and HUBSPOT beat MyHubSpot and HubSpotter."
    result = _match(text, [_entity(HUBSPOT, "HubSpot")], [_alias(HUBSPOT, "HubSpot")])
    assert _texts(result, text, HUBSPOT) == ["HubSpot", "hubspot", "HUBSPOT"]


def test_word_boundary_allows_possessives_and_plurals() -> None:
    text = (
        "HubSpot's pricing, two HubSpots, the HubSpots' plans and "
        "HubSpot\N{RIGHT SINGLE QUOTATION MARK}s CRM."
    )
    result = _match(text, [_entity(HUBSPOT, "HubSpot")], [_alias(HUBSPOT, "HubSpot")])
    assert _texts(result, text, HUBSPOT) == ["HubSpot"] * 4


def test_anything_but_a_letter_or_digit_is_a_boundary() -> None:
    text = "(acme) acme. acme-crm 'acme' acme_x acme2 éacme"
    result = _match(text, [_entity(ACME, "Acme")], [_alias(ACME, "acme")])
    assert len(_texts(result, text, ACME)) == 5


def test_an_alias_ending_in_a_symbol_needs_no_boundary_after_it() -> None:
    text = "We use C++17 and C++."
    result = _match(text, [_entity(ACME, "C++")], [_alias(ACME, "C++")])
    assert _texts(result, text, ACME) == ["C++", "C++"]


def test_case_sensitive_and_exact_case_compare_the_original_case() -> None:
    text = "Notion is a notion; NOTION too."
    for alias in (
        _alias(ACME, "Notion", case_sensitive=True),
        _alias(ACME, "Notion", "exact_case"),
    ):
        result = _match(text, [_entity(ACME, "Notion")], [alias])
        assert _texts(result, text, ACME) == ["Notion"]


def test_substring_needs_no_boundary() -> None:
    text = "SalesforceIQ and MySalesforce"
    result = _match(text, [_entity(ACME, "Salesforce")], [_alias(ACME, "salesforce", "substring")])
    assert _texts(result, text, ACME) == ["Salesforce", "Salesforce"]


def test_matching_sees_through_normalization_and_reports_original_offsets() -> None:
    first = "Caf\N{LATIN SMALL LETTER E WITH ACUTE}\N{NO-BREAK SPACE} Bot"
    second = "cafe\N{COMBINING ACUTE ACCENT} bot"
    text = (
        f"Try \N{LEFT DOUBLE QUOTATION MARK}{first}\N{RIGHT DOUBLE QUOTATION MARK} "
        f"or {second} today"
    )
    result = _match(text, [_entity(ACME, "Cafe Bot")], [_alias(ACME, "cafe bot")])
    assert _texts(result, text, ACME) == [first, second]


def test_regex_runs_through_re2_on_the_normalized_text() -> None:
    text = "Acme CRM, ACME-CRM and acmecrm"
    result = _match(text, [_entity(ACME, "Acme")], [_alias(ACME, r"acme[ -]?crm", "regex")])
    assert _texts(result, text, ACME) == ["Acme CRM", "ACME-CRM", "acmecrm"]
    sensitive = _alias(ACME, r"Acme[ -]?CRM", "regex", case_sensitive=True)
    assert _texts(_match(text, [_entity(ACME, "Acme")], [sensitive]), text, ACME) == ["Acme CRM"]


def test_a_regex_that_matches_nothing_wide_is_skipped() -> None:
    result = _match("acme", [_entity(ACME, "Acme")], [_alias(ACME, "x*", "regex")])
    assert result.mentions == ()


@pytest.mark.parametrize("pattern", ["(acme", r"(a)\1", "(?<=a)b", "a{2000000}"])
def test_an_invalid_pattern_is_refused(pattern: str) -> None:
    with pytest.raises(InvalidAliasPatternError):
        check_pattern(pattern)
    with pytest.raises(InvalidAliasPatternError):
        AliasMatcher([_entity(ACME, "Acme")], [_alias(ACME, pattern, "regex")])


def test_overlapping_matches_on_a_long_text_resolve_quickly() -> None:
    """A substring alias of one letter on the alias test's 100 KB limit."""
    entities = [_entity(ACME, "A"), _entity(HUBSPOT, "Aa")]
    aliases = [_alias(ACME, "a", "substring"), _alias(HUBSPOT, "aa", "substring")]
    started = time.monotonic()
    result = _match("a" * 100_000, entities, aliases)
    assert time.monotonic() - started < 5.0
    assert [len(m.spans) for m in result.mentions] == [50_000]


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


def test_a_product_counts_toward_its_parent_brand() -> None:
    text = "Salesforce Marketing Cloud is good."
    entities = [
        _entity(ACME, "Salesforce"),
        _entity(CLOUD, "Salesforce Marketing Cloud", parent_entity_id=ACME),
    ]
    aliases = [_alias(ACME, "Salesforce"), _alias(CLOUD, "Salesforce Marketing Cloud")]
    result = _match(text, entities, aliases)
    brand = _mention(result, ACME)
    assert brand is not None
    assert [(s.start, s.end, s.match_method) for s in brand.spans] == [(0, 26, "via_product")]
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


def test_a_negative_that_drops_nothing_is_not_reported() -> None:
    result = _match(
        "apple pie", [_entity(APPLE, "Apple")], [_alias(APPLE, "apple pie", negative=True)]
    )
    assert result.negatives_applied == ()


def test_domain_shaped_aliases_come_from_the_entity_domains() -> None:
    text = (
        "Visit acme.io, www.acme.io or Acme.IO/pricing; "
        "not acme.io.evil.com, acme.ios, acme.io-x or notacme.io."
    )
    entities = [_entity(ACME, "Acme", domains=("www.acme.io", "acme.io"))]
    result = _match(text, entities, [])
    mention = _mention(result, ACME)
    assert mention is not None
    assert [text[s.start : s.end] for s in mention.spans] == ["acme.io", "acme.io", "Acme.IO"]
    assert {s.match_method for s in mention.spans} == {"alias_domain"}
    assert {s.alias_id for s in mention.spans} == {None}


def test_an_international_domain_matches_as_it_is_written() -> None:
    text = "Siehe bücher.de"
    result = _match(text, [_entity(ACME, "Bücher", domains=("xn--bcher-kva.de",))], [])
    assert _texts(result, text, ACME) == ["bücher.de"]


def test_a_host_idna_refuses_is_matched_as_it_is() -> None:
    result = _match("see my_app.acme.io", [_entity(ACME, "Acme", domains=("my_app.acme.io",))], [])
    assert _texts(result, "see my_app.acme.io", ACME) == ["my_app.acme.io"]


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


def test_an_ambiguous_name_needs_context() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True, hints=("project management",))]
    aliases = [_alias(MONDAY, "Monday")]

    def scored(text: str) -> tuple[float, str]:
        mention = _mention(_match(text, entities, aliases), MONDAY)
        assert mention is not None
        return mention.confidence, mention.status

    # Base 0.30, a hint +0.35, capitalized mid-sentence +0.15.
    assert scored("For project management we use Monday daily.") == (0.80, "accepted")
    assert scored("Monday is fine for project management.") == (0.65, "uncertain")
    assert scored("We use Monday.") == (0.45, "uncertain")
    assert scored("see you monday") == (0.05, "discarded")


def test_a_hint_further_than_40_tokens_does_not_count() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True, hints=("crm",))]
    filler = " ".join(["word"] * 40)
    near = _match(f"crm {' '.join(['word'] * 39)} Monday", entities, [_alias(MONDAY, "Monday")])
    far = _match(f"crm {filler} Monday", entities, [_alias(MONDAY, "Monday")])
    # Both are capitalized mid-sentence (+0.15); only the near one has the hint (+0.35).
    assert [_confidence(near, MONDAY), _confidence(far, MONDAY)] == [0.80, 0.45]


def test_an_alias_that_requires_context_scores_like_an_ambiguous_name() -> None:
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
    assert [span.score for span in mention.spans] == [0.05, 0.80]
    assert (mention.confidence, mention.status) == (0.80, "accepted")


def test_a_list_item_starts_a_sentence() -> None:
    entities = [_entity(MONDAY, "Monday", is_ambiguous=True)]
    for text in ("1. Monday", "- Monday", "* Monday", "Tools:\nMonday"):
        mention = _mention(_match(text, entities, [_alias(MONDAY, "Monday")]), MONDAY)
        assert mention is not None
        assert mention.confidence == 0.30


# Results and properties.


def test_mentions_come_in_text_order_with_their_spans_in_order() -> None:
    text = "HubSpot then Acme then HubSpot"
    entities = [_entity(ACME, "Acme"), _entity(HUBSPOT, "HubSpot")]
    result = _match(text, entities, [_alias(ACME, "Acme"), _alias(HUBSPOT, "HubSpot")])
    assert [m.entity_id for m in result.mentions] == [HUBSPOT, ACME]
    assert [s.start for s in result.mentions[0].spans] == [0, 23]


def test_an_alias_for_an_entity_that_is_not_given_is_refused() -> None:
    with pytest.raises(ValueError, match="entity"):
        AliasMatcher([], [_alias(ACME, "acme")])


def test_an_alias_that_normalizes_to_nothing_is_ignored() -> None:
    invisible = "\N{ZERO WIDTH SPACE} \N{ZERO WIDTH SPACE}"
    result = _match("acme", [_entity(ACME, "Acme")], [_alias(ACME, invisible)])
    assert result.mentions == ()


def test_no_aliases_match_nothing() -> None:
    assert AliasMatcher([], []).match("anything").mentions == ()


words = st.sampled_from(["Acme", "acme", "ACME", "Café", "Straße", "HubSpot", "x"])
separators = st.sampled_from(
    [" ", ", ", "\N{NO-BREAK SPACE}", "\N{ZERO WIDTH SPACE}", "'s ", "-", "\n", ""]
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
