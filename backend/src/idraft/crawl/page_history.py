"""What changed on a page between two crawls (spec 4.3 and 4.4 of the page history design).

Pure: no I/O. `classify_change` sorts one page's new hashes against its previous check,
`diff_snapshots` lists what differs between two kept snapshots, and `summarize_run` decides,
once per crawl, whether the run was a site-wide template change and whether the declared dates
of the site can be trusted.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Final, Literal

from idraft.crawl.page_text import Heading

CheckKind = Literal["first", "content", "template_candidate", "same"]
ChangeType = Literal[
    "title", "description", "heading_added", "heading_removed", "words", "links", "edited"
]

SITE_WIDE_MIN_PAGES: Final = 20
SITE_WIDE_SHARE: Final = 0.5
DECLARED_MIN_PAGES: Final = 20
DECLARED_SAME_DAY_SHARE: Final = 0.5
WORDS_MIN_DELTA: Final = 20
WORDS_MIN_SHARE: Final = 0.05


@dataclass(frozen=True, slots=True)
class Snapshot:
    title: str | None
    description: str | None
    headings: tuple[Heading, ...]
    words: int
    links_all: int
    links_editorial: int
    canonical: str | None
    main_hash: bytes
    full_hash: bytes


@dataclass(frozen=True, slots=True)
class Change:
    """One line of a page's change list. `level` is for headings. For "links", `before` is
    "all" or "editorial" (which count moved) and `delta` is the signed difference; for "words"
    `delta` is the signed difference in words."""

    type: ChangeType
    level: int | None
    before: str | None
    after: str | None
    delta: int | None


@dataclass(frozen=True, slots=True)
class RunSummary:
    site_wide: bool
    declared_unreliable: bool


def classify_change(
    previous: tuple[bytes, bytes] | None, current: tuple[bytes, bytes]
) -> CheckKind:
    """Both arguments are (main_hash, full_hash); `previous` is None on a page's first check."""
    if previous is None:
        return "first"
    if previous[0] != current[0]:
        return "content"
    return "template_candidate" if previous[1] != current[1] else "same"


def _words_moved(before: int, after: int) -> bool:
    gap = abs(after - before)
    return gap >= WORDS_MIN_DELTA and gap >= WORDS_MIN_SHARE * before


def _heading_changes(before: tuple[Heading, ...], after: tuple[Heading, ...]) -> list[Change]:
    """A heading whose text changed is one removed and one added; repeats are matched one to one."""
    gone, new = Counter(before) - Counter(after), Counter(after) - Counter(before)
    changes: list[Change] = []
    for heading in before:
        if gone[heading] > 0:
            gone[heading] -= 1
            changes.append(Change("heading_removed", heading.level, heading.text, None, None))
    for heading in after:
        if new[heading] > 0:
            new[heading] -= 1
            changes.append(Change("heading_added", heading.level, None, heading.text, None))
    return changes


def diff_snapshots(before: Snapshot, after: Snapshot) -> list[Change]:
    """Changes in the order of spec 4.4. Empty when the main text is the same; a changed main
    text with nothing else to list reads as one "edited" change (text edited in place)."""
    if before.main_hash == after.main_hash:
        return []
    changes: list[Change] = []
    if before.title != after.title:
        changes.append(Change("title", None, before.title, after.title, None))
    if before.description != after.description:
        changes.append(Change("description", None, before.description, after.description, None))
    changes += _heading_changes(before.headings, after.headings)
    if _words_moved(before.words, after.words):
        changes.append(Change("words", None, None, None, after.words - before.words))
    for kind, old, now in (
        ("all", before.links_all, after.links_all),
        ("editorial", before.links_editorial, after.links_editorial),
    ):
        if old != now:
            changes.append(Change("links", None, kind, None, now - old))
    return changes or [Change("edited", None, None, None, None)]


def summarize_run(
    compared: int, template_candidates: int, declared_days: Mapping[date, int]
) -> RunSummary:
    """`declared_days` counts the pages of the run per declared calendar day (UTC)."""
    declared = sum(declared_days.values())
    return RunSummary(
        site_wide=compared >= SITE_WIDE_MIN_PAGES
        and template_candidates >= SITE_WIDE_SHARE * compared,
        declared_unreliable=declared >= DECLARED_MIN_PAGES
        and max(declared_days.values()) >= DECLARED_SAME_DAY_SHARE * declared,
    )
