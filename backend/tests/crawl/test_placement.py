"""The link placement classifier of spec section 6.3, on HTML fixtures. No network, no database."""

from __future__ import annotations

import random
import time

import pytest

from idraft.crawl.placement import (
    PLACEMENTS,
    FoundLink,
    Placement,
    classify,
    folder_of,
    place_links,
)

SITE = "https://example.com"


def _placed(html: str, url: str = f"{SITE}/blog/a-post") -> dict[str, Placement | None]:
    """First-pass placements by path; None for a link rule 4 left open."""
    return {
        link.href.removeprefix(SITE): None if link.open else link.placement
        for link in classify(html, url)
    }


def _final(pages: dict[str, str]) -> dict[str, dict[str, Placement]]:
    found = {url: classify(html, url) for url, html in pages.items()}
    return {
        url: {link.href.removeprefix(SITE): link.placement for link in links}
        for url, links in place_links(found).items()
    }


# The shape found on cleanstart.com on 2026-11-16: previous and next links in a section named
# "Article navigation", inside main but outside the one article, and not in a nav element.
CLEANSTART = """<!doctype html><html><body>
<header><nav><a href="/">Home</a><a href="/blog">Blog</a></nav></header>
<main>
  <article><h1>A post</h1><p>Read <a href="/guide">our guide</a> first.</p></article>
  <section aria-label="Article navigation">
    <a rel="prev" href="/blog/older">Previous: An older post</a>
    <a rel="next" href="/blog/newer">Next: A newer post</a>
  </section>
  <section class="cta"><a href="/pricing">See plans</a></section>
</main>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>"""


def test_the_cleanstart_article_navigation_is_auto_generated() -> None:
    assert _placed(CLEANSTART) == {
        "/": "navigation",
        "/blog": "navigation",
        "/guide": "content",
        "/blog/older": "auto_generated",
        "/blog/newer": "auto_generated",
        # Rule 4: inside main, outside the one article, left open for the template pass.
        "/pricing": None,
        "/privacy": "footer",
    }


def test_an_open_link_no_block_claims_stays_auto_generated() -> None:
    placed = _final({f"{SITE}/blog/a-post": CLEANSTART})[f"{SITE}/blog/a-post"]

    assert placed["/pricing"] == "auto_generated"
    assert placed["/guide"] == "content"


def test_wordpress_post_navigation_is_auto_generated_by_rel_or_by_class() -> None:
    html = """<main><article><p><a href="/x">x</a></p></article>
    <nav class="navigation post-navigation" aria-label="Posts"><div class="nav-links">
      <div class="nav-previous"><a href="/older/" rel="prev">
        <span class="meta-nav">Previous Post</span> <span>Older</span></a></div>
      <div class="nav-next"><a href="/newer/">
        <span class="meta-nav">Next Post</span> <span>Newer</span></a></div>
    </div></nav></main>"""

    placed = _placed(html)

    assert placed["/older/"] == "auto_generated"
    assert placed["/newer/"] == "auto_generated"


def test_previous_or_next_followed_by_a_title_is_auto_generated() -> None:
    html = """<article><p><a href="/a">Next: How to plan a move</a>
    <a href="/b">Next</a> <a href="/c">Nextcloud setup</a></p></article>"""

    assert _placed(html) == {"/a": "auto_generated", "/b": "content", "/c": "content"}


def test_related_recent_and_popular_blocks_are_auto_generated() -> None:
    html = """<article><p><a href="/body">body</a></p>
    <div class="related-posts"><a href="/r">r</a></div>
    <aside id="recentPosts"><a href="/n">n</a></aside>
    <section aria-label="Popular"><a href="/p">p</a></section>
    <div class="more-posts"><a href="/m">m</a></div></article>"""

    assert _placed(html) == {
        "/body": "content",
        "/r": "auto_generated",
        "/n": "auto_generated",
        "/p": "auto_generated",
        "/m": "auto_generated",
    }


def test_markers_match_whole_words_and_never_html_or_body() -> None:
    html = """<html class="related"><body class="post-navigation">
    <article><div class="unrelated-notes"><a href="/a">a</a></div></article></body></html>"""

    assert _placed(html) == {"/a": "content"}


def test_breadcrumbs_win_over_the_nav_they_sit_in() -> None:
    html = """<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>
    <li><a href="/blog">Blog</a></li></ol></nav>
    <ol itemscope itemtype="https://schema.org/BreadcrumbList"><li><a href="/docs">Docs</a></ol>"""

    assert _placed(html) == {"/": "breadcrumb", "/blog": "breadcrumb", "/docs": "breadcrumb"}


def test_landmarks_by_element_and_by_role() -> None:
    html = """<div role="banner"><a href="/logo"><img alt="Example"></a></div>
    <div role="navigation"><a href="/menu">Menu</a></div>
    <aside><a href="/side">Side</a></aside>
    <div role="complementary"><a href="/side2">Side 2</a></div>
    <div role="contentinfo"><a href="/terms">Terms</a></div>"""

    assert _placed(html) == {
        "/logo": "header",
        "/menu": "navigation",
        "/side": "sidebar",
        "/side2": "sidebar",
        "/terms": "footer",
    }


