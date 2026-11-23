from __future__ import annotations

from idraft.crawl.mentions import (
    PhraseSet,
    boilerplate_blocks,
    find_mentions,
    index_phrases,
    phrase_key,
    visible_blocks,
    visible_text,
)

# A site builder (Eventus) puts its header and mega menu in plain divs, so they read as body text.
_CHROME = (
    '<div class="header-popup"><div>Report an Incident</div>'
    "<div>Get 24/7 incident response assistance from our global team</div></div>"
    "<ul><li>AI-Powered Security Operations</li><li>Managed XDR VAPT CART Breach and Attack "
    "Simulation Threat Intelligence DFIR</li></ul>"
)


def _page(body: str) -> str:
    return f"<html><body>{_CHROME}<div><p>{body}</p></div></body></html>"


HTML = """
<html><body>
<header><a href="/">Home</a> managed soc in the header</header>
<nav>managed soc menu</nav>
<main>
  <h1>Cloud misconfigurations</h1>
  <p>A managed detection and response team can catch these within hours. See
  <a href="/pricing">our pricing</a> for details.</p>
  <script>var x = "managed soc";</script>
  <p>Teams ask about ISO 27001 before they buy. Not about 2026.</p>
</main>
<footer>managed soc footer</footer>
</body></html>
"""


def test_visible_text_is_the_main_content_without_links_scripts_and_template_blocks() -> None:
    text = visible_text(HTML)
    assert "managed detection and response team" in text
    assert "ISO 27001" in text
    for left_out in ("header", "menu", "footer", "our pricing", "var x"):
        assert left_out not in text


def test_an_unclosed_menu_or_link_does_not_hide_the_rest_of_the_page() -> None:
    assert "managed SOC body" in visible_text("<nav><ul><li>menu</ul></nav><p>managed SOC body</p>")
    assert "after" in visible_text("<a href=x>one<a href=y>two</a><p>after</p>")
    assert "tail" in visible_text("<body><p>x</p><nav>unclosed</body><p>tail</p>")


def test_the_title_and_a_main_inside_an_aside_are_not_the_page_body() -> None:
    assert visible_text("<title>Managed SOC</title><p>x</p>") == "x"
    text = visible_text("<aside><article>related</article></aside><div>managed SOC body</div>")
    assert text == "managed SOC body"


def test_a_page_without_main_or_article_uses_its_body() -> None:
    assert "Plain words" in visible_text("<body><p>Plain words here.</p></body>")


def test_phrase_keys_are_lowercase_words_and_too_short_or_numeric_ones_are_refused() -> None:
    assert phrase_key("  Managed   SOC ") == "managed soc"
    assert phrase_key("ab") is None
    assert phrase_key("2026") is None
    assert phrase_key("one two three four five six") is None
    assert phrase_key("click here") is None


def test_a_mention_is_found_with_its_sentence_and_the_text_as_written() -> None:
    index = index_phrases(
        {
            10: PhraseSet(keywords=["managed detection and response"], anchors=[]),
            11: PhraseSet(keywords=[], anchors=["ISO 27001"]),
        }
    )
    found = find_mentions(visible_text(HTML), index, source_url_id=1, skip=set())
    by_target = {mention.target_url_id: mention for mention in found}
    assert by_target[10].phrase == "managed detection and response"
    assert by_target[10].origin == "keyword"
    assert "A managed detection and response team can catch these within hours." in (
        by_target[10].context
    )
    assert by_target[11].phrase == "ISO 27001"
    assert by_target[11].origin == "anchor"


def test_a_target_the_page_links_to_already_or_itself_is_skipped() -> None:
    index = index_phrases({10: PhraseSet(["iso 27001"], []), 1: PhraseSet(["ISO 27001"], [])})
    assert find_mentions(visible_text(HTML), index, source_url_id=1, skip={10}) == []


