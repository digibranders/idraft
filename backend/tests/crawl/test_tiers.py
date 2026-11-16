"""Tier codes and tier rules: exact, prefix, pattern; the first match wins (spec 5.2)."""

import uuid

import pytest

from idraft.crawl.tiers import (
    DEFAULT_TIERS,
    MAX_TIERS,
    MatchType,
    TierRule,
    check_rule_value,
    first_match,
    rule_matches,
    tier_code,
)

T1, T2 = uuid.uuid4(), uuid.uuid4()


def _rule(position: int, match_type: MatchType, value: str, tier: uuid.UUID = T1) -> TierRule:
    return TierRule(
        rule_id=uuid.uuid4(), position=position, match_type=match_type, value=value, tier_id=tier
    )


def test_codes_come_from_positions() -> None:
    assert [tier_code(position) for position in range(1, MAX_TIERS + 1)] == [
        f"T{n}" for n in range(1, 9)
    ]
    with pytest.raises(ValueError, match="position"):
        tier_code(9)


def test_the_defaults_are_four_named_tiers() -> None:
    assert [name for name, _ in DEFAULT_TIERS] == [
        "Money pages",
        "Supporting pages",
        "Content pages",
        "Utility pages",
    ]


@pytest.mark.parametrize(
    ("match_type", "value", "path", "matches"),
    [
        (MatchType.EXACT, "/pricing", "/pricing", True),
        (MatchType.EXACT, "/pricing", "/pricing/", True),
        (MatchType.EXACT, "/pricing/", "/pricing", True),
        (MatchType.EXACT, "/", "/", True),
        (MatchType.EXACT, "/pricing", "/pricing/team", False),
        (MatchType.PREFIX, "/services/", "/services/seo", True),
        (MatchType.PREFIX, "/services/", "/services", False),
        (MatchType.PREFIX, "/blog", "/blogger", True),
        (MatchType.PATTERN, "/blog/*/comments", "/blog/2026/11/comments", True),
        (MatchType.PATTERN, "/blog/*", "/blog", False),
        (MatchType.PATTERN, "/*.pdf", "/files/guide.pdf", True),
        (MatchType.PATTERN, "/a.b", "/axb", False),
        (MatchType.PATTERN, "/a+b", "/a+b", True),
    ],
)
def test_rules_match_paths(match_type: MatchType, value: str, path: str, matches: bool) -> None:
    assert rule_matches(_rule(1, match_type, value), path) is matches


def test_the_first_rule_by_position_wins_whatever_the_list_order() -> None:
    late = _rule(2, MatchType.PREFIX, "/", T2)
    early = _rule(1, MatchType.PREFIX, "/services/", T1)
    assert first_match([late, early], "/services/seo") == early
    assert first_match([late, early], "/about") == late
    assert first_match([early], "/about") is None


@pytest.mark.parametrize(
    ("match_type", "value", "problem"),
    [
        (MatchType.EXACT, "pricing", "starts_with_slash"),
        (MatchType.PREFIX, "/" + "x" * 500, "too_long"),
        (MatchType.EXACT, "/a*b", "star_in_exact"),
        (MatchType.PATTERN, "/" + "*/" * 11, "too_many_stars"),
        (MatchType.PATTERN, "/blog/*", None),
    ],
)
def test_rule_values_are_checked(match_type: MatchType, value: str, problem: str | None) -> None:
    assert check_rule_value(match_type, value) == problem
