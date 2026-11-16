"""Tier codes and tier rules (spec 5.1 and 5.2).

A tier's code is its position: T1 is the most important. A rule names one tier and matches a
page's path (`core.urls.path`, which has no query): `exact` (a trailing slash does not count),
`prefix` (the path starts with the value) or `pattern` (`*` stands for any run of characters,
slashes included; everything else is literal). Rules are tried by position and the first that
matches wins; a manual tier beats every rule, which the caller decides before asking.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from typing import Final
from uuid import UUID

MAX_TIERS: Final = 8
VALUE_MAX: Final = 500
STARS_MAX: Final = 10
# Name and one-line description of T1 to T4 (migration 0025 seeds the same).
DEFAULT_TIERS: Final = (
    ("Money pages", "Pages that bring revenue: products, services, pricing."),
    ("Supporting pages", "Pages that lead to the money pages: categories, comparisons."),
    ("Content pages", "Articles and guides that earn visits and links."),
    ("Utility pages", "About, contact, legal and account pages."),
)


class MatchType(StrEnum):
    EXACT = "exact"
    PREFIX = "prefix"
    PATTERN = "pattern"


@dataclass(frozen=True, slots=True)
class TierRule:
    rule_id: UUID
    position: int
    match_type: MatchType
    value: str
    tier_id: UUID


def tier_code(position: int) -> str:
    if not 1 <= position <= MAX_TIERS:
        raise ValueError(f"a tier position is 1 to {MAX_TIERS}, got {position}")
    return f"T{position}"


def check_rule_value(match_type: MatchType, value: str) -> str | None:
    """The problem with a rule's value as a validation code, or None when it is fine."""
    if not value.startswith("/"):
        return "starts_with_slash"
    if len(value) > VALUE_MAX:
        return "too_long"
    if match_type is not MatchType.PATTERN and "*" in value:
        return "star_in_exact" if match_type is MatchType.EXACT else "star_in_prefix"
    if value.count("*") > STARS_MAX:
        return "too_many_stars"
    return None


def _trimmed(path: str) -> str:
    return path.rstrip("/") or "/"


@cache
def _pattern(value: str) -> re.Pattern[str]:
    # Literal except `*`; at most STARS_MAX stars and VALUE_MAX characters keep it cheap.
    return re.compile(".*".join(re.escape(part) for part in value.split("*")), re.DOTALL)


def rule_matches(rule: TierRule, path: str) -> bool:
    if rule.match_type is MatchType.EXACT:
        return _trimmed(path) == _trimmed(rule.value)
    if rule.match_type is MatchType.PREFIX:
        return path.startswith(rule.value)
    return _pattern(rule.value).fullmatch(path) is not None


def first_match(rules: Sequence[TierRule], path: str) -> TierRule | None:
    for rule in sorted(rules, key=lambda rule: rule.position):
        if rule_matches(rule, path):
            return rule
    return None