def test_a_header_or_footer_inside_main_or_article_is_not_a_template() -> None:
    html = """<main><article><header><a href="/author/ann">Ann</a></header>
    <p>Text</p><footer><a href="/tags/moving">moving</a></footer></article>
    <header><a href="/main-header">x</a></header></main>"""

    assert _placed(html) == {
        "/author/ann": "content",
        "/tags/moving": "content",
        # Inside main, outside the one article: rule 4.
        "/main-header": None,
    }


def test_rule_four_needs_exactly_one_article() -> None:
    html = """<main><article><a href="/one">1</a></article><article><a href="/two">2</a></article>
    <div><a href="/outside">out</a></div></main>"""

    assert _placed(html) == {"/one": "content", "/two": "content", "/outside": "content"}


def test_jump_links_self_links_and_script_controls_are_dropped() -> None:
    html = """<article><a href="#top">Top</a><a href="/blog/a-post">Self</a>
    <a href="https://EXAMPLE.com/blog/a-post/#x">Self again</a>
    <a href="mailto:hi@example.com">Mail</a><a href="javascript:void(0)">Menu</a>
    <a>No href</a><button>Open</button>
    <a href="/blog/a-post?page=2">Page 2</a></article>"""

    assert _placed(html) == {"/blog/a-post?page=2": "content"}


def test_text_image_kind_rel_and_base_are_read() -> None:
    html = """<head><base href="https://example.com/docs/"></head>
    <article><a href="guide" rel="NoFollow UGC">  Our
    guide </a><a href="logo"><img src="l.png" alt="The logo"></a>
    <a href="labelled" aria-label="Pricing plans">See</a></article>"""

    links = {link.href: link for link in classify(html, f"{SITE}/blog/a-post")}

    guide = links[f"{SITE}/docs/guide"]
    assert (guide.anchor, guide.kind) == ("Our guide", "text")
    assert guide.rel == frozenset({"nofollow", "ugc"})
    logo = links[f"{SITE}/docs/logo"]
    assert (logo.anchor, logo.kind) == ("The logo", "image")
    assert links[f"{SITE}/docs/labelled"].anchor == "Pricing plans"


def test_implied_ends_keep_list_items_and_paragraphs_apart() -> None:
    html = """<nav><ul class="menu"><li class="item current-menu-item"><a href="/a">A
    <li class="item"><a href="/b">B</a></ul></nav>
    <article><p>One <a href="/c">c</a><div class="box"><a href="/d">d</a></div></article>"""

    links = {link.href.removeprefix(SITE): link for link in classify(html, SITE + "/x")}

    assert links["/a"].container == links["/b"].container
    assert links["/a"].container.endswith("nav/ul.menu/li.item")
    assert links["/d"].container.endswith("article/div.box")
    assert links["/c"].container.endswith("article/p")


def test_links_inside_a_template_element_are_not_on_the_page() -> None:
    html = """<article><template><a href="/hidden">x</a></template><a href="/shown">y</a>
    <br/><img src="a.png"/><a href="/after"/></article>"""

    assert _placed(html) == {"/shown": "content", "/after": "content"}


def test_an_unclosed_or_nested_link_ends_where_the_next_begins() -> None:
    html = '<article><a href="/a">A <a href="/b">B</article><p><a href="/c">C'

    links = classify(html, SITE + "/x")

    assert [(link.href.removeprefix(SITE), link.anchor) for link in links] == [
        ("/a", "A"),
        ("/b", "B"),
        ("/c", "C"),
    ]


def _post(slug: str, body: list[str], block: str) -> str:
    links = " ".join(f'<a href="{href}">{href}</a>' for href in body)
    return f"""<html><body><header><nav><a href="/">Home</a></nav></header>
    <main><article><h1>{slug}</h1><div class="prose"><p>{links}</p></div>{block}</article></main>
    </body></html>"""


def _related(*targets: str) -> str:
    items = "".join(f'<li><a href="{target}">{target}</a></li>' for target in targets)
    return f'<div class="more-reading"><ul>{items}</ul></div>'


CTA = '<div class="cta-band"><a href="/pricing">Pricing</a><a href="/demo">Demo</a></div>'


def test_an_unmarked_related_block_with_changing_targets_is_auto_generated() -> None:
    pages = {
        f"{SITE}/blog/p{n}": _post(f"p{n}", [f"/guide-{n}"], _related(f"/r{n}a", f"/r{n}b"))
        for n in range(5)
    }

    placed = _final(pages)[f"{SITE}/blog/p0"]

    assert placed["/r0a"] == "auto_generated"
    assert placed["/r0b"] == "auto_generated"
    assert placed["/"] == "navigation"


