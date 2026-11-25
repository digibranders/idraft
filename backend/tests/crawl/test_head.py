"""The canonical address a page names in its head (`idraft.crawl.head.canonical_of`)."""

from __future__ import annotations

import time

import pytest

from idraft.crawl.head import HREF_MAX, canonical_of

PAGE = "https://eventussecurity.com/uae/ai-driven-soc-uae-threat-detection/"
# Heads as eventussecurity.com serves them (the canonical lines are copied from real pages).
_HOST = "https://eventussecurity.com"
REAL = [
    f"{_HOST}/uae/ai-driven-soc-uae-threat-detection/",
    f"{_HOST}/press-releases/eventus-security-expands-india-partner-network"
    "-to-accelerate-managed-cybersecurity-growth/",
    f"{_HOST}/events/cio-500-accelerator-x-awards-2025/",
]


def head(*parts: str) -> str:
    return "<!doctype html><html><head><title>t</title>" + "".join(parts) + "</head><body></body>"


@pytest.mark.parametrize("url", REAL)
def test_a_real_head_gives_its_canonical(url: str) -> None:
    line = f'<link rel="canonical" href="{url}" />'
    assert canonical_of(head('<meta charset="utf-8">', line), url) == url
    assert canonical_of(head(line), f"{_HOST}/other") == url


@pytest.mark.parametrize(
    "rel",
    ["canonical", "CANONICAL", "Canonical", "alternate canonical", " canonical  ", "x\tcanonical"],
)
def test_rel_is_a_case_insensitive_token_list(rel: str) -> None:
    html = head(f'<link rel="{rel}" href="https://example.com/a">')
    assert canonical_of(html, "https://example.com/b") == "https://example.com/a"


@pytest.mark.parametrize("rel", ["canonicals", "noncanonical", "alternate", ""])
def test_another_rel_is_not_a_canonical(rel: str) -> None:
    assert canonical_of(head(f'<link rel="{rel}" href="/a">'), PAGE) is None


def test_the_first_canonical_wins() -> None:
    html = head(
        '<link rel="stylesheet" href="/a.css">',
        '<link rel="canonical" href="/first">',
        '<link rel="canonical" href="/second">',
    )
    assert canonical_of(html, "https://example.com/x") == "https://example.com/first"


def test_a_first_canonical_that_is_unusable_is_not_replaced_by_the_second() -> None:
    html = head('<link rel="canonical" href="">', '<link rel="canonical" href="/second">')
    assert canonical_of(html, "https://example.com/x") is None


def test_a_relative_href_is_resolved_against_the_page() -> None:
    html = head('<link rel="canonical" href="../other?q=1">')
    assert canonical_of(html, "https://example.com/a/b/c") == "https://example.com/a/other?q=1"


def test_a_protocol_relative_href_takes_the_pages_scheme() -> None:
    html = head('<link rel="canonical" href="//cdn.example.com/p">')
    assert canonical_of(html, "https://example.com/x") == "https://cdn.example.com/p"


def test_base_href_is_the_base_of_a_relative_canonical() -> None:
    html = head('<base href="https://other.example.com/dir/">', '<link rel="canonical" href="p">')
    assert canonical_of(html, "https://example.com/x") == "https://other.example.com/dir/p"


def test_a_relative_base_is_resolved_against_the_page_first() -> None:
    html = head('<base href="/dir/">', '<link rel="canonical" href="p">')
    assert canonical_of(html, "https://example.com/a/b") == "https://example.com/dir/p"


def test_a_base_after_the_canonical_does_not_apply_to_it_and_the_first_base_wins() -> None:
    html = head('<base href="/one/">', '<base href="/two/">', '<link rel="canonical" href="p">')
    assert canonical_of(html, "https://example.com/x") == "https://example.com/one/p"


@pytest.mark.parametrize(
    "href",
    [
        "",
        "   ",
        "javascript:alert(1)",
        "mailto:a@example.com",
        "data:text/html,x",
        "ftp://example.com/a",
        "http://[",
        "https://[::1",
        "http://",
        "https:///path",
        "https://example.com/" + "a" * HREF_MAX,
    ],
)
def test_an_href_that_is_not_a_usable_address_gives_none(href: str) -> None:
    assert canonical_of(head(f'<link rel="canonical" href="{href}">'), PAGE) is None


def test_a_canonical_without_an_href_gives_none() -> None:
    assert canonical_of(head('<link rel="canonical">'), PAGE) is None


def test_an_href_of_exactly_the_limit_is_kept() -> None:
    href = "https://example.com/" + "a" * (HREF_MAX - len("https://example.com/"))
    assert len(href) == HREF_MAX
    assert canonical_of(head(f'<link rel="canonical" href="{href}">'), PAGE) == href


def test_a_page_url_that_cannot_be_joined_gives_none() -> None:
    assert canonical_of(head('<link rel="canonical" href="/a">'), "http://[") is None


