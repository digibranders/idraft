"""Light extraction of AI answers (docs/13-ai-extraction-engine.md stages 1, 2, 4, 5 and 7):
mentions with their offsets and order, citation roles, and the fact row, on hand-written answers."""

from __future__ import annotations

import uuid
from collections.abc import Mapping

from idraft.extraction.ai_facts import (
    AnswerFacts,
    SourceIn,
    blank_link_targets,
    extract_answer_facts,
)
from idraft.extraction.aliases import AliasMatcher, AliasRule, EntityRule
from idraft.extraction.domains import DomainResolver, DomainRule, ProjectRole
from idraft.extraction.urls import canonicalize, normalize_host

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