def test_a_block_with_the_same_targets_on_most_pages_is_navigation() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", ["/guide"], CTA) for n in range(4)}
    pages[f"{SITE}/blog/p4"] = _post("p4", ["/guide"], "")

    placed = _final(pages)

    assert placed[f"{SITE}/blog/p0"]["/pricing"] == "navigation"
    assert placed[f"{SITE}/blog/p0"]["/demo"] == "navigation"


def test_a_menu_counts_the_link_each_page_drops_to_itself() -> None:
    menu = "".join(f'<a href="/blog/p{n}">p{n}</a>' for n in range(4))
    pages = {
        f"{SITE}/blog/p{n}": f'<main><article><div class="series">{menu}</div></article></main>'
        for n in range(4)
    }

    placed = _final(pages)

    # Each page holds 3 of the 4 links: without its own, the targets would look different.
    assert set(placed[f"{SITE}/blog/p0"].values()) == {"navigation"}


def test_article_prose_with_changing_targets_stays_content() -> None:
    bodies = [["/a"], ["/b", "/c"], ["/d", "/e", "/f"], ["/g"], ["/h", "/i"]]
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", body, "") for n, body in enumerate(bodies)}

    placed = _final(pages)

    # One container path on every post, different targets, and a link count that changes.
    assert placed[f"{SITE}/blog/p2"] == {
        "/": "navigation",
        "/d": "content",
        "/e": "content",
        "/f": "content",
    }


def test_a_folder_with_too_few_pages_is_left_to_the_first_pass() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", ["/guide"], CTA) for n in range(3)}

    placed = _final(pages)

    assert placed[f"{SITE}/blog/p0"]["/pricing"] == "content"


def test_the_pass_never_changes_a_landmark_placement() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", [f"/x{n}"], "") for n in range(5)}

    placed = _final(pages)

    assert {placement["/"] for placement in placed.values()} == {"navigation"}


def test_a_block_on_fewer_than_half_the_pages_is_left_alone() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", ["/guide"], "") for n in range(3)}
    pages |= {f"{SITE}/blog/q{n}": _post(f"q{n}", ["/guide"], CTA) for n in range(2)}

    placed = _final(pages)

    assert placed[f"{SITE}/blog/q0"]["/pricing"] == "content"


@pytest.mark.parametrize(
    ("url", "folder"),
    [
        (f"{SITE}/", ""),
        (f"{SITE}/pricing", ""),
        (f"{SITE}/blog", ""),
        (f"{SITE}/blog/a-post", "blog"),
        (f"{SITE}/docs/api/v1/", "docs"),
    ],
)
def test_the_folder_is_the_first_of_two_or_more_segments(url: str, folder: str) -> None:
    assert folder_of(url) == folder


def test_placement_values_are_the_seven_of_the_spec() -> None:
    assert PLACEMENTS == (
        "content",
        "auto_generated",
        "navigation",
        "header",
        "footer",
        "sidebar",
        "breadcrumb",
    )


def test_an_open_link_is_auto_generated_and_marked_open() -> None:
    (link,) = [
        link
        for link in classify(CLEANSTART, f"{SITE}/blog/a-post")
        if link.href.endswith("/pricing")
    ]

    assert (link.placement, link.open) == (Placement.AUTO_GENERATED, True)


def test_place_links_keeps_every_link_in_order_and_changes_only_what_it_claims() -> None:
    link = FoundLink(
        href=f"{SITE}/a",
        anchor="a",
        kind="text",
        rel=frozenset(),
        placement=Placement.AUTO_GENERATED,
        container="",
        open=True,
    )

    placed = place_links({f"{SITE}/x": [link, link]})

    assert placed == {f"{SITE}/x": [link, link]}


# Adversarial input. Every limit below would take minutes, or all the memory, on a reader whose
# cost grows with depth, attribute size or link count squared; the time limit is generous.

TIME_LIMIT = 10.0


def _timed(html: str, url: str = f"{SITE}/blog/a-post") -> list[FoundLink]:
    started = time.perf_counter()
    links = classify(html, url)
    assert time.perf_counter() - started < TIME_LIMIT
    return links


def test_a_very_deep_page_is_read_in_linear_time() -> None:
    depth = 40_000
    html = "<div>" * depth + '<a href="/x">x</a>' + "</div>" * depth

    assert [link.href for link in _timed(html)] == [f"{SITE}/x"]


def test_end_tags_that_match_nothing_do_not_rescan_the_stack() -> None:
    html = "<div>" * 20_000 + "</x>" * 20_000 + '<a href="/x">x</a>'

    assert len(_timed(html)) == 1


def test_start_tags_that_look_for_an_open_paragraph_do_not_rescan_the_stack() -> None:
    html = "<span>" * 20_000 + "<li>" * 10_000 + "<p>" * 10_000 + '<a href="/x">x</a>'

    assert len(_timed(html)) == 1


