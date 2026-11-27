"""What one page's own HTML says, for the checks of the Issues page.

`read_facts` reads the description, the headings, the words, the images, the Open Graph tags, the
structured data, the language links and the resources a page loads over plain http, in one pass.
Elements inside `<template>` and `<noscript>` hold nothing, as in `crawl.head`. Pure standard
library; pages are untrusted, so it reads no page longer than `SCAN_MAX` characters, keeps only
counts, a hash and one short description of what it reads, and never raises: a page it cannot
read whole gives None. Inline tags (`<b>`, `<span>` and the like) join the text around them; any
other tag ends a word.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final
from urllib.parse import urljoin, urlsplit

from idraft.crawl.edges import clean_text
from idraft.crawl.placement import without_empty_comments
from idraft.extraction.urls import UrlRejectedError, canonicalize

# shortcut: a page longer than this is not read (its facts stay unread); raise it when a real page
# needs more.
SCAN_MAX: Final = 4_000_000
DESCRIPTION_MAX: Final = 1_000
# The largest count a smallint column holds.
SMALL_MAX: Final = 32_767
HREF_MAX: Final = 4_096
# shortcut: only the first language links of a page are read; raise it for a site with more.
ALTERNATES_MAX: Final = 1_000

_HIDDEN: Final = frozenset({"template", "noscript"})
_INLINE: Final = frozenset(
    {
        *("a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd"),
        *("mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u"),
        *("var", "wbr", "font", "img", "del", "ins", "label", "big", "tt", "strike"),
        *("ruby", "rt", "rp"),
    }
)
_HEAD_TAGS: Final = frozenset(
    {"title", "meta", "link", "script", "style", "base", "noscript", "template", "head"}
)
_SRC_TAGS: Final = frozenset(
    {"img", "script", "iframe", "video", "audio", "source", "track", "embed"}
)
_OG_NAMES: Final = frozenset({"og:title", "og:description", "og:image"})
# shortcut: the usual shape of a language tag (language, script, region), not the whole registry.
_LANGUAGE: Final = re.compile(r"[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?")
_X_DEFAULT: Final = "x-default"


@dataclass(frozen=True, slots=True)
class PageFacts:
    meta_description: str
    h1_count: int
    word_count: int
    text_hash: int | None
    images_without_alt: int
    og_complete: bool
    jsonld_errors: int
    hreflang_errors: int
    http_resources: int


def _refuse_constant(name: str) -> object:
    raise ValueError(f"{name} is not JSON")


def _skip_int(_digits: str) -> int:
    # A number of more than 4300 digits is valid JSON that `int()` refuses; only validity counts.
    return 0


def _json_is_valid(content: str) -> bool:
    try:
        json.loads(content, parse_constant=_refuse_constant, parse_int=_skip_int)
    except (ValueError, RecursionError):
        return False
    return True


class _Reader(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self._page_url = page_url
        self._https = urlsplit(page_url).scheme == "https"
        self._hidden = 0
        self._head = False
        self._title = 0
        self._raw: str | None = None
        self._json: list[str] | None = None
        self._h1_open = 0
        self._h1_has_text = False
        self.description: str | None = None
        self.h1_count = 0
        self.words = 0
        self._hasher = hashlib.blake2b(digest_size=8)
        self._tail = ""
        self.images_without_alt = 0
        self._og: set[str] = set()
        self.jsonld_errors = 0
        self._alternates: list[tuple[str, str]] = []
        self.http_resources = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in _INLINE:
            self._break()
        if tag == "body":
            # An unclosed head, template or noscript must not hide the body, as in a browser.
            self._hidden = 0
            self._title = 0
        if tag in _HIDDEN:
            self._hidden += 1
            return
        if self._hidden:
            return
        if self._head and tag not in _HEAD_TAGS:
            # `</head>` and `<body>` may be left out: a body-level tag ends the head.
            self._head = False
            self._title = 0
        found = {name: value or "" for name, value in attrs}
        if tag in _SRC_TAGS:
            self._resource(found.get("src", ""))
        if tag == "head":
            self._head = True
        elif tag == "body":
            self._head = False
        elif tag == "title":
            self._title += 1
        elif tag == "h1":
            self._h1_open += 1
        elif tag == "img" and "alt" not in found:
            self.images_without_alt += 1
        elif tag == "meta":
            self._meta(found)
        elif tag == "link":
            self._link(found)
        elif tag in ("script", "style"):
            self._raw = tag
            is_json = (
                tag == "script" and found.get("type", "").strip().lower() == "application/ld+json"
            )
            self._json = [] if is_json else None

    def handle_endtag(self, tag: str) -> None:
        if tag not in _INLINE:
            self._break()
        if tag in _HIDDEN:
            self._hidden = max(0, self._hidden - 1)
        elif self._hidden:
            return
        elif tag == "head":
            self._head = False
        elif tag == "title":
            self._title = max(0, self._title - 1)
        elif tag == "h1" and self._h1_open:
            self._h1_open -= 1
            if not self._h1_open:
                self._close_h1()
        elif tag == self._raw:
            self._close_raw()

    def handle_data(self, data: str) -> None:
        if self._hidden:
            return
        if self._raw is not None:
            if self._json is not None:
                self._json.append(data)
            return
        if self._head or self._title:
            return
        # The last word of a chunk may go on after an inline tag (`Hel<b>lo</b>`): it waits.
        found = (self._tail + data).split()
        self._tail = found.pop() if found and not data[-1:].isspace() else ""
        for word in found:
            self._count(word)
        if self._h1_open and data.strip():
            self._h1_has_text = True

    def _count(self, word: str) -> None:
        if self.words:
            self._hasher.update(b" ")
        self._hasher.update(word.lower().encode("utf-8", errors="replace"))
        self.words += 1

    def _break(self) -> None:
        if self._tail:
            self._count(self._tail)
            self._tail = ""

    def _close_h1(self) -> None:
        if self._h1_has_text:
            self.h1_count += 1
        self._h1_has_text = False

    def _close_raw(self) -> None:
        if self._json is not None and not _json_is_valid("".join(self._json)):
            self.jsonld_errors += 1
        self._raw = None
        self._json = None

    def _resource(self, url: str) -> None:
        if self._https and url.lstrip().lower().startswith("http://"):
            self.http_resources += 1

    def _meta(self, found: dict[str, str]) -> None:
        name = found.get("name", "").strip().lower()
        content = found.get("content", "").strip()
        if name == "description" and not self.description:
            self.description = clean_text(content, limit=DESCRIPTION_MAX)
        key = (found.get("property") or found.get("name") or "").strip().lower()
        if key in _OG_NAMES and content:
            self._og.add(key)

    def _link(self, found: dict[str, str]) -> None:
        relations = found.get("rel", "").lower().split()
        if "stylesheet" in relations:
            self._resource(found.get("href", ""))
        if (
            "alternate" in relations
            and "hreflang" in found
            and len(self._alternates) < ALTERNATES_MAX
        ):
            self._alternates.append((found["hreflang"].strip().lower(), found.get("href", "")))

    def _is_this_page(self, href: str, own: bytes) -> bool:
        if not href.strip() or len(href) > HREF_MAX:
            return False
        try:
            return canonicalize(urljoin(self._page_url, href.strip())).url_hash == own
        except (UrlRejectedError, ValueError):
            return False

    def _hreflang_errors(self) -> int:
        if not self._alternates:
            return 0
        codes = [code for code, _ in self._alternates]
        invalid = sum(1 for code in codes if code != _X_DEFAULT and not _LANGUAGE.fullmatch(code))
        repeated = len(codes) - len(set(codes))
        try:
            own = canonicalize(self._page_url).url_hash
        except (UrlRejectedError, ValueError):
            # A page whose own address cannot be read has no self link to look for.
            return invalid + repeated
        has_self = any(self._is_this_page(href, own) for _, href in self._alternates)
        return invalid + repeated + (0 if has_self else 1)

    def facts(self) -> PageFacts:
        self._break()
        if self._raw is not None:
            self._close_raw()
        if self._h1_open:
            self._close_h1()
        return PageFacts(
            meta_description=self.description or "",
            h1_count=min(self.h1_count, SMALL_MAX),
            word_count=self.words,
            text_hash=(
                int.from_bytes(self._hasher.digest(), "big", signed=True) if self.words else None
            ),
            images_without_alt=min(self.images_without_alt, SMALL_MAX),
            og_complete=self._og == _OG_NAMES,
            jsonld_errors=min(self.jsonld_errors, SMALL_MAX),
            hreflang_errors=min(self._hreflang_errors(), SMALL_MAX),
            http_resources=min(self.http_resources, SMALL_MAX),
        )


def read_facts(html: str, page_url: str) -> PageFacts | None:
    """The facts of one page's HTML, read against the page's own address (which tells whether it
    is an https page and which language link is its own). None when the page is longer than
    `SCAN_MAX` or the reader fails on it, so that a page it could not read whole is never taken
    for an empty one."""
    if len(html) > SCAN_MAX:
        return None
    reader = _Reader(page_url)
    try:
        reader.feed(without_empty_comments(html))
        reader.close()
        return reader.facts()
    except Exception:  # garbage in, so whatever the parser raises, the page's facts are unread
        return None
