"""The template pass run over a crawl's stored candidate links (spec 6.3; decision D19). The
rule is plan 01's `place_links`; these tests check that stored rows reach it and come back."""

from __future__ import annotations

import pytest

from idraft.crawl.placement import MIN_FOLDER_PAGES
from idraft.crawl.template import TemplateRow, template_placements

SITE = "https://example.com"


def _rows(
    container: int, targets_by_page: dict[str, list[str]], placement: str = "content"
) -> list[TemplateRow]:
    rows: list[TemplateRow] = []
    for page, targets in targets_by_page.items():
        for target in targets:
            rows.append(
                TemplateRow(
                    link_id=len(rows) + container * 1000,
                    source_url=f"{SITE}{page}",
                    target_url=f"{SITE}{target}",
                    container=container,
                    placement=placement,
                )
            )
    return rows


POSTS = [f"/blog/post-{n}" for n in range(1, 7)]
PAGES = [f"{SITE}{post}" for post in POSTS]


def test_an_unmarked_menu_with_the_same_links_on_every_page_is_navigation() -> None:
    menu = ["/blog/post-1", "/blog/post-2", "/blog/post-3"]
    rows = _rows(7, {post: [t for t in menu if t != post] for post in POSTS})

    placements = template_placements(rows, PAGES)

    assert set(placements.values()) == {"navigation"}
    assert len(placements) == len(rows)


def test_a_related_block_of_three_changing_links_is_auto_generated() -> None:
    related = {post: [f"/x/{post}-{n}" for n in range(3)] for post in POSTS}

    placements = template_placements(_rows(8, related), PAGES)

    assert set(placements.values()) == {"auto_generated"}


def test_prose_with_changing_links_stays_content() -> None:
    prose = {
        post: [f"/x/{post}-{n}" for n in range(index % 3 + 1)] for index, post in enumerate(POSTS)
    }

    assert template_placements(_rows(9, prose), PAGES) == {}


def test_a_small_folder_is_left_to_the_first_pass() -> None:
    few = POSTS[: MIN_FOLDER_PAGES - 1]
    rows = _rows(7, {post: ["/a", "/b"] for post in few})

    assert template_placements(rows, [f"{SITE}{post}" for post in few]) == {}


def test_an_open_link_no_block_claims_stays_auto_generated_and_unchanged() -> None:
    rows = _rows(10, {POSTS[0]: ["/a"]}, placement="auto_generated")

    assert template_placements(rows, PAGES) == {}


def test_pages_without_candidates_count_toward_the_folder_share() -> None:
    menu = ["/a", "/b"]
    on_two = _rows(7, dict.fromkeys(POSTS[:2], menu))

    assert template_placements(on_two, PAGES) == {}
    assert template_placements(on_two, PAGES[:4]) != {}


def test_a_source_page_missing_from_the_page_list_still_takes_part() -> None:
    menu = ["/a", "/b"]
    rows = _rows(7, dict.fromkeys(POSTS, menu))

    assert template_placements(rows, []) == template_placements(rows, PAGES)


def test_open_auto_generated_rows_that_a_menu_block_covers_become_navigation() -> None:
    menu = ["/blog/post-1", "/blog/post-2", "/blog/post-3"]
    rows = _rows(
        7, {post: [t for t in menu if t != post] for post in POSTS}, placement="auto_generated"
    )

    placements = template_placements(rows, PAGES)

    assert set(placements.values()) == {"navigation"}
    assert len(placements) == len(rows)


def test_two_containers_on_the_same_pages_are_placed_apart() -> None:
    menu = _rows(7, {post: ["/a", "/b"] for post in POSTS})
    related = _rows(8, {post: [f"/x/{post}-{n}" for n in range(3)] for post in POSTS})

    placements = template_placements(menu + related, PAGES)

    assert {placements[row.link_id] for row in menu} == {"navigation"}
    assert {placements[row.link_id] for row in related} == {"auto_generated"}


def test_no_rows_and_no_pages_give_nothing() -> None:
    assert template_placements([], []) == {}


def test_a_stored_placement_that_is_not_one_raises_a_value_error() -> None:
    row = TemplateRow(1, f"{SITE}/a", f"{SITE}/b", 1, "sidebar-ish")

    with pytest.raises(ValueError, match="sidebar-ish"):
        template_placements([row], [row.source_url])


def test_a_hundred_thousand_links_are_placed_in_one_pass() -> None:
    posts = [f"/blog/post-{n}" for n in range(1_000)]
    menu = [f"/menu/item-{n}" for n in range(100)]
    rows = _rows(7, dict.fromkeys(posts, menu))
    assert len(rows) == 100_000

    placements = template_placements(rows, [f"{SITE}{post}" for post in posts])

    assert len(placements) == 100_000
    assert set(placements.values()) == {"navigation"}
