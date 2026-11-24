"""Stages 9 and 10 on realistic answers about managed SOC providers, with the own brand
(Eventus Security) named in different ways. Each case is a hand-labelled answer: whether it
recommends the own brand and the tone of the sentences that name it."""

from __future__ import annotations

import uuid
from collections.abc import Mapping

import pytest

from idraft.extraction.ai_facts import extract_answer_facts
from idraft.extraction.aliases import AliasMatcher, AliasRule, EntityRule
from idraft.extraction.domains import DomainResolver, ProjectRole
from idraft.extraction.sentiment import Sentiment

OWN = uuid.UUID(int=1)
ARCTIC = uuid.UUID(int=2)
SECUREWORKS = uuid.UUID(int=3)
ROLES: Mapping[uuid.UUID, ProjectRole] = {
    OWN: "own",
    ARCTIC: "competitor",
    SECUREWORKS: "competitor",
}
MATCHER = AliasMatcher(
    [
        EntityRule(OWN, "Eventus Security"),
        EntityRule(ARCTIC, "Arctic Wolf"),
        EntityRule(SECUREWORKS, "Secureworks"),
    ],
    [AliasRule(uuid.UUID(int=10), OWN, "Eventus")],
)

NUMBERED = (
    "Here are the best managed SOC providers in India:\n\n"
    "1. **Arctic Wolf**: strong 24/7 monitoring.\n"
    "2. **Secureworks**: mature platform.\n"
    "3. **Eventus Security**: solid regional coverage.\n"
    "4. **Other Vendor**: small team.\n"
)

