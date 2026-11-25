"""Pages that mention a topic of another page (spec 7.10, decision D11). Pure.

`visible_text` takes the words a reader sees in the body of a page; `index_phrases` turns the
phrases of every target into a dictionary of 1 to 5 word keys; `find_mentions` reads each run
of 1 to 5 words of the text once and looks it up, so the time grows with the length of the
page and not with the number of phrases."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final, Literal

from idraft.crawl.anchors import GENERIC_ANCHORS
from idraft.crawl.placement import without_empty_comments

MENTIONS_PER_PAGE: Final = 20
PHRASE_MIN_CHARS: Final = 3
PHRASE_MAX_WORDS: Final = 5
CONTEXT_MAX: Final = 240

type Origin = Literal["keyword", "anchor"]
type PhraseIndex = dict[str, list[tuple[int, Origin]]]

# A word is a run of letters and digits: "SOC-2" is "soc" and "2", "SOC's" is "soc" and "s", so
# a phrase matches however the text joins its words. Marks that Python does not count as
# letters (some Indic scripts) split a word; a known limit, and spaceless scripts are too.
_WORD = re.compile(r"[^\W_]+")
_SENTENCE_END = re.compile(r"[.!?]\s")
# Text in these elements is not the page's own words about a topic.
_SKIP = frozenset(
    {
        "script",
        "style",
        "noscript",
        "nav",
        "header",
        "footer",
        "aside",
        "form",
        "svg",
        "a",
        "button",
        "select",
        "textarea",
        "template",
        "iframe",
        "head",
        "title",
    }
)
_BLOCKS = frozenset(
    {
        "p",
        "div",
        "li",
        "ul",
        "ol",
        "br",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "section",
        "article",
        "main",
        "tr",
        "td",
        "th",
        "table",
        "blockquote",
        "figcaption",
    }
)
_VOID = frozenset({"br", "img", "hr", "input", "meta", "link", "source", "wbr", "area", "col"})


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        # The skipped elements that are open, outermost first. A closing tag ends the innermost
        # open one of its name and every one opened inside it, so an element a page never
        # closed does not hide the rest of the page; `</body>` ends them all.
        self.skipping: list[str] = []
        self.main = 0
        self.has_main = False
        # The text of the page, one entry per block (paragraph, list item, cell...), whole
        # body and inside `main` or `article` apart; the open block is `*_open`.
        self.blocks: list[str] = []
        self.main_blocks: list[str] = []
        self._open: list[str] = []
        self._main_open: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID:
            self._break(tag)
            return
        if tag == "a" and "a" in self.skipping:
            # A link cannot hold a link: a second one means the first was never closed.
            del self.skipping[len(self.skipping) - 1 - self.skipping[::-1].index("a") :]
        if tag in _SKIP:
            self.skipping.append(tag)
        elif tag in ("main", "article") and not self.skipping:
            self.main += 1
            self.has_main = True
        self._break(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.skipping:
            del self.skipping[len(self.skipping) - 1 - self.skipping[::-1].index(tag) :]
        elif tag == "body":
            self.skipping.clear()
        elif tag in ("main", "article") and self.main and not self.skipping:
            self.main -= 1
        self._break(tag)

    def _break(self, tag: str) -> None:
        if tag in _BLOCKS:
            self.flush()

    def flush(self) -> None:
        for words, blocks in ((self._open, self.blocks), (self._main_open, self.main_blocks)):
            block = _squash("".join(words))
            if block:
                blocks.append(block)
            words.clear()

    def handle_data(self, data: str) -> None:
        if self.skipping:
            return
        self._open.append(data)
        if self.main:
            self._main_open.append(data)


def _squash(text: str) -> str:
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text).strip())


def visible_blocks(html: str, *, whole_body: bool = False) -> list[str]:
    """The body text of a page, one string per block: the text of `main` or `article` when the
    page has one (unless `whole_body`), else of the whole body, without text inside links,
    scripts, menus, header, footer, aside and forms. Whitespace is one space."""
    parser = _Text()
    parser.feed(without_empty_comments(html))
    parser.close()
    parser.flush()
    return parser.main_blocks if parser.has_main and not whole_body else parser.blocks


def visible_text(html: str, *, boilerplate: AbstractSet[str] = frozenset()) -> str:
    """`visible_blocks` joined into one text, leaving out the blocks in `boilerplate`."""
    return " ".join(block for block in visible_blocks(html) if block not in boilerplate)


BOILERPLATE_MIN_PAGES: Final = 3


def boilerplate_blocks(pages: Sequence[Sequence[str]]) -> frozenset[str]:
    """The blocks of text that most of the given pages carry (more than half, on at least
    `BOILERPLATE_MIN_PAGES`): a menu or a header button a site builds out of plain elements
    reads as page text, but it is the template's words, not the page's."""
    seen: Counter[str] = Counter()
    for blocks in pages:
        seen.update(set(blocks))
    return frozenset(
        block
        for block, count in seen.items()
        if count >= BOILERPLATE_MIN_PAGES and 2 * count > len(pages)
    )


def phrase_key(phrase: str) -> str | None:
    """The dictionary key of a phrase: its words in lowercase, one space between. None for a
    phrase that is too short, too long, only digits, or a generic anchor."""
    words = [
        match.group(0).lower() for match in _WORD.finditer(unicodedata.normalize("NFC", phrase))
    ]
    key = " ".join(words)
    if not words or len("".join(words)) < PHRASE_MIN_CHARS or len(words) > PHRASE_MAX_WORDS:
        return None
    if all(word.isdigit() for word in words) or key in GENERIC_ANCHORS:
        return None
    return key


@dataclass(frozen=True, slots=True)
class PhraseSet:
    """What a target page is called: its tracked keywords, and the anchors that other pages
    use to link to it."""

    keywords: Sequence[str]
    anchors: Sequence[str]


def index_phrases(targets: Mapping[int, PhraseSet]) -> PhraseIndex:
    index: PhraseIndex = {}
    for target, phrases in targets.items():
        pairs: tuple[tuple[Origin, Sequence[str]], ...] = (
            ("keyword", phrases.keywords),
            ("anchor", phrases.anchors),
        )
        for origin, texts in pairs:
            for text in texts:
                key = phrase_key(text)
                if key is None:
                    continue
                entry = index.setdefault(key, [])
                if all(found[0] != target for found in entry):
                    entry.append((target, origin))
    return index


@dataclass(frozen=True, slots=True)
class Mention:
    target_url_id: int
    phrase: str
    context: str
    origin: Origin


def _sentence(text: str, start: int, end: int) -> str:
    left = 0
    for match in _SENTENCE_END.finditer(text, 0, start):
        left = match.end()
    after = _SENTENCE_END.search(text, end)
    right = after.start() + 1 if after else len(text)
    sentence = text[left:right].strip()
    if len(sentence) > CONTEXT_MAX:
        cut = max(left, start - CONTEXT_MAX // 3)
        sentence = text[cut : cut + CONTEXT_MAX].strip()
    return sentence


def find_mentions(
    text: str,
    index: PhraseIndex,
    *,
    source_url_id: int,
    skip: AbstractSet[int],
    limit: int = MENTIONS_PER_PAGE,
) -> list[Mention]:
    """One mention per target: a keyword phrase before an anchor phrase, then the earliest in
    the text. A page never mentions itself and never a target in `skip` (the pages it already
    links to by an editorial link)."""
    spans = [(match.group(0).lower(), match.start(), match.end()) for match in _WORD.finditer(text)]
    best: dict[int, tuple[int, int, int, Origin, str]] = {}
    for first in range(len(spans)):
        for size in range(1, PHRASE_MAX_WORDS + 1):
            last = first + size
            if last > len(spans):
                break
            key = " ".join(word for word, _, _ in spans[first:last])
            for target, origin in index.get(key, ()):
                if target == source_url_id or target in skip:
                    continue
                rank = 0 if origin == "keyword" else 1
                start, end = spans[first][1], spans[last - 1][2]
                current = best.get(target)
                if current is None or (rank, start) < (current[0], current[1]):
                    best[target] = (rank, start, end, origin, text[start:end])
    ordered = sorted(best.items(), key=lambda item: (item[1][0], item[1][1], item[0]))
    return [
        Mention(
            target_url_id=target,
            phrase=shown,
            context=_sentence(text, start, end),
            origin=origin,
        )
        for target, (_, start, end, origin, shown) in ordered[:limit]
    ]
