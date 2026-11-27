"""The facts read from one page's HTML (`idraft.crawl.page_facts`)."""

from __future__ import annotations

import pytest

from idraft.crawl import page_facts
from idraft.crawl.page_facts import PageFacts, read_facts

PAGE = "https://example.com/page"


def facts(html: str, url: str = PAGE) -> PageFacts:
    found = read_facts(html, url)
    assert found is not None
    return found


def words(count: int, word: str = "word") -> str:
    return " ".join([word] * count)


def meta(description: str) -> str:
    return f'<head><meta name="description" content="{description}"></head>'


def test_a_description_in_either_attribute_order_and_any_letter_case() -> None:
    assert facts(meta("Hello there")).meta_description == "Hello there"
    assert facts('<meta content="Hello" name="description">').meta_description == "Hello"
    assert facts('<meta name="Description" content="  Hi  ">').meta_description == "Hi"


def test_a_missing_or_empty_description_is_the_empty_string() -> None:
    assert facts("<head><title>x</title></head>").meta_description == ""
    assert facts(meta("")).meta_description == ""
    assert facts('<meta name="description">').meta_description == ""
    assert facts('<meta name="keywords" content="a, b">').meta_description == ""


def test_the_first_description_wins_and_a_long_one_is_cut() -> None:
    both = '<meta name="description" content="first"><meta name="description" content="second">'
    assert facts(both).meta_description == "first"
    assert len(facts(meta("a" * 2000)).meta_description) == 1000


def test_a_description_in_a_noscript_is_not_the_pages() -> None:
    assert facts("<noscript>" + meta("hidden") + "</noscript>").meta_description == ""


def test_headings_count_only_with_visible_text() -> None:
    assert facts("<h1>Title</h1>").h1_count == 1
    assert facts("<p>no heading</p>").h1_count == 0
    assert facts("<h1>   \n </h1>").h1_count == 0
    assert facts('<h1><img src="a.png" alt="logo"></h1>').h1_count == 0
    assert facts("<h1>One</h1><h1>Two</h1>").h1_count == 2


def test_an_h1_with_nested_tags_counts_once_and_an_unclosed_one_counts() -> None:
    assert facts("<h1>A <span>b</span> <em>c <b>d</b></em></h1>").h1_count == 1
    assert facts("<h1>Never closed <p>text").h1_count == 1


def test_an_h1_in_a_template_or_noscript_does_not_count() -> None:
    assert facts("<template><h1>x</h1></template><noscript><h1>y</h1></noscript>").h1_count == 0


def test_words_leave_out_scripts_styles_noscript_templates_comments_and_the_head() -> None:
    html = (
        "<html><head><title>Title words here</title><style>p { color: red }</style></head><body>"
        "<p>one two</p><script>var a = 'three four';</script><style>b { top: 0 }</style>"
        "<noscript>five six</noscript><template>seven eight</template><!-- nine ten -->"
        "<p>eleven</p></body></html>"
    )
    assert facts(html).word_count == 3


@pytest.mark.parametrize("count", [0, 1, 49, 50, 199, 200])
def test_the_words_of_a_page_are_counted_exactly(count: int) -> None:
    assert facts(f"<body><p>{words(count)}</p></body>").word_count == count


def test_the_text_hash_ignores_letter_case_spacing_and_markup() -> None:
    plain = facts("<p>The quick brown fox</p>")
    spaced = facts("<div>the   QUICK\n<b>brown</b>  fox </div>")
    other = facts("<p>The quick brown dog</p>")
    assert plain.text_hash is not None
    assert plain.text_hash == spaced.text_hash
    assert plain.text_hash != other.text_hash
    assert -(2**63) <= plain.text_hash < 2**63


def test_a_page_with_no_text_has_no_hash() -> None:
    empty = facts("<html><body><script>x</script></body></html>")
    assert (empty.word_count, empty.text_hash) == (0, None)


def test_images_without_an_alt_attribute_are_counted_and_empty_alt_is_not() -> None:
    html = '<img src="a"><img src="b" alt=""><img src="c" alt="x"><img src="d"><img src="e" alt>'
    assert facts(html).images_without_alt == 2


def test_images_in_a_noscript_are_not_counted() -> None:
    assert facts('<noscript><img src="a"></noscript>').images_without_alt == 0


def _og(*names: str, empty: str | None = None) -> str:
    return "".join(
        f'<meta property="{name}" content="{"" if name == empty else "x"}">' for name in names
    )


def test_open_graph_is_complete_with_the_three_tags_present_and_filled() -> None:
    names = ("og:title", "og:description", "og:image")
    assert facts(_og(*names)).og_complete is True
    assert facts(_og("og:title", "og:description")).og_complete is False
    assert facts(_og(*names, empty="og:image")).og_complete is False
    assert facts("<p>none</p>").og_complete is False


