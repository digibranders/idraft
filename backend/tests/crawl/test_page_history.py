"""Change classification, the change list and the run summary (spec 4.3 and 4.4)."""

from __future__ import annotations

from dataclasses import replace
from datetime import date

from idraft.crawl.page_history import (
    SITE_WIDE_MIN_PAGES,
    Change,
    Snapshot,
    classify_change,
    diff_snapshots,
    summarize_run,
)
from idraft.crawl.page_text import Heading

M1, M2, F1, F2 = b"m1", b"m2", b"f1", b"f2"

BASE = Snapshot(
    title="Title",
    description="Desc",
    headings=(Heading(1, "Top"), Heading(2, "Sub")),
    words=1000,
    links_all=10,
    links_editorial=4,
    canonical="https://example.com/a",
    main_hash=M1,
    full_hash=F1,
)


def test_classify_change() -> None:
    assert classify_change(None, (M1, F1)) == "first"
    assert classify_change((M1, F1), (M2, F1)) == "content"
    assert classify_change((M1, F1), (M2, F2)) == "content"
    assert classify_change((M1, F1), (M1, F2)) == "template_candidate"
    assert classify_change((M1, F1), (M1, F1)) == "same"


def test_diff_title_description() -> None:
    after = replace(BASE, main_hash=M2, title="New", description=None)
    assert diff_snapshots(BASE, after) == [
        Change("title", None, "Title", "New", None),
        Change("description", None, "Desc", None, None),
    ]
    added = replace(BASE, main_hash=M2, title="Title", description="Desc", canonical=None)
    assert diff_snapshots(replace(BASE, description=None), added) == [
        Change("description", None, None, "Desc", None)
    ]


def test_diff_headings_renamed_is_removed_plus_added() -> None:
    after = replace(BASE, main_hash=M2, headings=(Heading(1, "Top"), Heading(2, "Renamed")))
    assert diff_snapshots(BASE, after) == [
        Change("heading_removed", 2, "Sub", None, None),
        Change("heading_added", 2, None, "Renamed", None),
    ]


def test_diff_words_needs_five_percent_and_twenty_words() -> None:
    def words(n: int) -> list[Change]:
        return [
            c
            for c in diff_snapshots(BASE, replace(BASE, main_hash=M2, words=n))
            if c.type == "words"
        ]

    assert words(1050) == [Change("words", None, None, None, 50)]
    assert words(940) == [Change("words", None, None, None, -60)]
    assert words(1049) == []  # under 5 %
    small = replace(BASE, words=100)
    assert [c.type for c in diff_snapshots(small, replace(small, main_hash=M2, words=119))] == [
        "edited"
    ]  # 19 words is not enough even though it is 19 %
    assert [c.type for c in diff_snapshots(small, replace(small, main_hash=M2, words=120))] == [
        "words"
    ]


def test_diff_links_all_and_editorial_separately() -> None:
    after = replace(BASE, main_hash=M2, links_all=12, links_editorial=3)
    assert diff_snapshots(BASE, after) == [
        Change("links", None, "all", None, 2),
        Change("links", None, "editorial", None, -1),
    ]
    only_editorial = replace(BASE, main_hash=M2, links_editorial=5)
    assert diff_snapshots(BASE, only_editorial) == [Change("links", None, "editorial", None, 1)]


def test_diff_edited_in_place_and_no_change() -> None:
    assert diff_snapshots(BASE, replace(BASE, main_hash=M2)) == [
        Change("edited", None, None, None, None)
    ]
    assert diff_snapshots(BASE, replace(BASE, full_hash=F2)) == []
    assert diff_snapshots(BASE, BASE) == []


def test_diff_order() -> None:
    after = replace(
        BASE,
        main_hash=M2,
        title="T2",
        description="D2",
        headings=(Heading(1, "Top"),),
        words=2000,
        links_all=11,
    )
    assert [c.type for c in diff_snapshots(BASE, after)] == [
        "title",
        "description",
        "heading_removed",
        "words",
        "links",
    ]


def test_summarize_run_site_wide() -> None:
    assert not summarize_run(19, 19, {}).site_wide
    assert not summarize_run(SITE_WIDE_MIN_PAGES, 9, {}).site_wide
    assert summarize_run(SITE_WIDE_MIN_PAGES, 10, {}).site_wide
    assert summarize_run(100, 100, {}).site_wide
    assert not summarize_run(0, 0, {}).site_wide


def test_summarize_run_declared_unreliable() -> None:
    day = date(2026, 1, 5)
    other = date(2026, 1, 6)
    assert not summarize_run(0, 0, {day: 19}).declared_unreliable  # too few pages declare
    assert summarize_run(0, 0, {day: 20}).declared_unreliable
    assert summarize_run(0, 0, {day: 10, other: 10}).declared_unreliable  # exactly 50 %
    assert not summarize_run(0, 0, {day: 9, other: 10, date(2026, 1, 7): 10}).declared_unreliable


def test_same_day_different_minutes_is_unreliable() -> None:
    from collections import Counter
    from datetime import UTC

    from idraft.crawl.declared_dates import declared_of

    days: Counter[date] = Counter()
    for minute in range(25):
        html = (
            '<script type="application/ld+json">'
            f'{{"dateModified":"2026-01-05T10:{minute:02d}:00Z"}}</script>'
        )
        found = declared_of(html, None)
        assert found is not None
        days[found.at.astimezone(UTC).date()] += 1
    assert summarize_run(25, 0, days).declared_unreliable
    assert date(2026, 1, 5) in days
