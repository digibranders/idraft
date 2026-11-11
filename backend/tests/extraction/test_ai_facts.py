"""Light extraction of AI answers (docs/13-ai-extraction-engine.md stages 1, 2, 4, 5 and 7):
mentions with their offsets and order, citation roles, and the fact row, on hand-written answers."""

from __future__ import annotations

import re
import uuid
from collections.abc import Mapping
from pathlib import Path

import pytest

from idraft.extraction.ai_facts import (
    AnswerFacts,
    SourceIn,
    blank_link_targets,
    extract_answer_facts,
)
from idraft.extraction.aliases import AliasMatcher, AliasRule, EntityRule
from idraft.extraction.domains import DomainResolver, DomainRule, ProjectRole
from idraft.extraction.urls import canonicalize, normalize_host
from idraft.providers.dataforseo.ai_parse import parse_ai_answer

OWN = uuid.UUID("00000000-0000-0000-0000-00000000000a")
RIVAL = uuid.UUID("00000000-0000-0000-0000-00000000000b")
WATCHED = uuid.UUID("00000000-0000-0000-0000-00000000000c")
AMBIGUOUS = uuid.UUID("00000000-0000-0000-0000-00000000000d")
UNTRACKED = uuid.UUID("00000000-0000-0000-0000-00000000000e")
ROLES: Mapping[uuid.UUID, ProjectRole] = {
    OWN: "own",
    RIVAL: "competitor",
    WATCHED: "watch",
    AMBIGUOUS: "competitor",
}
MATCHER = AliasMatcher(
    [
        EntityRule(OWN, "Acme SOC", domains=("acme-soc.example",)),
        EntityRule(RIVAL, "Rival Watch", domains=("rival-watch.example",)),
        EntityRule(WATCHED, "Gartner"),
        EntityRule(AMBIGUOUS, "Apex", is_ambiguous=True, hints=("security",)),
        EntityRule(UNTRACKED, "Elsewhere"),
    ],
    [AliasRule(uuid.UUID(int=1), OWN, "Acme")],
)
RESOLVER = DomainResolver(
    [
        DomainRule(OWN, "own", "registrable", normalize_host("acme-soc.example")),
        DomainRule(RIVAL, "competitor", "registrable", normalize_host("rival-watch.example")),
        DomainRule(WATCHED, "watch", "registrable", normalize_host("gartner.example")),
    ]
)


def _source(raw: str, kind: str = "source_list", occurrences: int = 1) -> SourceIn:
    return SourceIn(url=canonicalize(raw), raw_url=raw, kind=kind, occurrences=occurrences)


def _facts(text: str | None, *sources: SourceIn, is_valid: bool = True) -> AnswerFacts:
    return extract_answer_facts(
        text, sources, matcher=MATCHER, resolver=RESOLVER, roles=ROLES, is_valid=is_valid
    )


def test_mentions_carry_their_count_offsets_order_and_spans() -> None:
    text = "Rival Watch and Acme SOC both run a SOC. Acme is cheaper."

    facts = _facts(text)

    rival, own = facts.mentions
    assert (rival.entity_id, rival.role, rival.mention_order) == (RIVAL, "competitor", 1)
    assert (rival.first_char_offset, rival.evidence_spans) == (0, ((0, 11),))
    assert (own.entity_id, own.role, own.mention_order) == (OWN, "own", 2)
    assert own.mention_count == 2
    assert own.evidence_spans == ((16, 24), (41, 45))
    assert own.first_char_offset == 16
    assert own.prominence == round(1 - 16 / len(text), 4)
    assert own.status == "accepted"
    assert facts.fact.own_mentioned
    assert facts.fact.own_mention_order == 2
    assert facts.fact.tracked_entities_mentioned == 2
    assert facts.fact.competitor_mentions == (RIVAL,)


def test_a_watched_entity_is_kept_but_counts_in_no_share() -> None:
    facts = _facts("Gartner rates Acme SOC highly.")

    assert [(m.entity_id, m.role) for m in facts.mentions] == [(WATCHED, "watch"), (OWN, "own")]
    assert facts.fact.tracked_entities_mentioned == 1
    assert facts.fact.competitor_mentions == ()


