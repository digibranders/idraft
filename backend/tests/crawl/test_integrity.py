"""The independent count of a page's links, and when it says links were lost."""

from __future__ import annotations

import pytest

from idraft.crawl.integrity import anchor_count, links_suspect
from idraft.crawl.placement import classify

PAGE = "https://example.com/page/"


def _anchors(*hrefs: str) -> str:
    return "".join(f'<a href="{href}">x</a>' for href in hrefs)


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        (_anchors("/a", "/b", "https://example.com/c", "//cdn.example.com/d"), 4),
        ("<A HREF='/a'>x</A><a  href=/b >y</a>", 2),
        ('<a\nhref="/a">x</a>', 1),
        ('<a href="  /a">x</a>', 1),
        # What the reader does not keep.
        (_anchors("#top", "", "  ", "mailto:a@b.c", "tel:1", "javascript:void(0)", "data:x"), 0),
        (_anchors("whatsapp://send?x=1", "sms:1", "intent://x", "viber://x", "skype:x"), 0),
        # Tags that only start with a.
        ("<article href='/a'>x</article><aside href='/b'></aside><abbr href='/c'></abbr>", 0),
        # Attributes that only end in href.
        ('<svg><a xlink:href="/a">x</a></svg><a data-href="/b">y</a>', 0),
        ("<a name='x'>no href</a>", 0),
        # Hidden from a reader.
        ('<!-- <a href="/a">x</a> --><a href="/b">y</a>', 1),
        ('<script>var a = \'<a href="/a">\';</script><a href="/b">y</a>', 1),
        ('<style>a[href="/a"]{}</style><template><a href="/a">x</a></template>', 0),
    ],
)
def test_the_count_is_the_links_a_reader_keeps(html: str, expected: int) -> None:
    assert anchor_count(html) == expected


@pytest.mark.parametrize("empty", ["<!--->", "<!-->", "<!---->", "<!-- -->"])
def test_an_empty_comment_hides_nothing_from_the_count(empty: str) -> None:
    assert anchor_count(f'<a href="/a">x</a>{empty}<a href="/b">y</a>') == 2


def test_the_count_agrees_with_the_reader_on_a_page_it_reads_whole() -> None:
    html = (
        "<header><nav>"
        + _anchors("/", "/about", "/blog")
        + "</nav></header><main><!--->"
        + _anchors("/x", "/y", "/author/z")
        + "</main><footer>"
        + _anchors("/privacy", "mailto:a@b.c", "#top")
        + "</footer>"
    )
    assert anchor_count(html) == len(classify(html, PAGE))


@pytest.mark.parametrize(
    ("raw", "read", "expected"),
    [
        (0, 0, False),
        (2, 0, False),
        (3, 0, True),
        (9, 0, True),
        (30, 30, False),
        (30, 27, False),
        (30, 26, True),
        (100, 97, False),
        (100, 96, True),
        (500, 485, False),
        (500, 484, True),
        (10, 7, False),
        (10, 6, True),
    ],
)
def test_a_page_is_suspect_when_it_lost_more_than_a_few_links(
    raw: int, read: int, expected: bool
) -> None:
    assert links_suspect(raw, read) is expected


def test_a_link_to_the_page_itself_is_not_counted_when_the_page_is_known() -> None:
    html = _anchors("/page", "https://example.com/page/", "/page/#top", "/other")
    assert anchor_count(html, "https://example.com/page/") == 1
    assert anchor_count(html) == 4


def test_the_count_agrees_with_the_reader_on_a_page_with_every_kind_of_link() -> None:
    html = (
        "<body>"
        + _anchors("/", "/page/", "#top", "https://", "tel:1", "mailto:a@b.c", "/cdn-cgi/l/x#y")
        + _anchors("https://other.example.org/z", "//cdn.example.com/w", "/a?x=1", "/a#frag")
        + "</body>"
    )
    assert anchor_count(html, PAGE) == len(classify(html, PAGE))