# (name, answer, recommended, sentiment)
CASES: list[tuple[str, str, bool, Sentiment | None]] = [
    ("not named", "Arctic Wolf and Secureworks are leading managed SOC vendors.", False, None),
    (
        "we recommend, full name",
        "For a mid-sized bank we recommend Eventus Security for its 24/7 coverage.",
        True,
        "neutral",
    ),
    (
        "we recommend, short alias",
        "I would recommend Eventus if you need a local team.",
        True,
        "neutral",
    ),
    (
        "top pick predicate",
        "Eventus Security is a great choice for regulated industries.",
        True,
        "positive",
    ),
    (
        "ideal for",
        "Eventus Security is ideal for mid-market firms that need a managed SOC.",
        True,
        "positive",
    ),
    (
        "your best bet",
        "If you want local expertise, your best bet is Eventus Security.",
        True,
        "positive",
    ),
    (
        "go with",
        "For a quick start I would go with Eventus Security.",
        True,
        "neutral",
    ),
    (
        "our top pick",
        "Our top pick is Eventus Security, followed by Arctic Wolf.",
        True,
        "positive",
    ),
    (
        "joined with a rival",
        "We recommend Arctic Wolf and Eventus Security for 24/7 monitoring.",
        True,
        "neutral",
    ),
    (
        "predicate over two names",
        "Eventus Security and Secureworks are both top choices for SOC outsourcing.",
        True,
        "positive",
    ),
    (
        "numbered first",
        NUMBERED.replace("1. **Arctic Wolf**", "1. **Eventus Security**"),
        True,
        "positive",
    ),
    ("numbered third", NUMBERED, True, "positive"),
    (
        "numbered fourth place",
        NUMBERED.replace("3. **Eventus Security**", "3. **Zeta**").replace(
            "4. **Other Vendor**", "4. **Eventus Security**"
        ),
        False,
        "neutral",
    ),
    (
        "bullets under a suggestion line",
        "Options to consider:\n- **Eventus Security**: managed detection and response\n"
        "- Arctic Wolf: platform approach\n",
        True,
        "neutral",
    ),
    (
        "bullets under a line that suggests nothing",
        "Notes from the report:\n- Eventus Security opened an office in Pune\n"
        "- Arctic Wolf raised funds\n",
        False,
        "neutral",
    ),
    (
        "heading numbered item",
        "Top providers:\n\n### 1. Eventus Security\nA 24/7 SOC with strong local reach.\n",
        True,
        # the praise sits in the next line, which is a known limit of the sentence window
        "neutral",
    ),
    (
        "negative: avoid",
        "Avoid Eventus Security if you need a global follow-the-sun SOC.",
        False,
        "negative",
    ),
    (
        "negative: not recommended",
        "Eventus Security is not recommended for very small teams.",
        False,
        "negative",
    ),
    (
        "negative: not a good fit",
        "Eventus Security is not a good fit for global enterprises.",
        False,
        "negative",
    ),
    (
        "negative: lacks",
        "Eventus Security lacks a self-service portal, which the others offer.",
        False,
        "negative",
    ),
    (
        "negative: too expensive",
        "Eventus Security is too expensive for startups.",
        False,
        "negative",
    ),
    (
        "baseline: unlike",
        "Unlike Eventus Security, Arctic Wolf is the best choice for global coverage.",
        False,
        "positive",
    ),
    (
        "baseline: alternatives to",
        "There are several alternatives to Eventus Security, such as Arctic Wolf.",
        False,
        "neutral",
    ),
    (
        "baseline: compared with",
        "Compared with Eventus Security, Secureworks is the leading provider.",
        False,
        "positive",
    ),
    (
        "competitor endorsed in the same sentence",
        "We recommend Arctic Wolf over Eventus Security.",
        False,
        "neutral",
    ),
    (
        "competitor endorsed, own after but",
        "Secureworks is the best choice, but Eventus Security is cheaper.",
        False,
        # the tone is read over the sentence, so the rival's praise counts: a known limit
        "positive",
    ),
    (
        "recommendation then caution",
        "We recommend Eventus Security. However, Eventus Security is not ideal for global teams.",
        False,
        "negative",
    ),
    (
        "mixed tone, still recommended",
        "Eventus Security is a great choice for local teams, but it is pricey for startups.",
        True,
        "mixed",
    ),
    (
        "neutral mention",
        "Eventus Security is headquartered in Mumbai and runs a SOC.",
        False,
        "neutral",
    ),
    (
        "best within range, no cue for own",
        "The best known names are Arctic Wolf and Secureworks. Eventus Security also exists.",
        False,
        "neutral",
    ),
    (
        "negated negative flips",
        "Eventus Security is not expensive and is well regarded by customers.",
        False,
        "positive",
    ),
    (
        "alias in a link anchor",
        "See [Eventus](https://eventussecurity.com/soc) for its managed SOC, a leading provider.",
        True,
        "positive",
    ),
    (
        "domain in a link target only",
        "Read more at [the vendor](https://eventussecurity.com/best-soc).",
        False,
        None,
    ),
    (
        "lowercase mention with a cue",
        "i recommend eventus security for compliance-heavy teams.",
        True,
        "neutral",
    ),
    (
        "cybersecurity overview, no pick",
        "A managed SOC watches your logs around the clock. Providers such as Eventus Security "
        "offer 24/7 monitoring, threat hunting and incident response.",
        False,
        "neutral",
    ),
]


@pytest.mark.parametrize(
    ("name", "text", "recommended", "sentiment"), CASES, ids=[c[0] for c in CASES]
)
def test_answers_are_classified_as_a_person_would_label_them(
    name: str, text: str, recommended: bool, sentiment: Sentiment | None
) -> None:
    facts = extract_answer_facts(
        text, [], matcher=MATCHER, resolver=DomainResolver([]), roles=ROLES, is_valid=True
    )

    assert (facts.fact.own_recommended, facts.fact.own_sentiment) == (recommended, sentiment), name


def test_there_are_at_least_thirty_labelled_answers() -> None:
    assert len(CASES) >= 30


def test_no_text_is_never_recommended_and_has_no_tone() -> None:
    facts = extract_answer_facts(
        None, [], matcher=MATCHER, resolver=DomainResolver([]), roles=ROLES, is_valid=False
    )

    assert (facts.fact.own_recommended, facts.fact.own_sentiment) == (False, None)