def test_an_entity_the_project_does_not_track_is_not_kept() -> None:
    facts = _facts("Elsewhere is a vendor too.")

    assert facts.mentions == ()


def test_an_uncertain_mention_is_stored_and_left_out_of_every_rate() -> None:
    # An ambiguous name, capitalized, with no hint near it: 0.45, uncertain.
    facts = _facts("We compared it with Apex last year.")

    (mention,) = facts.mentions
    assert (mention.entity_id, mention.status) == (AMBIGUOUS, "uncertain")
    assert facts.fact.tracked_entities_mentioned == 0
    assert facts.fact.competitor_mentions == ()


def test_an_ambiguous_name_near_its_hint_is_accepted() -> None:
    facts = _facts("For managed security we compared it with Apex last year.")

    (mention,) = facts.mentions
    assert mention.status == "accepted"
    assert facts.fact.competitor_mentions == (AMBIGUOUS,)


def test_a_domain_inside_a_link_target_is_a_citation_not_a_mention() -> None:
    raw = "https://acme-soc.example/pricing?utm_source=chatgpt.com"
    text = f"Pricing starts low ([source]({raw}))."

    facts = _facts(text, _source(raw, "inline"))

    assert facts.mentions == ()
    assert not facts.fact.own_mentioned
    assert facts.fact.own_domain_cited
    (citation,) = facts.citations
    assert citation.first_char_offset == text.index(raw)
    assert (citation.domain_role, citation.role_entity_id) == ("own", OWN)


def test_a_domain_written_in_the_text_is_a_mention_not_a_citation() -> None:
    facts = _facts("See acme-soc.example for details.")

    (mention,) = facts.mentions
    assert (mention.entity_id, mention.match_method) == (OWN, "alias_domain")
    assert not facts.fact.own_domain_cited


def test_blanking_a_link_target_keeps_every_offset() -> None:
    text = "see [Acme](https://acme-soc.example/x) now"

    blanked = blank_link_targets(text)

    assert len(blanked) == len(text)
    assert blanked == "see [Acme](" + " " * len("https://acme-soc.example/x") + ") now"


def test_citations_are_numbered_in_order_with_their_roles() -> None:
    facts = _facts(
        "Acme SOC leads.",
        _source("https://rival-watch.example/blog"),
        _source("https://www.acme-soc.example/"),
        _source("https://news.example/soc", "inline", occurrences=3),
        _source("https://gartner.example/report"),
    )

    assert [(c.index, c.domain_role, c.role_entity_id) for c in facts.citations] == [
        (1, "competitor", RIVAL),
        (2, "own", OWN),
        (3, "third_party", None),
        (4, "third_party", WATCHED),
    ]
    assert facts.citations[2].occurrences == 3
    # Not written in the text: no offset.
    assert facts.citations[0].first_char_offset is None
    fact = facts.fact
    assert (fact.own_citation_count, fact.total_citation_count) == (1, 4)
    assert fact.competitor_cited == (RIVAL,)


def test_the_four_outcomes_are_the_cross_product_of_mentioned_and_cited() -> None:
    own_page = _source("https://acme-soc.example/")
    other = _source("https://news.example/")

    both = _facts("Acme SOC.", own_page).fact
    mentioned_only = _facts("Acme SOC.", other).fact
    cited_only = _facts("A SOC.", own_page).fact
    neither = _facts("A SOC.", other).fact

    assert [
        (f.own_mentioned, f.own_domain_cited) for f in (both, mentioned_only, cited_only, neither)
    ] == [
        (True, True),
        (True, False),
        (False, True),
        (False, False),
    ]


def test_an_answer_without_text_has_citations_and_no_mentions() -> None:
    facts = _facts(None, _source("https://acme-soc.example/"), is_valid=False)

    assert facts.mentions == ()
    assert not facts.fact.is_valid
    assert facts.fact.own_domain_cited
    assert not facts.fact.had_structured_list


def test_offsets_are_code_points() -> None:
    lock = chr(0x1F512)
    facts = _facts(f"{lock} Acme SOC")

    (mention,) = facts.mentions
    assert mention.first_char_offset == 2


