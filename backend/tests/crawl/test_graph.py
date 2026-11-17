"""Click depth and internal PageRank on small graphs with known answers (spec 6.4 and 11;
plan decision D12)."""

import pytest

from idraft.crawl.graph import (
    MAX_ROUNDS,
    Link,
    Node,
    click_depths,
    deep_only_through_auto,
    pagerank,
    template_roots,
)
from idraft.crawl.scopes import LinkScope

E, A, T = LinkScope.EDITORIAL, LinkScope.AUTO_GENERATED, LinkScope.TEMPLATE


def _nodes(*items: tuple[int, int] | tuple[int, int, int]) -> dict[int, Node]:
    nodes = {}
    for item in items:
        url_id, status, *redirect = item
        nodes[url_id] = Node(url_id, status, redirect[0] if redirect else None)
    return nodes


def _link(source: int, target: int, scope: LinkScope = E, *, followed: bool = True) -> Link:
    return Link(source, target, scope, followed)


def test_depth_counts_clicks_and_a_redirect_is_a_hop() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 301, 4), (4, 200), (5, 200))
    links = [_link(1, 2), _link(2, 3), _link(1, 5, followed=False)]

    depths = click_depths(1, nodes, links)

    assert depths == {1: 0, 2: 1, 3: 2, 4: 3}


def test_depth_without_auto_generated_links_leaves_them_out() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200))
    links = [_link(1, 2, T), _link(2, 3, A), _link(1, 3, A)]

    assert click_depths(1, nodes, links) == {1: 0, 2: 1, 3: 1}
    assert click_depths(1, nodes, links, without_auto=True) == {1: 0, 2: 1}


@pytest.mark.parametrize(
    ("depth", "without_auto", "flagged"),
    [(2, None, True), (1, 5, True), (2, 5, False), (12, 12, False), (None, None, False)],
)
def test_deep_only_through_previous_and_next(
    depth: int | None, without_auto: int | None, flagged: bool
) -> None:
    assert deep_only_through_auto(depth, without_auto) is flagged


def test_a_home_page_and_three_leaves_linking_both_ways() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200), (4, 200))
    links = [_link(1, leaf) for leaf in (2, 3, 4)] + [_link(leaf, 1) for leaf in (2, 3, 4)]

    equity = pagerank(nodes, links)

    assert equity.shares[1] == pytest.approx(0.4797297, abs=1e-6)
    for leaf in (2, 3, 4):
        assert equity.shares[leaf] == pytest.approx(0.1734234, abs=1e-6)
    assert sum(equity.shares.values()) == pytest.approx(1.0)
    assert equity.lost_to_errors == 0.0
    assert equity.rounds < MAX_ROUNDS


def test_a_redirect_passes_everything_to_its_target() -> None:
    # 1 links to the redirect 2, which goes to 3; 3 links back to 1.
    nodes = _nodes((1, 200), (2, 301, 3), (3, 200))
    equity = pagerank(nodes, [_link(1, 2), _link(3, 1)])

    for url_id in (1, 2, 3):
        assert equity.shares[url_id] == pytest.approx(1 / 3, abs=1e-6)


def test_a_nofollow_link_counts_in_the_out_degree_and_passes_nothing() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200))
    links = [_link(1, 2), _link(1, 3, followed=False), _link(2, 1), _link(3, 1)]

    equity = pagerank(nodes, links)

    assert equity.shares[1] == pytest.approx(0.5268292, abs=1e-5)
    assert equity.shares[2] == pytest.approx(0.3485366, abs=1e-5)
    assert equity.shares[3] == pytest.approx(0.1246341, abs=1e-5)


def test_an_error_page_keeps_what_it_gets_and_passes_nothing() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 404))
    equity = pagerank(nodes, [_link(1, 2), _link(1, 3), _link(2, 1), _link(3, 1)])

    assert equity.shares[2] == pytest.approx(equity.shares[3])
    assert equity.lost_to_errors == pytest.approx(equity.shares[3])
    assert equity.lost_to_errors == pytest.approx(0.3031935, abs=1e-5)
    assert sum(equity.shares.values()) == pytest.approx(1.0)


def test_a_page_with_no_links_out_spreads_its_value() -> None:
    equity = pagerank(_nodes((1, 200), (2, 200)), [_link(1, 2)])

    assert equity.shares[1] == pytest.approx(0.5 / 1.425, abs=1e-6)
    assert equity.shares[2] == pytest.approx(1 - 0.5 / 1.425, abs=1e-6)


