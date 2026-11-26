"""The Link map's graph: which pages are nodes, how links fold into edges (plan 10, G1 to G6)."""

from __future__ import annotations

import pytest

from idraft.api.internal_links.graph import GraphLink, GraphPage, TemplateLinks, build_graph

HOME, PRICING, BLOG, POST_A, POST_B, OLD, GONE, VARIANT = range(1, 9)


def _pages() -> list[GraphPage]:
    def page(
        url_id: int,
        path: str,
        status: int = 200,
        redirect: int | None = None,
        variant_of: int | None = None,
    ) -> GraphPage:
        return GraphPage(url_id, path, None, status, redirect, variant_of, None)

    return [
        page(HOME, "/"),
        page(PRICING, "/pricing"),
        page(BLOG, "/blog"),
        page(POST_A, "/blog/a"),
        page(POST_B, "/blog/b"),
        page(OLD, "/old", 301, redirect=PRICING),
        page(GONE, "/gone", 404),
        page(VARIANT, "/blog/a?x=1", variant_of=POST_A),
    ]


def _links() -> list[GraphLink]:
    return [
        GraphLink(BLOG, POST_A, 1),
        GraphLink(BLOG, POST_B, 2),
        GraphLink(POST_A, PRICING, 1),
        GraphLink(PRICING, POST_A, 1),
        GraphLink(POST_B, OLD, 1),
        GraphLink(POST_B, GONE, 1),
        GraphLink(POST_A, POST_A, 1),
        GraphLink(VARIANT, PRICING, 1),
    ]


def test_only_live_pages_that_count_are_nodes() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=100)

    assert {node.url_id for node in graph.nodes} == {HOME, PRICING, BLOG, POST_A, POST_B}
    assert graph.pages_total == 5
    assert graph.truncated is False
    assert graph.home_url_id == HOME


def test_a_link_to_a_redirect_is_a_link_to_the_page_it_leads_to() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=100)

    edges = {(edge.source, edge.target): edge.links for edge in graph.edges}
    assert edges == {
        (BLOG, POST_A): 1,
        (BLOG, POST_B): 2,
        (POST_A, PRICING): 1,
        (PRICING, POST_A): 1,
        (POST_B, PRICING): 1,
    }


def test_counts_are_edges_in_and_out_after_the_fold() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=100)

    counts = {node.url_id: (node.links_in, node.links_out) for node in graph.nodes}
    assert counts == {
        HOME: (0, 0),
        PRICING: (2, 1),
        BLOG: (0, 2),
        POST_A: (2, 1),
        POST_B: (1, 1),
    }


def test_two_links_that_fold_onto_one_pair_add_up() -> None:
    links = [GraphLink(POST_B, OLD, 1), GraphLink(POST_B, PRICING, 3)]

    graph = build_graph(_pages(), links, [], home_url_id=HOME, max_pages=100)

    edges = [(edge.source, edge.target, edge.links) for edge in graph.edges]
    assert edges == [(POST_B, PRICING, 4)]


def test_a_redirect_chain_is_followed_and_a_loop_ends() -> None:
    pages = [
        GraphPage(1, "/a", None, 301, 2, None, None),
        GraphPage(2, "/b", None, 301, 3, None, None),
        GraphPage(3, "/c", None, 200, None, None, None),
        GraphPage(4, "/loop-1", None, 301, 5, None, None),
        GraphPage(5, "/loop-2", None, 301, 4, None, None),
        GraphPage(6, "/from", None, 200, None, None, None),
    ]
    links = [GraphLink(6, 1, 1), GraphLink(6, 4, 1)]

    graph = build_graph(pages, links, [], home_url_id=None, max_pages=100)

    assert [(edge.source, edge.target) for edge in graph.edges] == [(6, 3)]


def test_a_page_in_the_menu_of_at_least_half_the_pages_is_sitewide() -> None:
    template = [
        TemplateLinks(HOME, PRICING),
        TemplateLinks(BLOG, PRICING),
        TemplateLinks(POST_A, PRICING),
        TemplateLinks(HOME, BLOG),
        TemplateLinks(POST_A, BLOG),
        TemplateLinks(POST_B, OLD),
    ]

    graph = build_graph(_pages(), _links(), template, home_url_id=HOME, max_pages=100)

    sitewide = {node.url_id: node.sitewide_from for node in graph.nodes}
    # 5 nodes: half is 2.5. /old leads to /pricing, so its one page is added to /pricing's three.
    assert sitewide == {HOME: 0, PRICING: 4, BLOG: 0, POST_A: 0, POST_B: 0}


