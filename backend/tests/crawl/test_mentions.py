from __future__ import annotations

from idraft.crawl.mentions import (
    PhraseSet,
    find_mentions,
    index_phrases,
    phrase_key,
    visible_text,
)

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


def test_at_most_limit_mentions_come_back() -> None:
    targets = {n: PhraseSet([f"topic{n} words"], []) for n in range(100, 140)}
    text = " ".join(f"Read topic{n} words now." for n in range(100, 140))
    found = find_mentions(text, index_phrases(targets), source_url_id=1, skip=set(), limit=5)
    assert len(found) == 5