def test_closing_a_page_nested_past_the_depth_limit_still_matches_end_tags() -> None:
    html = "<nav>" + "<div>" * 300 + "</div>" * 299 + '<a href="/x">x</a></div></nav>'

    (link,) = _timed(html)

    # One div is still open after 299 end tags: the skipped ones were counted, not matched.
    assert link.placement is Placement.NAVIGATION
    assert link.container.endswith("nav/div")


def test_thousands_of_links_under_a_deep_page_cost_linear_time() -> None:
    html = "<div>" * 500 + '<a href="/x">x</a>' * 20_000

    assert len(_timed(html)) == 20_000


def test_thousands_of_links_in_distinct_containers() -> None:
    html = "".join(
        f'<div class="c{n % 7}"><p><a href="/p/{n}">p{n}</a></p></div>' for n in range(8_000)
    )

    assert len(_timed(html)) == 8_000


def test_huge_attribute_values_are_read_once_per_element() -> None:
    huge = "related-" * 250_000
    many_rels = "nofollow " + "x " * 100_000 + "ugc"
    labelled = "".join(f'<a href="/l{n}" aria-label="{huge}">z</a>' for n in range(200))
    html = (
        f'<div class="{huge}" id="{huge}" aria-label="{huge}" itemtype="{huge}" role="{huge}">'
        f'<a href="/x" rel="{many_rels}">y</a>{labelled}</div>'
    )

    links = _timed(html)

    assert len(links) == 201
    assert all(len(link.anchor) <= 2_000 for link in links)


def test_a_huge_href_is_dropped_and_the_next_link_is_kept() -> None:
    html = f'<a href="/{"a" * 1_000_000}">big</a><a href="/ok">ok</a>'

    assert [link.href for link in _timed(html)] == [f"{SITE}/ok"]


def test_an_unclosed_link_around_megabytes_of_text_keeps_a_short_anchor() -> None:
    html = '<a href="/x">' + "word " * 500_000

    (link,) = _timed(html)

    assert 0 < len(link.anchor) <= 2_000


def test_a_link_around_a_million_images_is_an_image_link() -> None:
    html = '<a href="/x">' + '<img alt="">' * 100_000 + "</a>"

    (link,) = _timed(html)

    assert (link.kind, link.anchor) == ("image", "")


def test_pathological_class_names_are_linear_and_bounded() -> None:
    classes = " ".join(f"c{n}-{'a' * 50}" for n in range(100_000))
    html = f'<div class="{classes}"><p class="{"-" * 500_000}"><a href="/x">x</a></p></div>'

    (link,) = _timed(html)

    assert len(link.container) < 5_000


def test_a_container_path_stays_short_on_a_deep_page_of_long_class_names() -> None:
    classes = " ".join(f"k{n}-{'a' * 30}" for n in range(40))
    html = f'<div class="{classes}">' * 200 + '<a href="/x">x</a>'

    (link,) = _timed(html)

    assert len(link.container) < 5_000


@pytest.mark.parametrize(
    "href",
    ["http://[", "http://[::1", "http://exa mple.com/", "https://[fe80::1%25en0]x/", "//", "http:"],
)
def test_an_href_that_cannot_be_parsed_is_dropped_without_error(href: str) -> None:
    links = classify(f'<a href="{href}">x</a><a href="/ok">ok</a>', f"{SITE}/x")

    assert [link.href for link in links][-1] == f"{SITE}/ok"


def test_an_unparseable_base_falls_back_to_the_page_url() -> None:
    links = classify('<base href="http://["><a href="/ok">ok</a>', f"{SITE}/x")

    assert [link.href for link in links] == [f"{SITE}/ok"]


@pytest.mark.parametrize(
    "html",
    [
        "",
        "<",
        "</",
        "<a",
        '<a href="',
        '<a href="/x',
        "<a href='/x'",
        "<!--",
        "<!-- <a href='/x'>",
        "<![CDATA[ <a href='/x'>",
        "<?php <a href='/x'> ?>",
        "<!doctype",
        "<script><a href='/x'>",
        "<template><a href='/x'>",
        "</a></a></a>",
        "<a><a><a><a>",
        "&#xZZ; &amp &#99999999999; <a href='/x&#0;y'>&bogus;</a>",
        "\x00<a href='/x'>\x00</a>\x7f\x1b[0m",
    ],
)
def test_truncated_and_malformed_markup_never_raises(html: str) -> None:
    for link in classify(html, f"{SITE}/x"):
        assert link.href.startswith("http")


@pytest.mark.parametrize("piece", ["<", "<a ", "<!--", "<![CDATA[", '<a href="', "</", "<p<"])
def test_a_million_unfinished_constructs_are_read_in_linear_time(piece: str) -> None:
    _timed(piece * 50_000)