def test_offsets_count_every_code_point_of_a_devanagari_greeting() -> None:
    namaste = "".join(chr(c) for c in (0x0928, 0x092E, 0x0938, 0x094D, 0x0924, 0x0947))
    text = f"{namaste} Acme SOC"

    facts = _facts(text)

    (mention,) = facts.mentions
    assert len(namaste) == 6
    assert (mention.first_char_offset, mention.evidence_spans) == (7, ((7, 15),))
    assert mention.prominence == round(1 - 7 / len(text), 4)


def test_an_empty_text_has_no_mentions_and_no_citation_offsets() -> None:
    facts = _facts("", _source("https://acme-soc.example/"), is_valid=False)

    assert facts.mentions == ()
    assert facts.citations[0].first_char_offset is None
    assert not facts.fact.own_mentioned
    assert facts.fact.own_domain_cited


def test_a_competitor_the_project_does_not_track_is_not_cited_as_one() -> None:
    stranger = uuid.UUID("00000000-0000-0000-0000-0000000000f0")
    resolver = DomainResolver(
        [DomainRule(stranger, "competitor", "registrable", normalize_host("stranger.example"))]
    )

    facts = extract_answer_facts(
        "Nothing here.",
        [_source("https://stranger.example/x")],
        matcher=MATCHER,
        resolver=resolver,
        roles=ROLES,
        is_valid=True,
    )

    assert facts.citations[0].domain_role == "competitor"
    assert facts.fact.competitor_cited == ()


@pytest.mark.parametrize(
    "shown",
    [
        "www.acme-soc.example",
        "acme-soc.example",
        "https://acme-soc.example/pricing",
        "http://www.acme-soc.example",
    ],
)
def test_a_domain_shown_as_the_text_of_a_link_pill_is_not_a_mention(shown: str) -> None:
    raw = "https://www.acme-soc.example/pricing?utm_source=chatgpt.com"
    text = f"Pricing starts low [{shown}]({raw})."

    facts = _facts(text, _source(raw, "inline"))

    assert facts.mentions == ()
    assert not facts.fact.own_mentioned
    assert facts.fact.own_domain_cited


@pytest.mark.parametrize("anchor", ["Acme", "Acme SOC pricing", "the Acme SOC site"])
def test_anchor_text_that_names_the_entity_still_counts(anchor: str) -> None:
    raw = "https://acme-soc.example/pricing"
    text = f"Pricing starts low [{anchor}]({raw})."

    facts = _facts(text, _source(raw, "inline"))

    (mention,) = facts.mentions
    assert (mention.entity_id, mention.status, mention.mention_count) == (OWN, "accepted", 1)
    assert mention.first_char_offset == text.index("[") + 1 + anchor.index("Acme")
    assert facts.fact.own_mentioned
    assert facts.fact.own_domain_cited


def test_blanking_a_pill_keeps_its_brackets_and_every_offset() -> None:
    text = "a [www.acme-soc.example](https://www.acme-soc.example/x 'Title') b [Acme](u.example) c"

    blanked = blank_link_targets(text)

    assert len(blanked) == len(text)
    assert blanked == (
        "a ["
        + " " * len("www.acme-soc.example")
        + "]("
        + " " * len("https://www.acme-soc.example/x 'Title'")
        + ") b [Acme]("
        + " " * len("u.example")
        + ") c"
    )


def test_a_domain_written_outside_a_markdown_link_stays_countable() -> None:
    # Decision (doc 13 principle 5): only the markdown link's own target and a host-only link
    # text are links. An autolink, a reference definition and a bare URL are written text.
    for text in (
        "see <https://acme-soc.example/x> now",
        "see [1] now\n\n[1]: https://acme-soc.example/x",
        "see https://acme-soc.example/x now",
    ):
        (mention,) = _facts(text).mentions

        assert (mention.entity_id, mention.match_method) == (OWN, "alias_domain")


