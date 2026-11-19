from __future__ import annotations

from idraft.crawl.anchors import (
    GENERIC_ANCHORS,
    anchor_stats,
    clean_anchor,
    is_generic,
    mostly_generic,
)


def test_quotes_and_spaces_around_an_anchor_are_dropped() -> None:
    assert clean_anchor('  "Read more" ') == "Read more"
    assert clean_anchor("“See plans”") == "See plans"


def test_generic_anchors_are_matched_without_case() -> None:
    assert is_generic("Click HERE")
    assert is_generic("  read more ")
    assert not is_generic("SOC as a service")
    assert "click here" in GENERIC_ANCHORS


def test_anchors_group_without_case_and_sort_by_count_then_text() -> None:
    stats = anchor_stats(
        ["SOC", "soc", "MDR", "here", "here", "here", "Alpha"], keywords=[], limit=3
    )
    assert stats.total == 7
    assert stats.distinct == 4
    assert [(row.text, row.count, row.generic) for row in stats.top] == [
        ("here", 3, True),
        ("SOC", 2, False),
        ("Alpha", 1, False),
    ]
    assert stats.generic_count == 3
    assert round(stats.generic_share, 3) == round(3 / 7, 3)


def test_matches_keyword_is_unknown_without_keywords() -> None:
    assert anchor_stats(["SOC"], keywords=[]).matches_keyword is None


def test_an_anchor_inside_a_keyword_or_around_one_matches_but_a_generic_one_does_not() -> None:
    assert anchor_stats(["soc"], keywords=["soc as a service"]).matches_keyword is True
    assert anchor_stats(["best managed soc provider"], keywords=["managed soc"]).matches_keyword
    assert anchor_stats(["here"], keywords=["here"]).matches_keyword is False
    assert anchor_stats(["pricing"], keywords=["soc"]).matches_keyword is False


def test_an_empty_anchor_never_matches_a_keyword() -> None:
    assert anchor_stats(["", '""'], keywords=["soc"]).matches_keyword is False


def test_mostly_generic_needs_two_links_and_more_than_half() -> None:
    assert mostly_generic(total=4, generic=3)
    assert not mostly_generic(total=4, generic=2)
    assert not mostly_generic(total=1, generic=1)
    assert not mostly_generic(total=0, generic=0)