def test_random_tag_soup_never_raises() -> None:
    rng = random.Random(17)
    tokens = [
        "<div>", "</div>", "<p>", "</p>", "<li>", "<ul>", "</ul>", "<a href='/x'>", "<a href=/y>",
        "</a>", "<nav>", "</nav>", "<article>", "</article>", "<main>", "<aside>", "<header>",
        "<footer>", "<template>", "</template>", "<base href='/b/'>", "<img alt='i'>", "<br/>",
        "<a href='/z'/>", "text ", "&amp;", "<!--", "-->", "<", ">", '"', "'", "=", "<span class=",
        "<section aria-label='Related'>", "</section>", "<ol itemtype='breadcrumb'>", "</x>",
    ]  # fmt: skip
    for _ in range(300):
        html = "".join(rng.choice(tokens) for _ in range(rng.randrange(1, 400)))
        pages = {f"{SITE}/blog/p{n}": classify(html, f"{SITE}/blog/p{n}") for n in range(5)}
        assert set(place_links(pages)) == set(pages)


def test_the_template_pass_is_linear_in_the_links_of_a_crawl() -> None:
    shared = "".join(f'<div class="w"><a href="/t{n}">t</a></div>' for n in range(100))
    page = f"<main><article>{shared}</article></main>"
    pages = {f"{SITE}/blog/p{n}": classify(page, f"{SITE}/blog/p{n}") for n in range(200)}

    started = time.perf_counter()
    placed = place_links(pages)
    assert time.perf_counter() - started < TIME_LIMIT

    assert {link.placement for link in placed[f"{SITE}/blog/p0"]} == {Placement.NAVIGATION}


def test_a_block_with_many_changing_targets_is_linear_in_its_links() -> None:
    pages = {
        f"{SITE}/blog/p{n}": classify(
            "<main><article><ul>"
            + "".join(f'<li><a href="/r{n}-{m}">r</a></li>' for m in range(100))
            + "</ul></article></main>",
            f"{SITE}/blog/p{n}",
        )
        for n in range(200)
    }

    started = time.perf_counter()
    placed = place_links(pages)
    assert time.perf_counter() - started < TIME_LIMIT

    assert {link.placement for link in placed[f"{SITE}/blog/p0"]} == {Placement.AUTO_GENERATED}


# Review round: previous and next text, stale skipped counts, WordPress classes, implied ends,
# noscript, self-closing tags, stray end tags and the pinned rule order.


def _by_path(html: str, url: str = f"{SITE}/blog/a-post") -> dict[str, FoundLink]:
    return {link.href.removeprefix(SITE): link for link in classify(html, url)}


@pytest.mark.parametrize(
    "text",
    [
        "Next.js guide",
        "Next-gen CRM",
        "Previous experience matters",
        "Next steps",
        "Next",
        "Nextcloud setup",
        "Previously on the blog",
    ],
)
def test_ordinary_phrases_that_start_with_next_or_previous_are_content(text: str) -> None:
    html = f'<main><article><p><a href="/a">{text}</a></p></article></main>'

    assert _placed(html) == {"/a": "content"}


@pytest.mark.parametrize(
    "text",
    [
        "Next: Title",
        "Previous: Title",
        # Numeric references: the guillemets, arrows and en dash arrive as text of the link.
        "Next &#8250;",
        "&#171; Previous",
        "Next &#187;",
        "&#8592; Previous",
        "Next &#8594;",
        "&lt; Previous",
        "Next | A title",
        "Previous - A title",
        "Next &#8211; A title",
        "Next &gt; A title",
    ],
)
def test_previous_and_next_with_a_separator_or_arrow_are_auto_generated(text: str) -> None:
    html = f'<main><article><p><a href="/a">{text}</a></p></article></main>'

    assert _placed(html) == {"/a": "auto_generated"}


def test_a_skipped_element_count_is_forgotten_when_the_stack_pops() -> None:
    html = (
        "<main>"
        + "<font>" * 254
        + "<span>"
        + "<div>" * 2
        + "</span>"
        + '<div class="related"><a href="/in-related">r</a></div><a href="/after">after</a></main>'
    )

    assert _placed(html) == {"/in-related": "auto_generated", "/after": "content"}


@pytest.mark.parametrize(
    "classes",
    [
        "post-5 category-popular",
        "tag-recent",
        "post_tag-related",
        "type-popular",
        "postid-12 category-recent tag-pagination",
        "Category-Popular",
    ],
)
def test_wordpress_taxonomy_classes_are_not_markers(classes: str) -> None:
    html = f'<article class="{classes}"><p><a href="/a">a</a></p></article>'

    assert _placed(html) == {"/a": "content"}


def test_a_real_marker_next_to_taxonomy_classes_still_counts() -> None:
    html = '<div class="category-news related"><a href="/a">a</a></div>'

    assert _placed(html) == {"/a": "auto_generated"}


def test_wordpress_taxonomy_classes_are_left_out_of_the_container_path() -> None:
    html = (
        '<article class="post-5 category-news tag-moving post_tag-x type-post hentry">'
        '<p><a href="/a">a</a></p></article>'
    )

    assert _by_path(html)["/a"].container == "article.hentry/p"