def test_pills_on_the_captured_chatgpt_answer_are_not_mentions() -> None:
    fixture = Path(__file__).parents[1] / "fixtures/dataforseo/captured/chatgpt_scraper_answer.json"
    answer = parse_ai_answer("chatgpt_web", fixture.read_bytes())
    assert answer.answer_text is not None
    airtel = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
    matcher = AliasMatcher([EntityRule(airtel, "Zzyzx Unmatched Co", domains=("airtel.in",))], [])
    resolver = DomainResolver(
        [DomainRule(airtel, "own", "registrable", normalize_host("airtel.in"))]
    )
    sources = [
        SourceIn(url=s.url, raw_url=s.raw_url, kind=s.kind, occurrences=s.occurrences)
        for s in answer.sources
        if s.url is not None
    ]

    facts = extract_answer_facts(
        answer.answer_text,
        sources,
        matcher=matcher,
        resolver=resolver,
        roles={airtel: "own"},
        is_valid=True,
    )

    text = answer.answer_text
    outside_links = re.sub(r"\[[^\]\n]*\]\([^)\s]+\)", "", text)
    written = outside_links.count("airtel.in")
    assert text.count("airtel.in") > written  # the fixture does cite it in pills
    counted = sum(m.mention_count for m in facts.mentions)
    assert counted == written
    assert facts.fact.own_mentioned == (written > 0)
    assert facts.fact.own_domain_cited


def test_an_uncertain_mention_before_own_does_not_move_its_order() -> None:
    facts = _facts("We compared it with Apex last year. Acme SOC leads.")

    apex, own = facts.mentions
    assert (apex.entity_id, apex.status, apex.mention_order) == (AMBIGUOUS, "uncertain", None)
    assert (own.entity_id, own.mention_order) == (OWN, 1)
    assert facts.fact.own_mention_order == 1


def test_a_watched_entity_before_own_does_not_move_its_order() -> None:
    facts = _facts("Gartner rates Acme SOC highly.")

    watched, own = facts.mentions
    assert (watched.entity_id, watched.mention_order) == (WATCHED, None)
    assert (own.entity_id, own.mention_order) == (OWN, 1)
    assert facts.fact.own_mention_order == 1


def test_an_accepted_mention_is_built_from_its_accepted_spans_only() -> None:
    filler = " ".join(["word"] * 60)
    text = f"We compared it with Apex last year. {filler}. For security we picked Apex today."

    (mention,) = _facts(text).mentions

    second = text.rindex("Apex")
    assert mention.status == "accepted"
    assert mention.mention_count == 1
    assert mention.first_char_offset == second
    assert mention.evidence_spans == ((second, second + 4),)


PRODUCT = uuid.UUID("00000000-0000-0000-0000-0000000000b1")
PRODUCT_MATCHER = AliasMatcher(
    [
        EntityRule(OWN, "Acme SOC"),
        EntityRule(PRODUCT, "Acme XDR", parent_entity_id=OWN),
        EntityRule(RIVAL, "Rival Watch"),
    ],
    [],
)
PRODUCT_ROLES: Mapping[uuid.UUID, ProjectRole] = {OWN: "own", PRODUCT: "own", RIVAL: "competitor"}


def _product_facts(text: str) -> AnswerFacts:
    return extract_answer_facts(
        text, [], matcher=PRODUCT_MATCHER, resolver=RESOLVER, roles=PRODUCT_ROLES, is_valid=True
    )


def test_a_product_counts_as_its_brand_and_not_as_another_entity() -> None:
    facts = _product_facts("Rival Watch beats Acme XDR.")

    by_entity = {m.entity_id: m for m in facts.mentions}
    assert by_entity[OWN].mention_order == 2
    assert by_entity[OWN].match_method == "via_product"
    assert by_entity[PRODUCT].mention_order is None
    assert by_entity[RIVAL].mention_order == 1
    assert facts.fact.tracked_entities_mentioned == 2
    assert facts.fact.own_mentioned
    assert facts.fact.own_mention_order == 2
    assert facts.fact.competitor_mentions == (RIVAL,)


def test_when_a_brand_and_its_product_both_match_the_brand_takes_the_earlier_order() -> None:
    text = "Rival Watch is good. Acme XDR is part of Acme SOC."

    facts = _product_facts(text)

    own = next(m for m in facts.mentions if m.entity_id == OWN)
    assert own.mention_count == 2
    assert own.first_char_offset == text.index("Acme XDR")
    assert (own.mention_order, facts.fact.own_mention_order) == (2, 2)
    assert facts.fact.tracked_entities_mentioned == 2
