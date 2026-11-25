"""The canonical address a page names in the head of its HTML.

The provider's pages listing does not carry it (`meta.canonical` is empty on real crawls), but
the raw HTML does: `<link rel="canonical" href="...">`. `canonical_of` reads the first such link
of the document head, the way a search engine does: comments, `<template>`, `<noscript>` and
`<script>` hold nothing, and reading ends at `</head>` or the first `<body>`. Pure standard
library; pages are untrusted, so it never raises and reads at most `SCAN_MAX` characters.
"""

from __future__ import annotations

from html.parser import HTMLParser
from typing import Final
from urllib.parse import urljoin, urlsplit

from idraft.crawl.placement import without_empty_comments

HREF_MAX: Final = 4096
# shortcut: a head longer than this is not read past it; raise it when a real head needs more.
SCAN_MAX: Final = 1_000_000
_CHUNK: Final = 65_536
_HIDDEN: Final = frozenset({"template", "noscript"})


class _Head(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonical: str | None = None
        self.base: str | None = None
        self.done = False
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.done:
            return
        if tag in _HIDDEN:
            self._hidden += 1
        elif self._hidden:
            return
        elif tag == "body":
            self.done = True
        elif tag == "base" and self.base is None:
            self.base = dict(attrs).get("href")
        elif tag == "link" and self.canonical is None:
            found = dict(attrs)
            if "canonical" in (found.get("rel") or "").lower().split():
                self.canonical = found.get("href") or ""

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # `<template/>` opens nothing, so it must not hide what follows.
        if tag not in _HIDDEN:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN:
            self._hidden = max(0, self._hidden - 1)
        elif tag == "head" and not self._hidden:
            self.done = True


def canonical_of(html: str, page_url: str) -> str | None:
    """The first `<link rel=canonical>` href of the head, resolved against the page's URL and
    its `<base href>`; None when there is none or it is empty, longer than `HREF_MAX`,
    unparseable or not an http(s) address."""
    parser = _Head()
    html = without_empty_comments(html[:SCAN_MAX])
    try:
        for start in range(0, len(html), _CHUNK):
            parser.feed(html[start : start + _CHUNK])
            if parser.done:
                break
    except Exception:  # garbage in, so whatever the parser raises, the page names no canonical
        return None
    href = (parser.canonical or "").strip()
    if not href or len(href) > HREF_MAX:
        return None
    try:
        base = page_url
        if parser.base and len(parser.base) <= HREF_MAX:
            base = urljoin(page_url, parser.base.strip())
        # `https:///path` and `http:path` name no host; urljoin would borrow the page's.
        if (own := urlsplit(href)).scheme and not own.netloc:
            return None
        resolved = urljoin(base, href)
        parts = urlsplit(resolved)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.netloc or len(resolved) > HREF_MAX:
        return None
    return resolved