def test_a_keyword_phrase_wins_over_an_anchor_phrase_for_the_same_target() -> None:
    index = index_phrases({10: PhraseSet(["iso 27001"], ["before they buy"])})
    found = find_mentions(visible_text(HTML), index, source_url_id=1, skip=set())
    assert [(mention.phrase, mention.origin) for mention in found] == [("ISO 27001", "keyword")]


def test_a_phrase_must_match_whole_words() -> None:
    index = index_phrases({10: PhraseSet(["soc"], [])})
    assert find_mentions("The sock drawer and socks.", index, source_url_id=1, skip=set()) == []
    assert find_mentions("We run a SOC today.", index, source_url_id=1, skip=set())


def test_hyphens_and_apostrophes_join_words_the_same_way_in_phrases_and_text() -> None:
    index = index_phrases({10: PhraseSet(["managed soc", "SOC 2"], [])})
    text = "Our managed SOC's team passed a SOC-2 audit."
    found = find_mentions(text, index, source_url_id=1, skip=set())
    assert [mention.target_url_id for mention in found] == [10]
    assert phrase_key("a b") is None


def test_at_most_limit_mentions_come_back() -> None:
    targets = {n: PhraseSet([f"topic{n} words"], []) for n in range(100, 140)}
    text = " ".join(f"Read topic{n} words now." for n in range(100, 140))
    found = find_mentions(text, index_phrases(targets), source_url_id=1, skip=set(), limit=5)
    assert len(found) == 5


def test_blocks_that_most_pages_repeat_are_template_text_and_leave_the_page_text() -> None:
    pages = [
        _page("Our analysts handle incident response for banks."),
        _page("Threat intelligence feeds are mapped to MITRE."),
        _page("EDR agents are rolled out in a week."),
        _page("A story about something else."),
    ]
    template = boilerplate_blocks([visible_blocks(html) for html in pages])
    assert "Report an Incident" in template
    assert "Managed XDR VAPT CART Breach and Attack Simulation Threat Intelligence DFIR" in template
    assert not any("analysts" in block for block in template)
    text = visible_text(pages[0], boilerplate=template)
    assert text == "Our analysts handle incident response for banks."
    index = index_phrases(
        {7: PhraseSet((), ("threat intelligence",)), 8: PhraseSet((), ("incident response",))}
    )
    found = find_mentions(text, index, source_url_id=1, skip=set())
    assert [mention.phrase for mention in found] == ["incident response"]
    # Without the template text the menu words would be offered as mentions of the page.
    raw = find_mentions(visible_text(pages[0]), index, source_url_id=1, skip=set())
    assert {mention.phrase.lower() for mention in raw} == {
        "incident response",
        "threat intelligence",
    }


def test_a_block_on_few_pages_or_a_tiny_crawl_is_not_template_text() -> None:
    assert boilerplate_blocks([["a menu", "one"], ["a menu", "two"]]) == frozenset()
    assert (
        boilerplate_blocks([["a menu"], ["x"], ["y"], ["z"], ["a menu"], ["a menu"]]) == frozenset()
    )
    assert boilerplate_blocks([["a menu"], ["a menu"], ["a menu"], ["x"]]) == {"a menu"}


def test_the_template_text_is_learned_from_the_whole_body_even_when_pages_have_a_main() -> None:
    with_main = f"<body>{_CHROME}<main><p>Only this page says it.</p></main></body>"
    pages = [_page("one"), _page("two"), _page("three"), with_main]
    assert "Report an Incident" not in visible_blocks(with_main)
    template = boilerplate_blocks([visible_blocks(html, whole_body=True) for html in pages])
    assert "Report an Incident" in template


def test_an_empty_comment_does_not_hide_the_rest_of_the_page() -> None:
    for empty in ("<!--->", "<!-->", "<!---->"):
        html = f"<body><div>{empty}</div><p>Text after it.</p><!-- real --><p>And more.</p></body>"
        assert visible_text(html) == "Text after it. And more."