def test_every_link_of_a_pair_counts_once_and_self_links_never() -> None:
    once = pagerank(_nodes((1, 200), (2, 200)), [_link(1, 2), _link(2, 1)])
    twice = pagerank(
        _nodes((1, 200), (2, 200)),
        [_link(1, 2), _link(1, 2, T), _link(1, 1), _link(2, 1)],
    )
    assert twice.shares == pytest.approx(once.shares)


def test_a_target_that_was_not_crawled_is_a_node() -> None:
    equity = pagerank(_nodes((1, 200)), [_link(1, 9)])
    assert set(equity.shares) == {1, 9}


def test_nothing_to_rank() -> None:
    equity = pagerank({}, [])
    assert (equity.shares, equity.lost_to_errors, equity.rounds) == ({}, 0.0, 0)


def _header(sources: range | list[int], *targets: int) -> list[Link]:
    return [_link(source, target, T) for source in sources for target in targets]


def test_a_refused_start_page_gets_the_header_targets_of_the_pages_served() -> None:
    # 1 is the start page and answered 403; 2 to 5 carry a header with 8 and 9, which are served
    # pages too: 4 of the 6 served pages carry each of them.
    nodes = _nodes((1, 403), *[(url_id, 200) for url_id in (2, 3, 4, 5, 8, 9)])
    links = [*_header(range(2, 6), 8, 9), _link(2, 3)]

    assert template_roots(1, nodes, links) == {8, 9}


def test_exactly_half_of_the_served_pages_is_not_more_than_half() -> None:
    nodes = _nodes((1, 403), *[(url_id, 200) for url_id in (2, 3, 4, 5)])

    assert template_roots(1, nodes, _header([2, 3], 9)) == frozenset()
    assert template_roots(1, nodes, _header([2, 3, 4], 9)) == {9}


def test_only_followed_template_links_of_served_pages_count() -> None:
    nodes = _nodes((1, 403), (2, 200), (3, 200), (4, 404))
    links = [
        _link(2, 7, A),
        _link(3, 7, A),
        _link(2, 8, E),
        _link(3, 8, E),
        _link(2, 9, T, followed=False),
        _link(3, 9, T, followed=False),
        # A page that was not served says nothing about the site's template.
        _link(4, 6, T),
    ]

    assert template_roots(1, nodes, links) == frozenset()


def test_pages_with_no_template_links_give_no_roots() -> None:
    nodes = _nodes((1, 403), (2, 200), (3, 200))

    assert template_roots(1, nodes, []) == frozenset()


def test_a_one_page_site_whose_start_page_is_refused_has_no_roots() -> None:
    assert template_roots(1, _nodes((1, 403)), []) == frozenset()


def test_a_start_page_missing_from_the_crawl_gets_the_roots_too() -> None:
    nodes = _nodes((2, 200), (3, 200), (4, 200))

    assert template_roots(1, nodes, _header(range(2, 5), 5)) == {5}


def test_a_start_page_that_answers_with_no_links_gets_the_roots() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200))

    assert template_roots(1, nodes, _header([2, 3], 4)) == {4}


def test_a_readable_start_page_gets_nothing() -> None:
    nodes = _nodes((1, 200), (2, 200), (3, 200))
    links = [*_header([2, 3], 4), _link(1, 2)]

    assert template_roots(1, nodes, links) == frozenset()


def test_a_start_page_that_redirects_gets_nothing() -> None:
    nodes = _nodes((1, 301, 2), (2, 200), (3, 200))

    assert template_roots(1, nodes, _header([2, 3], 4)) == frozenset()


def test_the_roots_make_pages_reachable_without_being_links_of_the_start_page() -> None:
    nodes = _nodes((1, 403), (2, 200), (3, 200), (4, 200), (5, 200))
    links = [*_header([2, 3, 4], 2, 3), _link(2, 4), _link(3, 5)]

    assert click_depths(1, nodes, links) == {1: 0}
    virtual = [_link(1, root, T) for root in template_roots(1, nodes, links)]
    assert click_depths(1, nodes, [*links, *virtual]) == {1: 0, 2: 1, 3: 1, 4: 2, 5: 2}