@pytest.mark.parametrize("attr", ['class="wp-pagenavi"', 'class="paging"', 'id="Paging"'])
def test_wp_pagenavi_and_paging_are_markers(attr: str) -> None:
    assert _placed(f'<article><div {attr}><a href="/a">2</a></div></article>') == {
        "/a": "auto_generated"
    }


def test_an_unclosed_table_row_and_cell_do_not_nest() -> None:
    html = '<table><tr><td><a href="/a">A<td><a href="/b">B<tr><td><a href="/c">C</table>'

    containers = {path: link.container for path, link in _by_path(html).items()}

    assert containers == {"/a": "table/tr/td", "/b": "table/tr/td", "/c": "table/tr/td"}


def test_a_header_cell_ends_an_open_data_cell() -> None:
    html = '<table><tr><td>A<th><a href="/h">h</table>'

    assert _by_path(html)["/h"].container == "table"


def test_an_unclosed_definition_term_and_description_do_not_nest() -> None:
    html = '<dl><dt>T<dd><a href="/a">a<dd><a href="/b">b</dl>'

    containers = {path: link.container for path, link in _by_path(html).items()}

    assert containers == {"/a": "dl/dd", "/b": "dl/dd"}


def test_a_nested_table_keeps_the_row_of_the_outer_table_open() -> None:
    html = '<table><tr><td>A<table><tr><td><a href="/n">n</table>'

    assert _by_path(html)["/n"].container == "table/tr/td/table/tr/td"


def test_noscript_images_add_no_alt_text_but_noscript_links_stay() -> None:
    html = (
        '<article><a href="/a"><img alt="Foo"><noscript><img alt="Foo"></noscript></a>'
        '<noscript><a href="/c">C</a></noscript></article>'
    )

    links = _by_path(html)

    assert (links["/a"].anchor, links["/a"].kind) == ("Foo", "image")
    assert links["/c"].placement is Placement.CONTENT


def test_a_self_closing_tag_is_a_plain_start_tag_unless_void_or_a() -> None:
    html = '<div class="related"/><p><a href="/a">a</a></p>'

    assert _placed(html) == {"/a": "auto_generated"}


def test_self_closing_void_tags_and_links_still_close() -> None:
    html = '<article><br/><img src="a.png"/><a href="/e"/><a href="/f">f</a></article>'

    links = _by_path(html)

    assert (links["/e"].anchor, links["/f"].anchor) == ("", "f")
    assert links["/f"].container == "article"


def test_stray_end_tags_do_not_scan_the_stack() -> None:
    def seconds(depth: int) -> float:
        started = time.perf_counter()
        links = classify("<div>" * depth + "</i>" * 300_000 + '<a href="/x">x</a>', SITE + "/p")
        assert len(links) == 1
        return time.perf_counter() - started

    # The same stray end tags cost the same under a stack of 300 as under a stack of 1; when each
    # scanned the stack, the deep page took about six times as long.
    assert seconds(300) < 2 * seconds(1) + 0.5


def test_a_nav_inside_a_footer_is_navigation_and_the_rest_of_it_is_footer() -> None:
    # Spec 6.3 rule 3 lists nav before header and footer, so a menu in a footer or header is
    # navigation; the other links of the footer stay footer links.
    html = (
        '<footer><nav><a href="/a">a</a></nav><a href="/b">b</a></footer>'
        '<header><nav><a href="/c">c</a></nav></header>'
    )

    assert _placed(html) == {"/a": "navigation", "/b": "footer", "/c": "navigation"}


def test_text_after_the_link_is_not_in_the_anchor() -> None:
    assert _by_path('<article><a href="/a">in</a> out</article>')["/a"].anchor == "in"


def test_a_link_is_an_image_link_only_without_text_and_text_beats_alt() -> None:
    html = (
        '<article><a href="/t">Words <img alt="Alt"></a><a href="/i"><img alt="Alt"></a>'
        '<a href="/n"><img></a><a href="/p">plain</a></article>'
    )

    links = _by_path(html)

    assert [(path, link.anchor, link.kind) for path, link in links.items()] == [
        ("/t", "Words", "text"),
        ("/i", "Alt", "image"),
        ("/n", "", "image"),
        ("/p", "plain", "text"),
    ]


def test_fragments_and_surrounding_whitespace_are_stripped_from_the_href() -> None:
    html = '<article><a href="/x#frag">x</a><a href="  /w  ">w</a></article>'

    assert [link.href for link in classify(html, f"{SITE}/blog/a-post")] == [
        f"{SITE}/x",
        f"{SITE}/w",
    ]


def test_only_the_first_base_href_counts() -> None:
    html = '<base href="/one/"><base href="/two/"><article><a href="r">r</a></article>'

    assert [link.href for link in classify(html, f"{SITE}/blog/a-post")] == [f"{SITE}/one/r"]


def test_jump_links_are_dropped_under_a_base_href() -> None:
    html = '<base href="https://example.com/docs/"><article><a href="#top">t</a><a href="/ok">o</a>'

    assert _placed(html) == {"/ok": "content"}


