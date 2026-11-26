"""The text of one page, read for the change hashes of the page history (spec 4.2).

`full_text` is everything a visitor could read; `main_text` is the body of the page without
its template (nav, header, footer, aside) and without links the crawl placed outside content.
A hash of `main_text` that moves is an edit; one that stays while the `full_text` hash moves
is a template change. Pure: no I/O. Pages are untrusted, so `read_page_text` never raises:
input is capped, every parser call keeps what was read, and every list and heading has a cap.
Same names as the outline reader of the Pages branch (`Heading`, `description`, `headings`,
`words`) so the two can be merged later.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final
from urllib.parse import urldefrag, urljoin

from idraft.crawl.placement import FoundLink, Placement, without_empty_comments

HTML_CHARS_MAX: Final = 2_000_000
HEADINGS_MAX: Final = 60
HEADING_TEXT_MAX: Final = 200
META_TEXT_MAX: Final = 1_000
ANCHOR_TEXT_MAX: Final = 1_000  # the cap `placement.classify` puts on anchors, so pairs match
HASH_BYTES: Final = 16

_CHUNK: Final = 65_536
_HIDDEN: Final = frozenset({"script", "style", "noscript", "template"})
_TEMPLATE: Final = frozenset({"nav", "header", "footer", "aside"})
_HEADINGS: Final = frozenset({"h1", "h2", "h3"})
# Tags that end a word; any other tag leaves its neighbours joined, so "fo<b>o</b>" is one word.
_BREAKS: Final = frozenset(
    {
        *("br", "hr", "p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "section"),
        *("article", "main", "nav", "header", "footer", "aside", "body", "title", "form"),
        *("h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "figure", "figcaption"),
        *("dl", "dt", "dd"),
    }
)
_WORD: Final = re.compile(r"[^\W_]+")
_SPACES: Final = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Heading:
    level: int
    text: str


@dataclass(frozen=True, slots=True)
class PageText:
    title: str | None
    description: str | None
    headings: tuple[Heading, ...]  # H1 to H3, at most HEADINGS_MAX
    words: int  # words of main_text
    main_text: str
    full_text: str


@dataclass(slots=True)
class _Piece:
    text: str
    template: bool  # inside nav, header, footer or aside
    in_main: bool
    in_article: bool
    dropped: bool = False  # inside a link the crawl placed outside content


def _squash(text: str) -> str:
    return _SPACES.sub(" ", text).strip()


class _Reader(HTMLParser):
    def __init__(self, page_url: str, skip: frozenset[tuple[str, str]]) -> None:
        super().__init__(convert_charrefs=True)
        self._url = page_url
        self._skip = skip
        self._hidden = 0
        self._template = 0
        self._main = 0
        self._main_done = False
        self._article = 0
        self._article_done = False
        self.pieces: list[_Piece] = []
        self.title: str | None = None
        self._in_title = False
        self._title = ""
        self.description: str | None = None
        self.headings: list[Heading] = []
        self._level = 0
        self._heading = ""
        self._href: str | None = None  # the open anchor's resolved address
        self._anchor: list[_Piece] = []
        self._anchor_text = ""

    def _break(self) -> None:
        self.pieces.append(_Piece("\n", self._template > 0, self._main > 0, self._article > 0))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HIDDEN:
            self._hidden += 1
            return
        if self._hidden:
            return
        if tag in _BREAKS:
            self._break()
        if tag in _HEADINGS:
            self.finish_heading()
            self._level, self._heading = int(tag[1]), ""
        elif tag in _TEMPLATE:
            self._template += 1
        elif tag == "main" and not self._main_done:
            self._main += 1
        elif tag == "article" and not self._article_done:
            self._article += 1
        elif tag == "a":
            self._open_anchor(dict(attrs).get("href"))
        elif tag == "title" and self.title is None:
            self._in_title, self._title = True, ""
        elif tag == "meta":
            found = dict(attrs)
            if (
                self.description is None
                and (found.get("name") or "").strip().lower() == "description"
            ):
                self.description = _squash(found.get("content") or "")[:META_TEXT_MAX] or None

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN:
            self._hidden = max(0, self._hidden - 1)
            return
        if self._hidden:
            return
        if tag in _BREAKS:
            self._break()
        if tag in _HEADINGS:
            self.finish_heading()
        elif tag in _TEMPLATE:
            self._template = max(0, self._template - 1)
        elif tag == "main" and self._main:
            self._main -= 1
            self._main_done = self._main == 0
        elif tag == "article" and self._article:
            self._article -= 1
            self._article_done = self._article == 0
        elif tag == "a":
            self.finish_anchor()
        elif tag == "title" and self._in_title:
            self._in_title = False
            self.title = _squash(self._title)[:META_TEXT_MAX] or None

    def handle_data(self, data: str) -> None:
        if self._hidden:
            return
        if self._in_title:
            self._title += data[:META_TEXT_MAX]
            return
        piece = _Piece(data, self._template > 0, self._main > 0, self._article > 0)
        self.pieces.append(piece)
        if self._level and len(self._heading) < HEADING_TEXT_MAX:
            self._heading += data[:HEADING_TEXT_MAX]
        if self._href is not None:
            self._anchor.append(piece)
            self._anchor_text += data[: ANCHOR_TEXT_MAX + 1]

    def _open_anchor(self, href: str | None) -> None:
        self.finish_anchor()
        try:
            self._href = urldefrag(urljoin(self._url, (href or "").strip())).url
        except ValueError:
            self._href = None
        else:
            self._anchor, self._anchor_text = [], ""

    def finish_anchor(self) -> None:
        if self._href is None:
            return
        text = _squash(self._anchor_text)[:ANCHOR_TEXT_MAX]
        if (self._href, text) in self._skip:
            for piece in self._anchor:
                piece.dropped = True
        self._href, self._anchor, self._anchor_text = None, [], ""

    def finish_heading(self) -> None:
        if self._level and (text := _squash(self._heading)) and len(self.headings) < HEADINGS_MAX:
            self.headings.append(Heading(self._level, text[:HEADING_TEXT_MAX]))
        self._level, self._heading = 0, ""


def _join(pieces: list[_Piece]) -> str:
    return _squash("".join(piece.text for piece in pieces))


def read_page_text(
    html: str, page_url: str, noncontent_links: frozenset[tuple[str, str]]
) -> PageText:
    """Read a page. `noncontent_links` holds (resolved address, anchor text) of the links the
    crawl placed outside content (`noncontent_links_of`). Never raises."""
    reader = _Reader(page_url, noncontent_links)
    cleaned = without_empty_comments(html[:HTML_CHARS_MAX])
    try:
        for start in range(0, len(cleaned), _CHUNK):
            reader.feed(cleaned[start : start + _CHUNK])
        reader.close()
    except Exception:  # garbage in: keep what was read before the parser gave up
        pass
    reader.finish_anchor()
    reader.finish_heading()
    pieces = reader.pieces
    if any(p.in_main for p in pieces):
        scope = [p for p in pieces if p.in_main]
    elif any(p.in_article for p in pieces):
        scope = [p for p in pieces if p.in_article]
    else:
        scope = pieces
    main_text = _join([p for p in scope if not p.template and not p.dropped])
    return PageText(
        title=reader.title,
        description=reader.description,
        headings=tuple(reader.headings),
        words=len(_WORD.findall(main_text)),
        main_text=main_text,
        full_text=_join(pieces),
    )


def content_hash(text: str) -> bytes:
    """The first 16 bytes of the sha256 of `text` with its whitespace normalised."""
    return hashlib.sha256(_squash(text).encode()).digest()[:HASH_BYTES]


def noncontent_links_of(links: Sequence[FoundLink]) -> frozenset[tuple[str, str]]:
    """The (address, anchor) pairs of every link the classifier placed outside content."""
    return frozenset(
        (link.href, link.anchor) for link in links if link.placement is not Placement.CONTENT
    )
