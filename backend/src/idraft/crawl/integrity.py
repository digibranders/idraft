"""Did the reader of a page's HTML find the links the HTML holds? (plan 12)

A pure module: it imports nothing else of idraft, like `crawl.placement`. It is a second,
independent reading of the same HTML: `anchor_count` does not use `html.parser`, so the bug it
guards against (a parser that lost every link below an empty comment, 2026-11-26) cannot also
blind it.

`HTML_READER_VERSION` says which reading of HTML a crawl was stored by. Raise it in the same commit
that changes what `idraft.collectors.crawl_ingest.page_links_from_html` returns for the same HTML
(its links, canonical or facts: `classify`, `canonical_of`, `read_facts`, and the edge building
after them). The golden test beside the constant fails until it is raised. It only protects the
HTML shapes in its fixtures: the real bug was a shape nobody had.
"""

from __future__ import annotations

import re
from typing import Final
from urllib.parse import urljoin, urlsplit

# 1: the reader before the empty-comment fix of 2026-11-26. 2: the reader since.
HTML_READER_VERSION: Final = 2

# What the reader does not read as links: comments (and empty ones), scripts, styles, templates.
_OPENER: Final = re.compile(r"<!--|<(script|style|template)\b", re.IGNORECASE)
_CLOSERS: Final = {
    name: re.compile(rf"</{name}\b[^>]*>", re.IGNORECASE)
    for name in ("script", "style", "template")
}
# A tag has no `<` or `>` inside: a quoted value that has one cuts the tag early, which counts
# fewer links (the safe direction), and a scan can never run past the next `<`, so the cost of the
# whole page is linear whatever it holds.
_ANCHOR: Final = re.compile(r"<a(?=\s)([^<>]*)>", re.IGNORECASE)
_HREF: Final = re.compile(r"\shref\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))", re.IGNORECASE)
_SCHEME: Final = re.compile(r"^[a-z][a-z0-9+.\-]*:", re.IGNORECASE)
_KEPT_SCHEMES: Final = ("http:", "https:")
# Lost links are an error of tens of links on a page that holds hundreds: a few are slack (a link
# the reader drops on purpose that this count keeps), and small pages must not be flagged by one.
_SLACK_MIN: Final = 3
_SLACK_PERCENT: Final = 3
_EMPTY_PAGE_MIN: Final = 3


def _visible(html: str) -> str:
    """`html` without its comments, scripts, styles and templates. A block that never closes
    hides nothing (the reader loses the rest of such a page; this count keeps it, and shows it)."""
    parts: list[str] = []
    pos = 0
    while (opener := _OPENER.search(html, pos)) is not None:
        if opener.group(1) is None:  # a comment
            if html.startswith(">", opener.end()):
                end = opener.end() + 1
            elif html.startswith("->", opener.end()):
                end = opener.end() + 2
            else:
                close = html.find("-->", opener.end())
                if close < 0:
                    break
                end = close + 3
        else:
            closer = _CLOSERS[opener.group(1).lower()].search(html, opener.end())
            if closer is None:
                break
            end = closer.end()
        parts.append(html[pos : opener.start()])
        pos = end
    parts.append(html[pos:])
    return "".join(parts)


def _own(target: str, page_url: str) -> bool:
    """Whether `target` is the page itself: the reader keeps no link from a page to itself."""
    try:
        page = urlsplit(page_url)
        link = urlsplit(urljoin(page_url, target))
    except ValueError:
        return False  # an address that cannot be read: the reader drops it too
    return (link.scheme, link.netloc, link.path.rstrip("/"), link.query) == (
        page.scheme,
        page.netloc,
        page.path.rstrip("/"),
        page.query,
    )


def anchor_count(html: str, page_url: str = "") -> int:
    """The links in `html` that a reader keeps: anchors with an `href` that is a path, a `//`
    address or `http(s):`, outside comments, scripts, styles and templates; with `page_url`, not
    the page's own address. It takes time in proportion to the size of the HTML."""
    count = 0
    for tag in _ANCHOR.finditer(_visible(html)):
        match = _HREF.search(tag.group(1))
        if match is None:
            continue
        target = next(group for group in match.groups() if group is not None).strip()
        if not target or target.startswith("#"):
            continue
        scheme = _SCHEME.match(target)
        if scheme is not None and scheme.group(0).lower() not in _KEPT_SCHEMES:
            continue
        if page_url and _own(target, page_url):
            continue
        count += 1
    return count


def links_suspect(raw: int, read: int) -> bool:
    """Whether a page's links were lost: the HTML holds `raw` links and the reader returned `read`.
    True for a page that lost all of three or more, or more than a few (3, or 3% of them)."""
    if read == 0:
        return raw >= _EMPTY_PAGE_MIN
    return raw - read > max(_SLACK_MIN, raw * _SLACK_PERCENT // 100)