@pytest.mark.parametrize(
    "wrapper",
    ["<!-- {} -->", "<template>{}</template>", "<noscript>{}</noscript>", "<script>{}</script>"],
)
def test_a_link_inside_a_comment_template_noscript_or_script_is_ignored(wrapper: str) -> None:
    hidden = wrapper.format('<link rel="canonical" href="https://example.com/hidden">')
    html = head(hidden, '<link rel="canonical" href="https://example.com/real">')
    assert canonical_of(html, PAGE) == "https://example.com/real"


def test_a_link_only_inside_a_hidden_container_gives_none() -> None:
    html = head('<noscript><link rel="canonical" href="/a"></noscript>')
    assert canonical_of(html, PAGE) is None


def test_a_closed_template_does_not_hide_what_follows() -> None:
    html = head("<template><p>x</p></template>", '<link rel="canonical" href="/a">')
    assert canonical_of(html, "https://example.com/") == "https://example.com/a"


def test_reading_stops_at_the_end_of_the_head() -> None:
    html = '<html><head></head><link rel="canonical" href="/a"><body></body></html>'
    assert canonical_of(html, PAGE) is None


def test_reading_stops_at_the_body_even_without_a_closing_head() -> None:
    html = '<html><head><title>t</title><body><link rel="canonical" href="/a"></body></html>'
    assert canonical_of(html, PAGE) is None


def test_a_document_with_no_head_tag_but_a_canonical_before_the_body_is_read() -> None:
    html = '<title>t</title><link rel="canonical" href="https://example.com/a"><body>'
    assert canonical_of(html, PAGE) == "https://example.com/a"


def test_no_canonical_gives_none() -> None:
    assert canonical_of(head("<meta name=viewport content=x>"), PAGE) is None
    assert canonical_of("", PAGE) is None


def test_an_attribute_value_with_entities_is_decoded() -> None:
    html = head('<link rel="canonical" href="https://example.com/a?x=1&amp;y=2">')
    assert canonical_of(html, PAGE) == "https://example.com/a?x=1&y=2"


def test_single_quoted_and_unquoted_attributes_are_read() -> None:
    assert (
        canonical_of(head("<link rel=canonical href=https://example.com/a>"), PAGE)
        == "https://example.com/a"
    )
    assert (
        canonical_of(head("<link href='https://example.com/b' rel='canonical'>"), PAGE)
        == "https://example.com/b"
    )


# Adversarial input: it never raises and it is not slow.


def _fast(html: str, page: str = PAGE) -> str | None:
    started = time.monotonic()
    found = canonical_of(html, page)
    assert time.monotonic() - started < 2.0
    return found


def test_a_huge_attribute_value_is_refused_without_trouble() -> None:
    assert _fast(head(f'<link rel="canonical" href="{"a" * 5_000_000}">')) is None
    assert _fast(head(f'<link rel="canonical x{"y" * 5_000_000}" href="/a">')) is None


def test_a_canonical_after_a_huge_head_is_still_found_inside_the_scan_limit() -> None:
    html = head(
        '<meta name="x" content="' + "a" * 200_000 + '">', '<link rel="canonical" href="/a">'
    )
    assert _fast(html, "https://example.com/") == "https://example.com/a"


@pytest.mark.parametrize(
    "unit", ["<div", "<div>", "<a href=", "<!--", "<link rel=", "</", "<![CDATA[", "<?", "<p x='"]
)
def test_a_hundred_thousand_unclosed_tags_are_read_in_time(unit: str) -> None:
    assert _fast(head(unit * 100_000)) is None
    assert _fast("<html><head>" + unit * 100_000) is None


def test_a_hundred_thousand_open_templates_do_not_break_the_count() -> None:
    assert _fast(head("<template>" * 100_000, '<link rel="canonical" href="/a">')) is None


def test_tens_of_thousands_of_stray_end_tags_do_not_hide_the_canonical() -> None:
    html = head("</template></noscript>" * 40_000, '<link rel="canonical" href="/a">')
    assert _fast(html, "https://example.com/") == "https://example.com/a"


def test_nul_bytes_do_not_raise() -> None:
    assert _fast("\x00" * 100_000) is None
    html = head('<link rel="canonical" href="https://example.com/a\x00b">')
    assert _fast(html) in (None, "https://example.com/a\x00b")
    assert _fast('<link\x00rel="canonical" href="/a">') in (None, "https://eventussecurity.com/a")


@pytest.mark.parametrize("cut", range(0, 140, 7))
def test_a_truncated_document_never_raises(cut: int) -> None:
    html = head('<link rel="canonical" href="https://example.com/a">')
    found = _fast(html[:cut])
    assert found in (None, "https://example.com/a")


def test_a_document_cut_inside_the_canonical_tag_gives_none() -> None:
    assert _fast('<html><head><link rel="canonical" href="https://example.com/a') is None


def test_lone_surrogates_and_control_characters_do_not_raise() -> None:
    _fast(head('<link rel="canonical" href="https://example.com/\ud800\x01">'))
    assert _fast("\x1f\x7f￾" * 50_000) is None


def test_an_empty_comment_before_the_canonical_does_not_hide_it() -> None:
    html = '<html><head><!---><link rel="canonical" href="/page"></head><body></body></html>'

    assert canonical_of(html, "https://example.com/page?x=1") == "https://example.com/page"
