"""The outline a page's HTML gives (`idraft.crawl.outline`), and its code lists."""

from __future__ import annotations

import json
import time

import pytest

from idraft.crawl.lang_codes import LANGUAGES, REGIONS
from idraft.crawl.outline import (
    DESCRIPTION_MAX,
    DESCRIPTION_MIN,
    EMPTY_OUTLINE,
    HEADING_TEXT_MAX,
    HEADINGS_MAX,
    HREFLANG_MAX,
    JSONLD_BLOCK_CHARS_MAX,
    JSONLD_BLOCKS_MAX,
    JSONLD_TYPES_MAX,
    META_TEXT_MAX,
    TITLE_MAX,
    TITLE_MIN,
    WORDS_PER_MINUTE,
    JsonLdBlock,
    ParsedOutline,
    hreflang_valid,
    length_state,
    parse_outline,
    read_minutes,
)

PAGE = """<!doctype html><html lang="en-GB"><head>
<title>Ignored here: the title comes from the crawl row</title>
<meta name="description" content="  A description of the managed SOC service that is long enough to pass the lower limit.  ">
<meta name="robots" content="index, follow">
<link rel="alternate" hreflang="en" href="/soc">
<link rel="alternate" hreflang="en-UK" href="https://example.com/uk/soc">
<link rel="alternate" hreflang="x-default" href="https://example.com/soc">
<meta property="og:title" content="Managed SOC"><meta property="og:image" content="/og/soc.png">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service"}</script>
<script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList"},{"@type":["FAQPage","WebPage"]}]}</script>
<script type="application/ld+json">{"@type": "Broken",</script>
</head><body><header><h2>Menu heading</h2></header><main>
<h1>Managed  SOC
 service</h1><h3>Skipped a level</h3><h2>How it works</h2>
<p>One two three four five.</p>
<img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="A chart">
</main></body></html>"""  # noqa: E501
URL = "https://example.com/soc"


def body(markup: str) -> str:
    return f"<!doctype html><html><head><title>t</title></head><body>{markup}</body></html>"


def head(markup: str) -> str:
    return f"<!doctype html><html><head>{markup}</head><body></body></html>"


def test_the_description_robots_and_language() -> None:
    outline = parse_outline(PAGE, URL)
    assert outline.description == (
        "A description of the managed SOC service that is long enough to pass the lower limit."
    )
    assert outline.description_chars == len(outline.description or "")
    assert outline.robots_meta == "index, follow"
    assert outline.html_lang == "en-GB"


def test_the_headings_in_document_order() -> None:
    outline = parse_outline(PAGE, URL)
    assert [(h.level, h.text) for h in outline.headings] == [
        (2, "Menu heading"),
        (1, "Managed SOC service"),
        (3, "Skipped a level"),
        (2, "How it works"),
    ]
    assert outline.headings_total == 4
    assert outline.level_counts == (1, 2, 1, 0, 0, 0)
    assert outline.skipped_at == 2


def test_hreflang_pairs() -> None:
    outline = parse_outline(PAGE, URL)
    assert [p.code for p in outline.hreflang] == ["en", "en-UK", "x-default"]
    en, uk, default = outline.hreflang
    assert (en.href, en.is_self, en.valid, en.suggestion) == (
        "https://example.com/soc",
        True,
        True,
        None,
    )
    assert (uk.is_self, uk.valid, uk.suggestion) == (False, False, "en-GB")
    assert default.valid
    assert outline.x_default


def test_social_tags() -> None:
    outline = parse_outline(PAGE, URL)
    assert outline.og_title == "Managed SOC"
    assert outline.og_description is None
    assert outline.og_image == "https://example.com/og/soc.png"
    assert outline.og_type == "website"
    assert outline.twitter_card == "summary_large_image"


def test_json_ld_blocks() -> None:
    assert parse_outline(PAGE, URL).jsonld == (
        JsonLdBlock(("Service",), True),
        JsonLdBlock(("BreadcrumbList", "FAQPage", "WebPage"), True),
        JsonLdBlock((), False),
    )


def test_content_counts() -> None:
    outline = parse_outline(PAGE, URL)
    # The page has a `main`, so only its blocks count: 3 headings of 3 words, and the paragraph.
    assert outline.words == 14
    assert outline.images == 3
    assert outline.images_without_alt == 1  # an empty alt is a described (decorative) image