def test_sitewide_counts_distinct_pages_and_never_the_page_itself() -> None:
    # 4 nodes: the floor is 2. The home page links /pricing and the redirect to it: one page.
    # /pricing linking itself from its own menu is not a page that links to it.
    template = [
        TemplateLinks(HOME, PRICING),
        TemplateLinks(HOME, OLD),
        TemplateLinks(PRICING, PRICING),
        TemplateLinks(GONE, PRICING),
    ]
    pages = [p for p in _pages() if p.url_id != POST_B]

    graph = build_graph(pages, [], template, home_url_id=HOME, max_pages=100)

    assert {node.url_id: node.sitewide_from for node in graph.nodes}[PRICING] == 0


def test_a_page_with_exactly_half_the_pages_is_sitewide() -> None:
    template = [TemplateLinks(HOME, BLOG), TemplateLinks(PRICING, BLOG)]
    pages = [p for p in _pages() if p.url_id in {HOME, PRICING, BLOG, POST_A}]

    graph = build_graph(pages, [], template, home_url_id=HOME, max_pages=100)

    assert {node.url_id: node.sitewide_from for node in graph.nodes}[BLOG] == 2


def test_a_link_to_a_variant_or_to_a_redirect_to_a_variant_lands_on_the_canonical_page() -> None:
    pages = [*_pages(), GraphPage(9, "/older", None, 301, VARIANT, None, None)]
    links = [GraphLink(HOME, VARIANT, 1), GraphLink(BLOG, 9, 1)]

    graph = build_graph(pages, links, [], home_url_id=VARIANT, max_pages=100)

    assert {(edge.source, edge.target) for edge in graph.edges} == {(HOME, POST_A), (BLOG, POST_A)}
    assert graph.home_url_id == POST_A


def test_five_redirect_hops_resolve_and_six_do_not() -> None:
    def chain(hops: int) -> list[GraphPage]:
        redirects = [
            GraphPage(i, f"/r{i}", None, 301, i + 1, None, None) for i in range(1, hops + 1)
        ]
        return [
            *redirects,
            GraphPage(hops + 1, "/end", None, 200, None, None, None),
            GraphPage(100, "/from", None, 200, None, None, None),
        ]

    five = build_graph(chain(5), [GraphLink(100, 1, 1)], [], home_url_id=None, max_pages=100)
    six = build_graph(chain(6), [GraphLink(100, 1, 1)], [], home_url_id=None, max_pages=100)

    assert [(edge.source, edge.target) for edge in five.edges] == [(100, 6)]
    assert six.edges == []


def test_a_start_page_the_cap_left_out_is_null() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=3)

    assert graph.home_url_id is None


def test_max_pages_below_one_is_refused() -> None:
    with pytest.raises(ValueError, match="max_pages"):
        build_graph(_pages(), [], [], home_url_id=None, max_pages=0)


def test_over_the_cap_the_pages_with_the_most_edges_stay() -> None:
    graph = build_graph(_pages(), _links(), [], home_url_id=HOME, max_pages=3)

    assert [node.url_id for node in graph.nodes] == [PRICING, POST_A, BLOG]
    assert graph.pages_total == 5
    assert graph.truncated is True
    assert {(edge.source, edge.target) for edge in graph.edges} == {
        (BLOG, POST_A),
        (POST_A, PRICING),
        (PRICING, POST_A),
    }
    # The counts of a kept page are still its real counts
    assert next(node for node in graph.nodes if node.url_id == BLOG).links_out == 2


def test_the_start_page_is_named_through_a_redirect_and_dropped_when_not_a_node() -> None:
    assert build_graph(_pages(), [], [], home_url_id=OLD, max_pages=100).home_url_id == PRICING
    assert build_graph(_pages(), [], [], home_url_id=GONE, max_pages=100).home_url_id is None
