"""Anchor texts pointing at a page (spec 7.10): how many are different, how many are generic
words such as "click here", and whether a descriptive one holds a tracked keyword. Pure; the
mock's `anchorStats` in `apps/web/design-preview/il-model.js` is the reference."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final

GENERIC_ANCHORS: Final = frozenset(
    {
        "click here",
        "read more",
        "learn more",
        "here",
        "this",
        "more",
        "link",
        "see more",
        "find out more",
        "details",
    }
)
# More than half of the editorial anchors, with at least two links (spec 7.10).
GENERIC_SHARE_MIN: Final = 0.5
GENERIC_MIN_LINKS: Final = 2
_QUOTES: Final = "\"'“‘”’"  # noqa: RUF001  (straight and curly quotes on purpose)


def clean_anchor(text: str) -> str:
    """The anchor without spaces and quotes around it."""
    return text.strip().strip(_QUOTES).strip()


def is_generic(text: str) -> bool:
    return clean_anchor(text).lower() in GENERIC_ANCHORS


@dataclass(frozen=True, slots=True)
class AnchorGroup:
    text: str
    count: int
    generic: bool


@dataclass(frozen=True, slots=True)
class AnchorStats:
    total: int
    distinct: int
    generic_count: int
    generic_share: float
    top: list[AnchorGroup]
    # None when the page has no tracked keywords: nothing to match.
    matches_keyword: bool | None


def mostly_generic(total: int, generic: int) -> bool:
    return total >= GENERIC_MIN_LINKS and generic / total > GENERIC_SHARE_MIN


def anchor_stats(anchors: Iterable[str], keywords: Sequence[str], *, limit: int = 5) -> AnchorStats:
    """Every link counts, not one per linking page. Texts group without letter case; the first
    spelling seen is the one shown."""
    groups: dict[str, AnchorGroup] = {}
    for raw in anchors:
        text = clean_anchor(raw)
        key = text.lower()
        seen = groups.get(key)
        groups[key] = AnchorGroup(
            text=seen.text if seen else text,
            count=(seen.count if seen else 0) + 1,
            generic=key in GENERIC_ANCHORS,
        )
    rows = sorted(groups.values(), key=lambda row: (-row.count, row.text.lower()))
    total = sum(row.count for row in rows)
    generic = sum(row.count for row in rows if row.generic)
    wanted = [word.lower() for word in keywords]
    matches: bool | None = None
    if wanted:
        matches = any(
            row.text
            and not row.generic
            and any(word in row.text.lower() or row.text.lower() in word for word in wanted)
            for row in rows
        )
    return AnchorStats(
        total=total,
        distinct=len(rows),
        generic_count=generic,
        generic_share=generic / total if total else 0.0,
        top=rows[:limit],
        matches_keyword=matches,
    )