def test_length_state() -> None:
    assert length_state(0, TITLE_MIN, TITLE_MAX) == "missing"
    assert length_state(TITLE_MIN - 1, TITLE_MIN, TITLE_MAX) == "short"
    assert length_state(TITLE_MIN, TITLE_MIN, TITLE_MAX) == "ok"
    assert length_state(TITLE_MAX, TITLE_MIN, TITLE_MAX) == "ok"
    assert length_state(TITLE_MAX + 1, TITLE_MIN, TITLE_MAX) == "long"
    assert length_state(69, DESCRIPTION_MIN, DESCRIPTION_MAX) == "short"
    assert length_state(70, DESCRIPTION_MIN, DESCRIPTION_MAX) == "ok"
    assert length_state(160, DESCRIPTION_MIN, DESCRIPTION_MAX) == "ok"
    assert length_state(161, DESCRIPTION_MIN, DESCRIPTION_MAX) == "long"


def test_read_minutes_rounds_half_up_and_is_at_least_one() -> None:
    assert read_minutes(0) == 1
    assert read_minutes(WORDS_PER_MINUTE) == 1
    assert read_minutes(344) == 1
    assert read_minutes(345) == 2


@pytest.mark.parametrize("code", ["en", "EN-gb", "zh-Hant-TW", "pt-BR", "x-default"])
def test_valid_hreflang_codes(code: str) -> None:
    assert hreflang_valid(code) == (True, None)


def test_a_known_slip_gets_a_suggestion() -> None:
    assert hreflang_valid("en-UK") == (False, "en-GB")


@pytest.mark.parametrize("code", ["xx", "english", "en_GB", "en-", "", "en-GB-x-y", "en-ZZ"])
def test_invalid_hreflang_codes(code: str) -> None:
    assert hreflang_valid(code) == (False, None)


def test_the_code_lists() -> None:
    assert len(LANGUAGES) == 184
    assert len(REGIONS) == 249
    assert {"en", "zh"} <= LANGUAGES
    assert "xx" not in LANGUAGES
    assert {"gb", "in"} <= REGIONS
    assert "uk" not in REGIONS
    for code in LANGUAGES | REGIONS:
        assert len(code) == 2
        assert code.isascii()
        assert code.isalpha()
        assert code.islower()


def test_a_page_without_an_h1() -> None:
    outline = parse_outline(body("<h2>One</h2><h3>Two</h3>"), URL)
    assert outline.level_counts[0] == 0
    assert outline.skipped_at is None  # a first heading skips nothing


def test_two_h1() -> None:
    assert parse_outline(body("<h1>A</h1><h1>B</h1>"), URL).level_counts[0] == 2


@pytest.mark.parametrize(
    "markup", ["<h1></h1>", '<h1><img alt="Brand"></h1>', "<h1> <b></b> </h1>"]
)
def test_a_heading_with_no_text_is_counted_but_not_listed(markup: str) -> None:
    outline = parse_outline(body(markup), URL)
    assert outline.level_counts[0] == 1
    assert outline.headings_total == 1
    assert outline.headings == ()


def test_a_heading_with_no_text_counts_for_the_flags() -> None:
    outline = parse_outline(body("<h1></h1><h1>B</h1>"), URL)
    assert outline.level_counts[0] == 2
    assert [h.text for h in outline.headings] == ["B"]
    # An empty h2 between h1 and h3 means the h3 skips nothing; an empty h3 after an h1 is the skip.
    assert parse_outline(body("<h1>A</h1><h2></h2><h3>C</h3>"), URL).skipped_at is None
    assert parse_outline(body("<h1>A</h1><h3></h3><h3>C</h3>"), URL).skipped_at == 1


def test_a_break_inside_a_heading_separates_words() -> None:
    outline = parse_outline(body("<h2>Foo<br>Bar</h2><h2><div>Baz</div><p>Qux</p></h2>"), URL)
    assert [h.text for h in outline.headings] == ["Foo Bar", "Baz Qux"]
    assert parse_outline(body("<h2>Fo<b>o</b></h2>"), URL).headings[0].text == "Foo"


@pytest.mark.parametrize("tag", ["template", "noscript"])
def test_a_heading_in_a_hidden_element_is_not_a_heading(tag: str) -> None:
    outline = parse_outline(body(f"<{tag}><h1>Hidden</h1></{tag}><h2>Shown</h2>"), URL)
    assert [h.text for h in outline.headings] == ["Shown"]
    assert outline.level_counts[0] == 0


def test_no_description() -> None:
    outline = parse_outline(body("<p>x</p>"), URL)
    assert outline.description is None
    assert outline.description_chars == 0
    empty = parse_outline(head('<meta name="description" content="  ">'), URL)
    assert empty.description is None
    assert empty.description_chars == 0


def test_only_the_first_description_counts_and_names_ignore_case() -> None:
    markup = '<meta NAME="Description" content="First"><meta name="description" content="Second">'
    assert parse_outline(head(markup), URL).description == "First"