def test_json_ld_blocks_that_are_not_valid_json_are_counted() -> None:
    def block(content: str) -> str:
        return f'<script type="application/ld+json">{content}</script>'

    assert facts(block('{"@type": "Thing"}')).jsonld_errors == 0
    assert facts(block('{"@type": ')).jsonld_errors == 1
    assert facts(block("")).jsonld_errors == 1
    assert facts(block('{"a": 1}') + block("not json")).jsonld_errors == 1
    assert facts('<script type="text/javascript">not json</script>').jsonld_errors == 0
    assert facts("<p>none</p>").jsonld_errors == 0


def _alt(code: str, href: str) -> str:
    return f'<link rel="alternate" hreflang="{code}" href="{href}">'


def test_a_valid_set_of_language_links_has_no_error() -> None:
    html = _alt("en", PAGE) + _alt("fr-CA", "https://example.com/fr") + _alt("x-default", PAGE)
    assert facts(html).hreflang_errors == 0
    assert facts("<p>no languages</p>").hreflang_errors == 0


@pytest.mark.parametrize("code", ["en_US", "english", "e", "en-", ""])
def test_a_language_code_that_is_not_valid_is_one_error(code: str) -> None:
    html = _alt("en", PAGE) + _alt(code, "https://example.com/other")
    assert facts(html).hreflang_errors == 1


def test_the_same_code_twice_is_one_error() -> None:
    html = (
        _alt("en", PAGE) + _alt("fr", "https://example.com/a") + _alt("FR", "https://example.com/b")
    )
    assert facts(html).hreflang_errors == 1


def test_language_links_without_a_link_to_the_page_itself_are_one_error() -> None:
    html = _alt("fr", "https://example.com/fr") + _alt("de", "https://example.com/de")
    assert facts(html).hreflang_errors == 1


def test_the_link_to_the_page_itself_may_be_relative_or_have_a_fragment() -> None:
    assert facts(_alt("en", "/page#top") + _alt("fr", "/fr")).hreflang_errors == 0


def test_a_link_that_is_not_an_alternate_is_not_a_language_link() -> None:
    html = '<link rel="canonical" hreflang="xx_xx" href="/page">'
    assert facts(html).hreflang_errors == 0


@pytest.mark.parametrize(
    "tag",
    [
        '<img src="http://cdn.example.com/a.png">',
        '<script src="http://cdn.example.com/a.js"></script>',
        '<link rel="stylesheet" href="http://cdn.example.com/a.css">',
        '<iframe src="http://cdn.example.com/frame"></iframe>',
        '<video><source src="http://cdn.example.com/a.mp4"></video>',
        '<audio src="HTTP://cdn.example.com/a.mp3"></audio>',
    ],
)
def test_a_resource_loaded_over_http_on_an_https_page_is_counted(tag: str) -> None:
    assert facts(tag).http_resources == 1


def test_secure_relative_and_protocol_relative_resources_are_fine() -> None:
    html = (
        '<img src="https://cdn.example.com/a.png"><img src="/b.png"><img src="//cdn.example.com/c">'
        '<a href="http://other.example.com/">a link is not a resource</a>'
        '<link rel="canonical" href="http://example.com/page">'
    )
    assert facts(html).http_resources == 0


def test_an_http_page_has_no_mixed_content() -> None:
    html = '<img src="http://cdn.example.com/a.png">'
    assert facts(html, "http://example.com/page").http_resources == 0


def test_several_insecure_resources_are_counted_each() -> None:
    html = '<img src="http://a/1"><img src="http://a/2"><script src="http://a/3"></script>'
    assert facts(html).http_resources == 3


def test_garbage_and_truncated_html_never_raise() -> None:
    for html in (
        "",
        "<<<>>>",
        "<h1",
        "<script>",
        '<meta name="description" content="unterminated',
        "<!--",
        "</h1></h1></template></noscript>",
        "<template><h1>",
        "\x00\x01<p>\ud800</p>",
        "<script type='application/ld+json'>{",
    ):
        assert read_facts(html, PAGE) is not None


def test_a_page_over_the_size_bound_is_cut_and_not_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(page_facts, "SCAN_MAX", 200)
    html = f"<p>{words(10)}</p>" + " " * 300 + f"<p>{words(500)}</p>"
    assert facts(html).word_count == 10


def test_counts_stop_at_the_size_of_a_smallint() -> None:
    html = '<img src="a">' * (page_facts.SMALL_MAX + 5)
    assert facts(html).images_without_alt == page_facts.SMALL_MAX