def test_a_list_item_does_not_end_an_open_item_across_a_nested_list() -> None:
    html = '<ul><li><a href="/a">a</a><ul><li><a href="/b">b</a></ul><li><a href="/c">c</a></ul>'

    containers = {path: link.container for path, link in _by_path(html).items()}

    assert containers == {"/a": "ul/li", "/b": "ul/li/ul/li", "/c": "ul/li"}


def test_a_paragraph_does_not_end_an_open_paragraph_across_a_button() -> None:
    html = '<p><a href="/a">a</a><button><p><a href="/b">b</a></p></button><a href="/c">c</a></p>'

    containers = {path: link.container for path, link in _by_path(html).items()}

    assert containers == {"/a": "p", "/b": "p/button/p", "/c": "p"}


def test_template_contents_are_skipped_through_nested_templates() -> None:
    html = (
        '<template><template><a href="/x">x</a></template><a href="/y">y</a></template>'
        '<a href="/z">z</a>'
    )

    assert _placed(html) == {"/z": "content"}


def test_rel_prev_alone_and_rel_next_alone_are_auto_generated() -> None:
    html = '<article><a rel="prev" href="/p">p</a><a rel="next" href="/n">n</a></article>'

    assert _placed(html) == {"/p": "auto_generated", "/n": "auto_generated"}


@pytest.mark.parametrize(
    "attr",
    [
        'class="article-nav"',
        'class="post-nav"',
        'class="posts-nav"',
        'class="entry-nav"',
        'class="story-nav"',
        'class="article-navigation"',
        'aria-label="Post navigation"',
        'class="nav-previous"',
        'class="nav-next"',
        'class="pagination"',
        'class="pager"',
        'id="related"',
        'class="recent"',
        'class="popular"',
        'class="more-posts"',
        'class="latest-articles"',
        'class="similar-stories"',
    ],
)
def test_each_marker_alone_makes_its_block_auto_generated(attr: str) -> None:
    assert _placed(f'<article><div {attr}><a href="/a">a</a></div></article>') == {
        "/a": "auto_generated"
    }


@pytest.mark.parametrize(
    "attr",
    [
        'id="breadcrumbs"',
        'class="my-breadcrumb"',
        'aria-label="Breadcrumb"',
        'itemtype="x/BreadcrumbList"',
    ],
)
def test_a_breadcrumb_is_found_by_id_class_label_or_itemtype_alone(attr: str) -> None:
    assert _placed(f'<div {attr}><a href="/a">a</a></div>') == {"/a": "breadcrumb"}


def test_rule_four_needs_a_main_element_or_role_and_the_role_is_case_insensitive() -> None:
    by_role = '<div role="MAIN"><article><a href="/in">i</a></article><a href="/out">o</a></div>'
    no_main = '<div><article><a href="/in">i</a></article><a href="/out">o</a></div>'

    assert _placed(by_role) == {"/in": "content", "/out": None}
    assert _placed(no_main) == {"/in": "content", "/out": "content"}


def test_landmark_roles_are_case_insensitive() -> None:
    html = (
        '<div role="NAVIGATION"><a href="/n">n</a></div><div role="Banner"><a href="/h">h</a></div>'
        '<div role="ContentInfo"><a href="/f">f</a></div>'
        '<div role="Complementary"><a href="/s">s</a></div>'
    )

    assert _placed(html) == {
        "/n": "navigation",
        "/h": "header",
        "/f": "footer",
        "/s": "sidebar",
    }


def test_a_header_or_footer_inside_main_without_an_article_is_not_a_template_landmark() -> None:
    html = '<main><footer><a href="/f">f</a></footer><header><a href="/h">h</a></header></main>'

    assert _placed(html) == {"/f": "content", "/h": "content"}


def test_the_rules_apply_in_the_order_of_the_spec() -> None:
    html = (
        # Rule 1 before rule 2.
        '<nav aria-label="Breadcrumb related"><a href="/auto">a</a></nav>'
        # Rule 2 before rule 3.
        '<footer class="breadcrumb"><a href="/crumb">c</a></footer>'
        # Navigation before header and footer, header and footer before aside.
        '<aside><nav><a href="/nav">n</a></nav></aside>'
        '<header><aside><a href="/header">h</a></aside></header>'
        '<aside><footer><a href="/footer">f</a></footer></aside>'
    )

    assert _placed(html) == {
        "/auto": "auto_generated",
        "/crumb": "breadcrumb",
        "/nav": "navigation",
        "/header": "header",
        "/footer": "footer",
    }


def test_an_aside_beside_the_one_article_is_a_sidebar_and_not_open() -> None:
    html = '<main><article><a href="/a">a</a></article><aside><a href="/s">s</a></aside></main>'

    assert _placed(html) == {"/a": "content", "/s": "sidebar"}


def test_container_steps_keep_short_stable_classes_lowercased_and_sorted() -> None:
    long_name = "a" * 32
    html = (
        f'<ul><li class="Zeta alpha col-6 {"x" * 33} {long_name} is-active selected open current">'
        '<span><a href="/a">a</a></span></li></ul>'
    )

    assert _by_path(html)["/a"].container == f"ul/li.{long_name}.alpha.zeta"


