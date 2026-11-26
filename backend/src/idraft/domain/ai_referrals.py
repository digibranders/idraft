"""Which GA4 sessions came from an AI assistant, by two classifiers side by side (WP-69).

docs/18-first-party-integrations.md sections 7.3 and 7.4. Each GA4 row is classified twice:

- `ga4_ai_assistant_channel`: GA4 itself put the session in the "AI Assistant" channel group. The
  assistant is the lowercased source and the rules version is 0.
- `own_rules`: our versioned referrer rules (`fp.ai_referrer_rules`). Only `high` confidence rules
  count; an `ambiguous` rule is for the breakdown and never reaches a headline number.

Neither is labelled correct. Both leave out Google AI Overviews and AI Mode (GA4 files them under
organic search). In `own_rules`, `google`, `google.com`, `bing`, `bing.com` and `msn.com` are never
AI, whatever a rule says: such a rule is ignored and such a source drops the row. The GA4 channel
classifier does not apply that guard; it trusts Google's own "AI Assistant" channel group.
Nothing here reads a clock, a database or the network.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Final, Literal

GA4_CHANNEL: Final = "ga4_ai_assistant_channel"
OWN_RULES: Final = "own_rules"
UNKNOWN_ASSISTANT: Final = "unknown"

_AI_CHANNEL_GROUP: Final = "ai assistant"
# What GA4 reports when it does not know a value. They are not hosts and not campaigns.
_UNKNOWN_VALUES: Final = frozenset({"", "(not set)", "(direct)"})
# Cloudflare and GA4 mix classic search with AI behind these (docs/18 section 7.4), so the guard is
# in code and a mistaken rule row cannot count them.
_NEVER_AI: Final = frozenset({"google", "google.com", "bing", "bing.com", "msn.com"})


@dataclass(frozen=True, slots=True)
class Rule:
    """One row of `fp.ai_referrer_rules`."""

    rule_set_version: int
    rule_id: int
    match_field: Literal["referrer_host", "utm_source"]
    match_type: Literal["exact", "suffix"]
    pattern: str
    assistant_code: str
    confidence: Literal["high", "ambiguous"]


@dataclass(frozen=True, slots=True)
class SessionRow:
    """One GA4 report row: a day and one combination of source, medium and channel.

    The four strings are GA4's `sessionSource`, `sessionMedium`, `sessionManualSource` and
    `sessionDefaultChannelGroup`, as reported. GA4 reports "(not set)" for a value it does not have
    and "(direct)" as the source of a session with no referrer.
    """

    day: date
    source: str
    medium: str
    manual_source: str
    channel_group: str
    sessions: int
    engaged_sessions: int
    key_events: Decimal
    revenue: Decimal


@dataclass(frozen=True, slots=True)
class ReferralRow:
    """The sessions of one assistant on one day under one classifier."""

    day: date
    classifier: Literal["ga4_ai_assistant_channel", "own_rules"]
    rules_version: int
    assistant_code: str
    sessions: int
    engaged_sessions: int
    key_events: Decimal
    total_revenue: Decimal


@dataclass(slots=True)
class _Totals:
    sessions: int = 0
    engaged_sessions: int = 0
    key_events: Decimal = Decimal(0)
    total_revenue: Decimal = Decimal(0)


def _norm(value: str) -> str:
    return value.strip().lower()


def _check(row: SessionRow) -> None:
    """A bad number must stop the run: summed as 0 it would be a wrong figure that looks right."""
    for field, count in (("sessions", row.sessions), ("engaged_sessions", row.engaged_sessions)):
        if count < 0:
            raise ValueError(f"{field} must not be negative, got {count} on {row.day}")
    for field, number in (("key_events", row.key_events), ("revenue", row.revenue)):
        if not number.is_finite():
            raise ValueError(f"{field} must be a finite number, got {number} on {row.day}")
    # Revenue can be negative (refunds); a count of events cannot.
    if row.key_events < 0:
        raise ValueError(f"key_events must not be negative, got {row.key_events} on {row.day}")


def _matches(rule: Rule, value: str) -> bool:
    pattern = _norm(rule.pattern)
    if not pattern:
        return False
    if rule.match_type == "exact":
        return value == pattern
    return value == pattern or value.endswith(f".{pattern}")


def _best(rules: Sequence[Rule], field: str, value: str) -> Rule | None:
    """An exact match of the field, else a suffix match, chosen independent of the rules' order.

    Exact: the lowest rule_id. Suffix: the longest pattern (the most specific host), then the
    lowest rule_id.
    """
    if value in _UNKNOWN_VALUES:
        return None
    hits = [r for r in rules if r.match_field == field and _matches(r, value)]
    exact = [r for r in hits if r.match_type == "exact"]
    if exact:
        return min(exact, key=lambda r: r.rule_id)
    suffix = [r for r in hits if r.match_type == "suffix"]
    return min(suffix, key=lambda r: (-len(_norm(r.pattern)), r.rule_id), default=None)


def _own_rule(row: SessionRow, rules: Sequence[Rule]) -> Rule | None:
    """A utm_source match (on the manual source) wins over a referrer host match (the source)."""
    source, manual = _norm(row.source), _norm(row.manual_source)
    # Conservative: a search host on either side drops the row, even if the other side names an
    # assistant, because the session cannot then be told apart from classic search.
    if source in _NEVER_AI or manual in _NEVER_AI:
        return None
    return _best(rules, "utm_source", manual) or _best(rules, "referrer_host", source)


# The sum key: day, classifier, rules version, assistant. The classifier is a plain str here
# because it is used to sort and compare; `ReferralRow` narrows it back to its Literal.
type _Key = tuple[date, str, int, str]


def _add(totals: dict[_Key, _Totals], key: _Key, row: SessionRow) -> None:
    entry = totals.setdefault(key, _Totals())
    entry.sessions += row.sessions
    entry.engaged_sessions += row.engaged_sessions
    entry.key_events += row.key_events
    entry.total_revenue += row.revenue


def classify(rows: Iterable[SessionRow], rules: Sequence[Rule]) -> list[ReferralRow]:
    """The rows of both classifiers, summed per day, classifier and assistant, in a fixed order."""
    versions = {rule.rule_set_version for rule in rules}
    if len(versions) > 1:
        raise ValueError(f"one rule_set_version per run, got {sorted(versions)}")
    version = next(iter(versions), 0)
    # A rule for a search host is dropped whatever its field or type: a suffix rule for google.com
    # would count www.google.com and every other subdomain as AI.
    high = [
        rule for rule in rules if rule.confidence == "high" and _norm(rule.pattern) not in _NEVER_AI
    ]

    totals: dict[_Key, _Totals] = {}
    for row in rows:
        _check(row)
        if _norm(row.channel_group) == _AI_CHANNEL_GROUP:
            source = _norm(row.source)
            code = UNKNOWN_ASSISTANT if source in _UNKNOWN_VALUES else source
            _add(totals, (row.day, GA4_CHANNEL, 0, code), row)
        rule = _own_rule(row, high)
        if rule is not None:
            _add(totals, (row.day, OWN_RULES, version, rule.assistant_code), row)

    return [
        ReferralRow(
            day=day,
            classifier="ga4_ai_assistant_channel" if classifier == GA4_CHANNEL else "own_rules",
            rules_version=rules_version,
            assistant_code=code,
            sessions=entry.sessions,
            engaged_sessions=entry.engaged_sessions,
            key_events=entry.key_events,
            total_revenue=entry.total_revenue,
        )
        for (day, classifier, rules_version, code), entry in sorted(
            totals.items(), key=lambda item: (item[0][0], item[0][1], item[0][3])
        )
    ]
