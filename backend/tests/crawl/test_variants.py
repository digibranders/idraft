"""Folding a graph whose variants are known: nodes gone, links redirected to the canonical page
(plan 09)."""

from idraft.crawl.graph import Link, Node, click_depths, pagerank
from idraft.crawl.scopes import LinkScope
from idraft.crawl.variants import fold_variants

E = LinkScope.EDITORIAL


def _link(source: int, target: int) -> Link:
    return Link(source, target, E, True)


def test_a_variant_loses_its_node_and_its_links_out_and_links_in_follow_its_canonical() -> None:
    # 1 home, 2 /demo, 3 /demo?source=a (variant of 2), 4 /blog
    nodes = {n: Node(n, 200) for n in (1, 2, 3, 4)}
    links = [_link(1, 3), _link(1, 4), _link(3, 4), _link(4, 3), _link(4, 2)]

    kept, folded = fold_variants(nodes, links, {3: 2})

    assert set(kept) == {1, 2, 4}
    assert folded == [_link(1, 2), _link(1, 4), _link(4, 2), _link(4, 2)]


def test_a_link_between_a_page_and_its_own_variant_is_dropped() -> None:
    nodes = {n: Node(n, 200) for n in (1, 2)}

    _, folded = fold_variants(nodes, [_link(1, 2), _link(2, 1)], {2: 1})

    assert folded == []


def test_a_redirect_to_a_variant_points_at_its_canonical_page() -> None:
    nodes = {1: Node(1, 200), 2: Node(2, 200), 3: Node(3, 301, 2)}

    kept, _ = fold_variants(nodes, [], {2: 1})

    assert kept[3].redirect_to == 1


def test_no_variants_changes_nothing() -> None:
    nodes = {1: Node(1, 200), 2: Node(2, 200)}
    links = [_link(1, 2), _link(2, 2)]

    kept, folded = fold_variants(nodes, links, {})

    assert kept == nodes
    # A page linking to itself is the graph's to ignore; only a fold removes it.
    assert folded == [_link(1, 2), _link(2, 2)]


def test_depth_and_equity_see_the_folded_graph() -> None:
    # Home reaches /demo only through a tracking URL; folded, /demo is one click away and the
    # tracking URL is no page.
    nodes = {n: Node(n, 200) for n in (1, 2, 3)}
    links = [_link(1, 3), _link(3, 2)]

    kept, folded = fold_variants(nodes, links, {3: 2})

    assert click_depths(1, kept, folded) == {1: 0, 2: 1}
    assert set(pagerank(kept, folded).shares) == {1, 2}
