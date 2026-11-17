"""The edges one crawled page gives (spec 6.3; plan decision D7)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Literal

import pytest

import idraft.crawl.edges as edges_module
from idraft.crawl.edges import ANCHOR_MAX, PageEdge, container_hash, page_edges
from idraft.crawl.hosts import site_hosts
from idraft.crawl.placement import FoundLink, Placement, classify
from idraft.crawl.scopes import PLACEMENTS, LinkScope
from idraft.extraction.urls import canonicalize

PAGE = canonicalize("https://example.com/blog/post-b")
HOSTS = site_hosts("example.com", [])


def _found(
    href: str,
    placement: Placement = Placement.CONTENT,
    *,
    anchor: str = "Read",
    rel: frozenset[str] = frozenset(),
    kind: Literal["text", "image"] = "text",
    container: str = "main>div.body",
    open_: bool = False,
) -> FoundLink:
    return FoundLink(
        href=href,
        anchor=anchor,
        kind=kind,
        rel=rel,
        placement=placement,
        container=container,
        open=open_,
    )


def _edges(*links: FoundLink) -> list[PageEdge]:
    return page_edges(list(links), page=PAGE, hosts=HOSTS)


def test_the_placements_of_the_classifier_are_the_stored_ones() -> None:
    assert {str(placement) for placement in Placement} == set(PLACEMENTS)


def test_the_sources_hold_no_raw_non_ascii_characters() -> None:
    # Invisible and bidi characters are written as escapes so a reader can see them.
    assert Path(edges_module.__file__).read_text(encoding="utf-8").isascii()
    assert Path(__file__).read_text(encoding="utf-8").isascii()


def test_links_are_kept_when_internal_and_counted_once_per_placement_and_anchor() -> None:
    edges = page_edges(
        [
            _found("https://example.com/pricing", anchor="See  plans"),
            _found("https://example.com/pricing?utm_source=menu", anchor="See plans"),
            _found("https://example.com/pricing", Placement.NAVIGATION, anchor="Pricing"),
            _found("https://other.example.org/x"),
            _found("https://example.com/blog/post-b#comments"),
            _found("mailto:hello@example.com"),
        ],
        page=PAGE,
        hosts=HOSTS,
    )

    found = {(edge.target.path, edge.placement, edge.anchor, edge.occurrences) for edge in edges}
    assert found == {
        ("/pricing", "content", "See plans", 2),
        ("/pricing", "navigation", "Pricing", 1),
    }
    scopes = {edge.placement: edge.scope for edge in edges}
    assert scopes == {"content": LinkScope.EDITORIAL, "navigation": LinkScope.TEMPLATE}


def test_a_cloudflare_internal_link_is_not_a_page() -> None:
    edges = _edges(
        _found("https://example.com/cdn-cgi/l/email-protection#9f8e8d", anchor="[email protected]"),
        _found("https://example.com/CDN-CGI/trace"),
        _found("https://example.com/pricing"),
        _found("https://example.com/blog/cdn-cgi/guide"),
        _found("https://example.com/cdn-cgi-guide"),
    )

    assert [edge.target.path for edge in edges] == [
        "/pricing",
        "/blog/cdn-cgi/guide",
        "/cdn-cgi-guide",
    ]


def test_nofollow_image_anchors_and_template_candidates() -> None:
    (image,) = _edges(
        _found("https://example.com/a", anchor="Logo", kind="image", rel=frozenset({"nofollow"}))
    )
    (open_link,) = _edges(_found("https://example.com/b", Placement.AUTO_GENERATED, open_=True))
    (long,) = _edges(_found("https://example.com/c", anchor="x" * 900))

    assert (image.kind, image.followed, image.rel) == ("image", False, ("nofollow",))
    assert image.template_candidate
    assert open_link.template_candidate
    assert open_link.scope is LinkScope.AUTO_GENERATED
    assert len(long.anchor) == ANCHOR_MAX
    assert image.container_hash is not None


def test_the_cleanstart_shape_gives_previous_and_next_as_auto_generated() -> None:
    html = """
    <html><body>
      <header><nav><a href="/">Home</a><a href="/blog">Blog</a></nav></header>
      <main>
        <article><p>Body with <a href="/pricing">our plans</a>.</p></article>
        <section aria-label="Article navigation">
          <a rel="prev" href="/blog/post-a">Previous: Post A</a>
          <a rel="next" href="/blog/post-c">Next: Post C</a>
        </section>
      </main>
      <footer><a href="/privacy">Privacy</a></footer>
    </body></html>
    """
    edges = page_edges(classify(html, PAGE.url), page=PAGE, hosts=HOSTS)

    by_path = {edge.target.path: edge.scope for edge in edges}
    assert by_path == {
        "/": LinkScope.TEMPLATE,
        "/blog": LinkScope.TEMPLATE,
        "/pricing": LinkScope.EDITORIAL,
        "/blog/post-a": LinkScope.AUTO_GENERATED,
        "/blog/post-c": LinkScope.AUTO_GENERATED,
        "/privacy": LinkScope.TEMPLATE,
    }
    candidates = {edge.target.path for edge in edges if edge.template_candidate}
    assert candidates == {"/pricing"}


def test_the_same_link_with_another_kind_is_another_edge() -> None:
    edges = _edges(
        _found("https://example.com/a", anchor="Logo", kind="image"),
        _found("https://example.com/a", anchor="Logo", kind="text"),
    )

    assert sorted(edge.kind for edge in edges) == ["image", "text"]


def test_the_same_target_and_anchor_in_two_placements_are_two_edges() -> None:
    edges = _edges(
        _found("https://example.com/a", Placement.CONTENT),
        _found("https://example.com/a", Placement.FOOTER),
    )

    assert sorted(edge.placement for edge in edges) == ["content", "footer"]


def test_two_anchors_to_one_target_are_two_edges() -> None:
    edges = _edges(
        _found("https://example.com/a", anchor="Plans"),
        _found("https://example.com/a", anchor="Pricing"),
    )

    assert [edge.anchor for edge in edges] == ["Plans", "Pricing"]


def test_edges_come_in_the_order_links_are_first_seen_not_alphabetically() -> None:
    edges = _edges(
        _found("https://example.com/zzz"),
        _found("https://example.com/aaa"),
        _found("https://example.com/zzz", anchor="Again"),
    )

    assert [(edge.target.path, edge.anchor) for edge in edges] == [
        ("/zzz", "Read"),
        ("/aaa", "Read"),
        ("/zzz", "Again"),
    ]


def test_the_same_link_in_two_containers_is_two_edges() -> None:
    edges = _edges(
        _found("https://example.com/a", container="nav>ul.menu"),
        _found("https://example.com/a", container="main>p"),
        _found("https://example.com/a", container="main>p"),
    )

    assert {(edge.container_hash, edge.occurrences) for edge in edges} == {
        (container_hash("nav>ul.menu"), 1),
        (container_hash("main>p"), 2),
    }


@pytest.mark.parametrize("open_first", [True, False])
def test_an_open_link_and_a_closed_one_stay_apart_whatever_the_order(open_first: bool) -> None:
    open_link = _found("https://example.com/a", Placement.AUTO_GENERATED, open_=True)
    closed = _found("https://example.com/a", Placement.AUTO_GENERATED, open_=False)

    edges = _edges(*((open_link, closed) if open_first else (closed, open_link)))

    assert sorted(edge.template_candidate for edge in edges) == [False, True]


@pytest.mark.parametrize("nofollow_first", [True, False])
def test_a_followed_and_a_nofollow_link_stay_apart_whatever_the_order(
    nofollow_first: bool,
) -> None:
    nofollow = _found("https://example.com/a", rel=frozenset({"nofollow"}))
    plain = _found("https://example.com/a")

    edges = _edges(*((nofollow, plain) if nofollow_first else (plain, nofollow)))

    assert sorted((edge.followed, edge.rel) for edge in edges) == [
        (False, ("nofollow",)),
        (True, ()),
    ]
    assert all(edge.occurrences == 1 for edge in edges)


def test_links_with_the_same_rel_merge_and_rel_is_lower_case() -> None:
    (edge,) = _edges(
        _found("https://example.com/a", rel=frozenset({"NoFollow"})),
        _found("https://example.com/a", rel=frozenset({"nofollow"})),
    )

    assert (edge.rel, edge.followed, edge.occurrences) == (("nofollow",), False, 2)


def test_a_link_to_the_page_itself_in_another_spelling_is_dropped() -> None:
    edges = _edges(
        _found("https://EXAMPLE.com/blog/post-b/"),
        _found("https://www.example.com/blog/post-b?utm_source=x"),
    )

    assert [edge.target.url for edge in edges] == ["https://www.example.com/blog/post-b"]


def test_an_allowed_subdomain_is_internal_and_a_look_alike_host_is_not() -> None:
    hosts = site_hosts("example.com", ["docs.example.com"])

    edges = page_edges(
        [
            _found("https://docs.example.com/guide"),
            _found("https://shop.example.com/cart"),
            _found("https://example.com.evil.net/"),
        ],
        page=PAGE,
        hosts=hosts,
    )

    assert [edge.target.host.name for edge in edges] == ["docs.example.com"]


def test_a_port_other_than_the_default_is_a_different_page() -> None:
    edges = _edges(
        _found("https://example.com:8443/a"),
        _found("https://example.com/a"),
    )

    assert sorted(edge.target.url for edge in edges) == [
        "https://example.com/a",
        "https://example.com:8443/a",
    ]
    assert len({edge.target.url_hash for edge in edges}) == 2


def test_control_characters_and_whitespace_in_an_anchor_are_cleaned() -> None:
    (edge,) = _edges(
        _found("https://example.com/a", anchor="  Buy\x00 now\u200b\n\t\x07 today\ud800 ")
    )

    assert edge.anchor == "Buy now today"
    edge.anchor.encode("utf-8")


def test_an_anchor_of_only_control_characters_is_empty() -> None:
    (edge,) = _edges(_found("https://example.com/a", anchor="\x00\x01\x02"))

    assert edge.anchor == ""


def test_anchors_that_differ_only_in_control_characters_are_one_edge() -> None:
    edges = _edges(
        _found("https://example.com/a", anchor="Plans"),
        _found("https://example.com/a", anchor="Pl\x00ans"),
    )

    assert [(edge.anchor, edge.occurrences) for edge in edges] == [("Plans", 2)]


def test_invisible_and_bidi_characters_are_stripped() -> None:
    marks = (
        "\ufeff\u200b\u2060\u2061\u2062\u2063\u2064"
        "\u200e\u200f\u202a\u202b\u202c\u202d\u202e"
        "\u2066\u2067\u2068\u2069\u061c"
    )

    (edge,) = _edges(_found("https://example.com/a", anchor=f"pa{marks}ge"))

    assert edge.anchor == "page"


def test_joiners_keep_their_orthographic_meaning() -> None:
    zwnj = "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"
    zwj = "a\u200db"

    assert _edges(_found("https://example.com/a", anchor=zwnj))[0].anchor == zwnj
    assert _edges(_found("https://example.com/b", anchor=zwj))[0].anchor == zwj


def test_composed_and_decomposed_forms_of_a_word_are_one_edge() -> None:
    edges = _edges(
        _found("https://example.com/a", anchor="caf\u00e9"),
        _found("https://example.com/a", anchor="cafe\u0301"),
    )

    assert [(edge.anchor, edge.occurrences) for edge in edges] == [("caf\u00e9", 2)]


def test_a_rel_token_with_control_characters_is_cleaned_and_empty_ones_dropped() -> None:
    (edge,) = _edges(
        _found("https://example.com/a", rel=frozenset({"no\x00follow", "\x01", "UGC"}))
    )

    assert edge.rel == ("nofollow", "ugc")
    assert not edge.followed


def test_a_container_hash_has_a_golden_value() -> None:
    assert container_hash("main>div.body") == -7286771624418299033


def test_a_container_with_surrogates_hashes_stably_and_does_not_raise() -> None:
    value = container_hash("main>div.\ud800body")

    assert value == container_hash("main>div.\ud800body")
    assert -(2**63) <= value < 2**63


def test_an_empty_container_has_no_hash() -> None:
    (edge,) = _edges(_found("https://example.com/a", container=""))

    assert edge.container_hash is None


@pytest.mark.parametrize(
    "href",
    [
        "",
        "   ",
        "javascript:alert(1)",
        "data:text/html,<a>",
        "//",
        "http://",
        "https://[::1",
        "https://exa mple.com/",
        "https://example.com:99999/",
        "https://example.com:abc/",
        "https://user:pw@",
        "ftp://example.com/a",
        "https://" + "a" * 5_000 + ".com/",
        "https://example.com/" + "%" * 100_000,
        "https://example.com/?" + "a=1&" * 50_000,
        "https://\ud800.com/",
        "https://xn--.com/",
        "https://1.2.3.999/",
    ],
)
def test_a_hostile_href_gives_no_edge_and_no_exception(href: str) -> None:
    assert _edges(_found(href)) == []


def test_an_enormous_anchor_is_cut_to_the_limit() -> None:
    (edge,) = _edges(_found("https://example.com/a", anchor="word " * 2_000_000))

    assert len(edge.anchor) <= ANCHOR_MAX
    assert not edge.anchor.endswith(" ")


def test_an_enormous_container_string_hashes_and_stays_one_number() -> None:
    (edge,) = _edges(_found("https://example.com/a", container="div>" * 1_000_000))

    assert edge.container_hash is not None


def test_the_occurrence_count_stops_at_the_column_limit() -> None:
    links = [_found("https://example.com/a")] * 40_000

    (edge,) = page_edges(links, page=PAGE, hosts=HOSTS)

    assert edge.occurrences == 32_767


def test_a_hundred_thousand_links_to_a_few_targets_are_cheap() -> None:
    links = [_found(f"https://example.com/p{n % 50}") for n in range(100_000)]

    started = time.monotonic()
    edges = page_edges(links, page=PAGE, hosts=HOSTS)

    assert len(edges) == 50
    assert sum(edge.occurrences for edge in edges) == 100_000
    assert time.monotonic() - started < 10


def test_a_hundred_thousand_distinct_links_give_one_edge_each_in_document_order() -> None:
    links = [_found(f"https://example.com/p{n}") for n in range(100_000)]

    edges = page_edges(links, page=PAGE, hosts=HOSTS)

    assert len(edges) == 100_000
    assert edges[0].target.path == "/p0"
    assert edges[-1].target.path == "/p99999"


def test_no_links_give_no_edges() -> None:
    assert page_edges([], page=PAGE, hosts=HOSTS) == []