def test_a_container_step_keeps_six_classes() -> None:
    html = '<div class="ch cg cf ce cd cc cb ca"><a href="/a">a</a></div>'

    assert _by_path(html)["/a"].container == "div.ca.cb.cc.cd.ce.cf"


def test_a_container_path_keeps_the_nearest_twenty_steps() -> None:
    html = "<section>" * 30 + '<a href="/a">a</a>'

    assert _by_path(html)["/a"].container == "/".join(["section"] * 20)


def test_list_items_and_paragraphs_are_the_nearest_block_container() -> None:
    html = '<section><p><em><a href="/a">a</a></em></p></section><ul><li><b><a href="/b">b</a></b>'

    links = _by_path(html)

    assert (links["/a"].container, links["/b"].container) == ("section/p", "ul/li")


def test_a_link_with_no_block_above_it_takes_the_whole_path() -> None:
    links = _by_path('<span><b><a href="/a">a</a></b></span><a href="/b">b</a>')

    assert (links["/a"].container, links["/b"].container) == ("span/b", "")


def _flink(
    href: str,
    placement: Placement = Placement.CONTENT,
    *,
    open_: bool = False,
    container: str = "c",
) -> FoundLink:
    return FoundLink(
        href=f"{SITE}{href}",
        anchor="",
        kind="text",
        rel=frozenset(),
        placement=placement,
        container=container,
        open=open_,
    )


def _folder(*per_page: list[FoundLink]) -> dict[str, list[FoundLink]]:
    return {f"{SITE}/blog/p{n}": links for n, links in enumerate(per_page)}


def _placements(pages: dict[str, list[FoundLink]], n: int = 0) -> list[Placement]:
    return [link.placement for link in place_links(pages)[f"{SITE}/blog/p{n}"]]


def test_a_block_on_exactly_half_the_pages_is_placed_and_one_page_in_four_is_not() -> None:
    half = _folder([_flink("/t")], [_flink("/t")], [], [])
    quarter = _folder([_flink("/t")], [], [], [])

    assert _placements(half) == [Placement.NAVIGATION]
    assert _placements(quarter) == [Placement.CONTENT]


def test_the_same_targets_threshold_is_met_at_exactly_eighty_percent() -> None:
    def pages(second_target_on: int) -> dict[str, list[FoundLink]]:
        return _folder(
            *[
                [_flink("/t1"), _flink("/t2")] if n < second_target_on else [_flink("/t1")]
                for n in range(5)
            ]
        )

    assert _placements(pages(3)) == [Placement.NAVIGATION, Placement.NAVIGATION]
    # Coverage 0.7, and a steady count of 3 pages in 5: left to the first pass.
    assert _placements(pages(2)) == [Placement.CONTENT, Placement.CONTENT]


def test_the_steady_count_threshold_is_met_at_exactly_eighty_percent() -> None:
    def pages(pairs: int) -> dict[str, list[FoundLink]]:
        return _folder(
            *[
                [_flink(f"/u{n}a"), _flink(f"/u{n}b")] if n < pairs else [_flink(f"/u{n}a")]
                for n in range(5)
            ]
        )

    assert _placements(pages(1), 1) == [Placement.AUTO_GENERATED]
    assert _placements(pages(2), 1) == [Placement.CONTENT, Placement.CONTENT]


def test_an_open_link_is_claimed_by_a_block_and_an_unclaimed_one_stays_open() -> None:
    def pages(*counts: int) -> dict[str, list[FoundLink]]:
        return _folder(
            *[
                [_flink(f"/t{n}-{m}", Placement.AUTO_GENERATED, open_=True) for m in range(count)]
                for n, count in enumerate(counts)
            ]
        )

    same = _folder(*[[_flink("/t", Placement.AUTO_GENERATED, open_=True)] for _ in range(5)])
    assert _placements(same) == [Placement.NAVIGATION]
    # Changing targets and a changing count: no rule claims it.
    unclaimed = place_links(pages(1, 2, 3, 1, 2))[f"{SITE}/blog/p2"]
    assert [(link.placement, link.open) for link in unclaimed] == [
        (Placement.AUTO_GENERATED, True)
    ] * 3


def test_links_the_first_pass_placed_are_never_changed_by_the_template_pass() -> None:
    def page() -> list[FoundLink]:
        return [
            _flink("/t"),
            _flink("/f", Placement.FOOTER),
            _flink("/a", Placement.AUTO_GENERATED),
            _flink("/n", Placement.NAVIGATION),
            _flink("/h", Placement.HEADER),
        ]

    assert _placements(_folder(*[page() for _ in range(5)])) == [
        Placement.NAVIGATION,
        Placement.FOOTER,
        Placement.AUTO_GENERATED,
        Placement.NAVIGATION,
        Placement.HEADER,
    ]