def test_a_href_that_is_not_http_is_dropped_and_a_relative_one_resolved() -> None:
    markup = (
        '<link rel="alternate" hreflang="en" href="javascript:alert(1)">'
        '<link rel="alternate" hreflang="fr" href="data:text/html,x">'
        '<link rel="alternate" hreflang="de" href="/de/soc">'
        '<meta property="og:image" content="javascript:alert(1)">'
    )
    outline = parse_outline(head(markup), URL)
    assert [(p.code, p.href) for p in outline.hreflang] == [("de", "https://example.com/de/soc")]
    assert outline.og_image is None


def test_headings_are_capped_but_counted() -> None:
    outline = parse_outline(body("<h2>x</h2>" * (HEADINGS_MAX + 1)), URL)
    assert len(outline.headings) == HEADINGS_MAX
    assert outline.headings_total == HEADINGS_MAX + 1
    assert outline.level_counts[1] == HEADINGS_MAX + 1


def test_a_long_heading_is_cut() -> None:
    outline = parse_outline(body(f"<h2>{'y' * 500}</h2>"), URL)
    assert len(outline.headings[0].text) == HEADING_TEXT_MAX


def test_a_long_description_is_cut_and_keeps_its_true_length() -> None:
    outline = parse_outline(head(f'<meta name="description" content="{"d" * 3000}">'), URL)
    assert len(outline.description or "") == META_TEXT_MAX
    assert outline.description_chars == 3000


def test_hreflang_pairs_are_capped() -> None:
    links = "".join(
        f'<link rel="alternate" hreflang="en" href="/p{i}">' for i in range(HREFLANG_MAX + 1)
    )
    assert len(parse_outline(head(links), URL).hreflang) == HREFLANG_MAX


def test_json_ld_blocks_are_capped() -> None:
    blocks = '<script type="application/ld+json">{"@type":"Thing"}</script>' * 25
    assert len(parse_outline(head(blocks), URL).jsonld) == JSONLD_BLOCKS_MAX


def test_a_huge_json_ld_block_is_not_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("json.loads was given a block over the cap")

    monkeypatch.setattr(json, "loads", fail)
    text = " " * (JSONLD_BLOCK_CHARS_MAX + 1)
    markup = f'<script type="application/ld+json">{text}</script>'
    assert parse_outline(head(markup), URL).jsonld == (JsonLdBlock((), False),)


def test_a_block_with_many_types_gives_the_first_ten() -> None:
    types = json.dumps({"@type": [f"T{i}" for i in range(30)]})
    markup = f'<script type="application/ld+json">{types}</script>'
    (block,) = parse_outline(head(markup), URL).jsonld
    assert block.types == tuple(f"T{i}" for i in range(JSONLD_TYPES_MAX))
    assert block.parses


def test_a_graph_that_is_one_object_gives_its_types() -> None:
    markup = '<script type="application/ld+json">{"@graph": {"@type": "Article"}}</script>'
    assert parse_outline(head(markup), URL).jsonld == (JsonLdBlock(("Article",), True),)


def test_a_json_ld_script_that_is_never_closed_is_one_block_that_does_not_parse() -> None:
    markup = '<script type="application/ld+json">{"@type": "Thing"}'
    assert parse_outline(head(markup), URL).jsonld == (JsonLdBlock((), False),)


def test_json_ld_in_a_hidden_element_is_not_read() -> None:
    markup = '<noscript><script type="application/ld+json">{}</script></noscript>'
    assert parse_outline(body(markup), URL).jsonld == ()


HOSTILE = [
    "",
    "<",
    "<" * 1_000_000,
    "<h1" * 10_000,
    "<div>" * 10_000 + "<h1>deep</h1>",
    '<script type="application/ld+json">' + "[" * 100_000 + "</script>",
    "<h1>\x00null</h1>",
    "<!--" + "x" * 100_000,
    '<html lang="' + "a" * 100_000 + '">',
    b"\xff\xfe<h1>bytes</h1>".decode("utf-8", errors="replace"),
    PAGE[:137],
]


@pytest.mark.parametrize("value", HOSTILE, ids=range(len(HOSTILE)))
def test_hostile_input_never_raises(value: str) -> None:
    started = time.monotonic()
    assert isinstance(parse_outline(value, URL), ParsedOutline)
    assert time.monotonic() - started < 2


@pytest.mark.parametrize("tag", ["nav", "form", "footer"])
def test_deeply_nested_skipped_elements_read_in_linear_time(tag: str) -> None:
    started = time.monotonic()
    value = body(f"<{tag}>" * 150_000 + f"</{tag}>" * 100_000 + "<p>after</p>")
    assert isinstance(parse_outline(value, URL), ParsedOutline)
    assert time.monotonic() - started < 2


def test_an_empty_page_gives_the_empty_outline() -> None:
    assert parse_outline("", URL) == EMPTY_OUTLINE
