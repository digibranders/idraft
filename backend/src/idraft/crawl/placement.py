"""Where a link sits on its page (docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md
section 6.3).

Two passes. `classify` reads one page and gives each link the placement of rules 1 to 5; a link
rule 4 leaves open is `auto_generated` with `open` set. `place_links` takes every page of a crawl
and runs the template pass, which needs the other pages of the same folder. Both are pure: no I/O,
no clock.

Pages are untrusted input, so the reader has fixed limits and its cost is linear in the size of
the page: the open-element stack holds at most `_MAX_DEPTH` elements (deeper ones are counted and
skipped, as browsers do), attributes are read up to `_ATTR_MAX` characters, anchors are kept up
to `_TEXT_MAX`, a link whose href is longer than `_HREF_MAX` is dropped, and the facts a link
needs from its ancestors are computed once per element, when the element opens.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import StrEnum
from html.parser import HTMLParser
from typing import Final, Literal
from urllib.parse import urldefrag, urljoin, urlsplit


class Placement(StrEnum):
    CONTENT = "content"
    AUTO_GENERATED = "auto_generated"
    NAVIGATION = "navigation"
    HEADER = "header"
    FOOTER = "footer"
    SIDEBAR = "sidebar"
    BREADCRUMB = "breadcrumb"


PLACEMENTS: Final[tuple[str, ...]] = tuple(placement.value for placement in Placement)
LinkKind = Literal["text", "image"]

# Template pass thresholds. TEMPLATE_SHARE is the spec's 50%; the other three are the guards
# of plan 01 Decision 6 (amendments to section 6.3, settled by spike S-17).
TEMPLATE_SHARE: Final = 0.5
SAME_TARGETS: Final = 0.8
STEADY_COUNT: Final = 0.8
MIN_FOLDER_PAGES: Final = 4

# Reader limits (see the module docstring).
_MAX_DEPTH: Final = 256
_ATTR_MAX: Final = 1_000
_TEXT_MAX: Final = 1_000
_HREF_MAX: Final = 4_096
_REL_MAX: Final = 256
# A container path keeps the nearest steps only, each with a few short class names, so a link
# deep in a page of long class lists still gets a short path.
_PATH_STEPS: Final = 20
_STEP_CLASSES: Final = 6
_CLASS_MAX: Final = 32
_TAG_MAX: Final = 32

# Rule 1: names of article navigation, post navigation, pagination, related, recent, popular
# and more posts blocks, matched as whole words of the normalized attribute text.
_AUTO_MARKERS: Final = re.compile(
    r"\b(?:(?:article|post|posts|entry|story) nav(?:igation)?"
    r"|nav (?:previous|next)|pagination|pager|paging|wp pagenavi|related|recent|popular"
    r"|(?:more|latest|similar) (?:posts|articles|stories))\b"
)
# Link text that is a pager control: Previous or Next with an arrow or angle quote before it, or
# followed by a colon, a pipe, an arrow or angle quote, or a dash set off by spaces. "Next.js",
# "Next-gen" and "Next steps" are ordinary words and do not match. The marks are built from
# code points (guillemets, single angle quotes, left and right arrows, en and em dashes).
_BEFORE: Final = re.escape("<" + "".join(map(chr, (0xAB, 0x2039, 0x2190, 0x2192))))
_AFTER: Final = re.escape(":|>" + "".join(map(chr, (0xBB, 0x203A, 0x2192))))
_DASH: Final = re.escape("-" + "".join(map(chr, (0x2013, 0x2014))))
_PREV_NEXT_TEXT: Final = re.compile(
    rf"^\s*(?:[{_BEFORE}]\s*(?:previous|next)\b|(?:previous|next)\s*(?:[{_AFTER}]|\s[{_DASH}]\s))",
    re.IGNORECASE,
)
# WordPress puts the terms of a post in its classes (`category-popular`, `tag-recent`,
# `post-5`): they name no block, so they are never read as markers or kept in a container path.
_TERM_CLASS: Final = re.compile(r"(?:category|tag|post_tag|type|postid)-\S*|post-\d\S*")
_CAMEL: Final = re.compile(r"([a-z0-9])([A-Z])")
_NOT_WORD: Final = re.compile(r"[^a-z0-9]+")
# Class names that are the same on every page: letters, hyphens and underscores only, and not
# a state that follows the page in view (the menu item of the current page).
_STABLE_CLASS: Final = re.compile(r"[a-z][a-z_-]*")
_STATE_CLASS: Final = re.compile(r"active|current|selected|open")
_ROLES: Final = {
    "navigation": "nav",
    "banner": "header",
    "contentinfo": "footer",
    "complementary": "aside",
    "main": "main",
}
_UNNAMED: Final = ("html", "body")
# fmt: off
_VOID: Final = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
})
# Blocks whose start ends an open paragraph (the HTML parsing rule, simplified).
_ENDS_P: Final = frozenset({
    "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figure", "footer",
    "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "main", "nav", "ol", "p", "pre",
    "section", "table", "ul",
})
# The containers the template pass groups links by.
_BLOCKS: Final = frozenset({
    "article", "aside", "blockquote", "dd", "div", "dl", "figure", "footer", "form", "header",
    "li", "main", "nav", "ol", "p", "section", "table", "td", "ul",
})
# fmt: on
_P_SCOPE: Final = (_ENDS_P - {"p"}) | {"li", "td", "th", "body", "html", "button"}
_PARAGRAPH: Final = frozenset({"p"})
# Start tags that end an open element of the same kind (the HTML parsing rule, simplified):
# the tags it ends, and the tags that stop the search for it.
_IMPLIED_ENDS: Final = {
    "li": (frozenset({"li"}), frozenset({"ul", "ol", "menu"})),
    "tr": (frozenset({"tr"}), frozenset({"table"})),
    "td": (frozenset({"td", "th"}), frozenset({"tr", "table"})),
    "th": (frozenset({"td", "th"}), frozenset({"tr", "table"})),
    "dt": (frozenset({"dt", "dd"}), frozenset({"dl"})),
    "dd": (frozenset({"dt", "dd"}), frozenset({"dl"})),
}


@dataclass(frozen=True, slots=True)
class FoundLink:
    """One link of a page. `href` is absolute, without its fragment; `anchor` is its accessible
    text (aria-label, words, or the alt of its images); `open` is true for a link rule 4 left to
    the template pass, which stays `auto_generated` unless the pass claims it."""

    href: str
    anchor: str
    kind: LinkKind
    rel: frozenset[str]
    placement: Placement
    container: str
    open: bool


@dataclass(eq=False, slots=True)
class _Element:
    """An open element with what its descendants need to know of it and of everything above it.
    The flags are cumulative: each is true when it holds for this element or any ancestor."""

    tag: str
    parent: _Element | None
    classes: str
    auto: bool
    breadcrumb: bool
    nav: bool
    aside: bool
    main: bool
    article: bool
    noscript: bool
    # "header" or "footer" for the outermost such landmark that is not inside main or article.
    template_landmark: str | None
    # The nearest block container at or above this element.
    block: _Element | None = None
    step: str | None = None
    path: str | None = None


_ROOT: Final = _Element(
    tag="",
    parent=None,
    classes="",
    auto=False,
    breadcrumb=False,
    nav=False,
    aside=False,
    main=False,
    article=False,
    noscript=False,
    template_landmark=None,
    path="",
)


@dataclass(slots=True)
class _RawLink:
    href: str
    rel: str
    label: str
    parent: _Element
    text: list[str] = field(default_factory=list)
    alts: list[str] = field(default_factory=list)
    has_image: bool = False
    size: int = 0


def _has_marker(label: str, classes: str, ident: str) -> bool:
    kept = " ".join(name for name in classes.split() if not _TERM_CLASS.fullmatch(name.lower()))
    raw = f"{label} {kept} {ident}"
    text = " " + _NOT_WORD.sub(" ", _CAMEL.sub(r"\1 \2", raw).lower()) + " "
    return _AUTO_MARKERS.search(text) is not None


def _landmark(tag: str, role: str) -> str:
    words = role.split()
    return _ROLES.get(words[0].lower(), tag) if words else tag


def _make(tag: str, values: Mapping[str, str], parent: _Element) -> _Element:
    label = values.get("aria-label", "")[:_ATTR_MAX]
    classes = values.get("class", "")[:_ATTR_MAX]
    ident = values.get("id", "")[:_ATTR_MAX]
    itemtype = values.get("itemtype", "")[:_ATTR_MAX]
    landmark = _landmark(tag, values.get("role", "")[:_ATTR_MAX])
    named = tag not in _UNNAMED
    element = _Element(
        tag=tag,
        parent=parent,
        classes=classes,
        auto=parent.auto or (named and _has_marker(label, classes, ident)),
        breadcrumb=parent.breadcrumb
        or (
            named
            and any("breadcrumb" in value.lower() for value in (label, classes, ident, itemtype))
        ),
        nav=parent.nav or landmark == "nav",
        aside=parent.aside or landmark == "aside",
        main=parent.main or landmark == "main",
        article=parent.article or landmark == "article",
        noscript=parent.noscript or tag == "noscript",
        template_landmark=parent.template_landmark
        or (
            landmark
            if landmark in ("header", "footer") and not (parent.main or parent.article)
            else None
        ),
    )
    element.block = element if tag in _BLOCKS else parent.block
    return element


class _Reader(HTMLParser):
    """Builds the open-element stack while reading, and keeps each link with its parent element.

    shortcut: `html.parser` builds no HTML5 tree; only the implied ends that move links between
    containers (`p`, `li`, table rows and cells, `dt` and `dd`, nested `a`) are handled, `/>`
    closes only void elements and links (as in HTML, not in SVG), and elements nested deeper than
    `_MAX_DEPTH` are not kept. Upgrade to an HTML5 parser (selectolax or lxml) if spike S-17
    finds links misplaced by broken markup.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[_Element] = []
        self.links: list[_RawLink] = []
        self.articles = 0
        self.base: str | None = None
        self._open: _RawLink | None = None
        # Stack size when the open link began: closing an element below it ends the link.
        self._open_depth = 0
        self._in_template = 0
        # Elements opened past the depth limit and not yet closed, by tag. They are children of
        # the top of the stack, so they are forgotten when the stack pops.
        self._skipped: Counter[str] = Counter()
        # The tags on the stack, so an end tag or implied end that matches nothing costs nothing.
        self._open_tags: Counter[str] = Counter()

    @property
    def _top(self) -> _Element:
        return self.stack[-1] if self.stack else _ROOT

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "template":
            self._in_template += 1
            return
        if self._in_template:
            return
        values = {name: value or "" for name, value in attrs}
        if tag == "base" and self.base is None and values.get("href"):
            self.base = values["href"]
        # A lazy-load page repeats each image inside noscript: its alt text is not new text.
        if tag == "img" and self._open is not None and not self._top.noscript:
            self._add_image(self._open, values.get("alt", ""))
        if tag in _VOID:
            return
        if tag == "a":
            self._finish()
            if "href" in values:
                self._open = _RawLink(
                    href=values["href"],
                    rel=values.get("rel", "")[:_REL_MAX],
                    label=values.get("aria-label", "")[:_ATTR_MAX],
                    parent=self._top,
                )
                self._open_depth = len(self.stack)
            return
        if tag in _ENDS_P:
            self._close(_PARAGRAPH, _P_SCOPE)
        implied = _IMPLIED_ENDS.get(tag)
        if implied is not None:
            self._close(*implied)
        if tag == "article":
            self.articles += 1
        if len(self.stack) >= _MAX_DEPTH:
            self._skipped[tag] += 1
            return
        self.stack.append(_make(tag, values, self._top))
        self._open_tags[tag] += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # `/>` ends only void elements and links; on any other HTML element it is ignored.
        self.handle_starttag(tag, attrs)
        if tag == "a":
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "template":
            self._in_template = max(0, self._in_template - 1)
            return
        if self._in_template or tag in _VOID:
            return
        if tag == "a":
            self._finish()
            return
        if self._skipped[tag]:
            self._skipped[tag] -= 1
            return
        if not self._open_tags[tag]:
            return
        index = len(self.stack) - 1
        while self.stack[index].tag != tag:  # the tag is open, so this stops
            index -= 1
        self._pop_to(index)

    def handle_data(self, data: str) -> None:
        link = self._open
        if link is None or self._in_template or link.size >= _TEXT_MAX:
            return
        piece = " ".join(data[: 8 * _TEXT_MAX].split())
        if data[:1].isspace():
            piece = " " + piece
        if piece and data[-1:].isspace():
            piece += " "
        piece = piece[: _TEXT_MAX - link.size]
        link.text.append(piece)
        link.size += len(piece)

    def close(self) -> None:
        super().close()
        self._finish()

    def _add_image(self, link: _RawLink, alt: str) -> None:
        link.has_image = True
        piece = " ".join(alt[: 8 * _TEXT_MAX].split())[: _TEXT_MAX - link.size]
        if piece and link.size < _TEXT_MAX:
            link.alts.append(piece)
            link.size += len(piece)

    def _close(self, tags: frozenset[str], scope: frozenset[str]) -> None:
        """Close the nearest open element of `tags` unless an element of `scope` is in the way."""
        if not any(self._open_tags[tag] for tag in tags):
            return
        for index in range(len(self.stack) - 1, -1, -1):
            name = self.stack[index].tag
            if name in tags:
                self._pop_to(index)
                return
            if name in scope:
                return

    def _pop_to(self, index: int) -> None:
        if index < self._open_depth:
            self._finish()
        for element in self.stack[index:]:
            self._open_tags[element.tag] -= 1
        del self.stack[index:]
        self._skipped.clear()

    def _finish(self) -> None:
        if self._open is not None:
            self.links.append(self._open)
            self._open = None


def _first_pass(
    parent: _Element, rel: frozenset[str], text: str, articles: int
) -> Placement | None:
    """Rules 1 to 5; None when rule 4 leaves the link open. `parent` is the element holding the
    link, whose flags cover every ancestor."""
    if rel & {"prev", "next"} or _PREV_NEXT_TEXT.match(text) or parent.auto:
        return Placement.AUTO_GENERATED
    if parent.breadcrumb:
        return Placement.BREADCRUMB
    if parent.nav:
        return Placement.NAVIGATION
    if parent.template_landmark is not None:
        return Placement.HEADER if parent.template_landmark == "header" else Placement.FOOTER
    if parent.aside:
        return Placement.SIDEBAR
    if articles == 1 and parent.main and not parent.article:
        return None
    return Placement.CONTENT


def _step(element: _Element) -> str:
    if element.step is None:
        names = sorted(
            {
                name
                for name in element.classes.lower().split()
                if len(name) <= _CLASS_MAX
                and _STABLE_CLASS.fullmatch(name)
                and not _STATE_CLASS.search(name)
                and not _TERM_CLASS.fullmatch(name)
            }
        )[:_STEP_CLASSES]
        element.step = "".join([element.tag[:_TAG_MAX], *(f".{name}" for name in names)])
    return element.step


def _container(parent: _Element) -> str:
    """The structural path of the nearest block container (the parent itself when no block is
    above the link), list positions left out, at most the nearest `_PATH_STEPS` steps."""
    anchor = parent.block or parent
    if anchor.path is None:
        steps: list[str] = []
        element: _Element | None = anchor
        while element is not None and element is not _ROOT and len(steps) < _PATH_STEPS:
            steps.append(_step(element))
            element = element.parent
        anchor.path = "/".join(reversed(steps))
    return anchor.path


def page_key(url: str) -> str:
    """A URL as compared for self links: host in lower case, no trailing slash, no fragment."""
    parts = urlsplit(url)
    path = parts.path.rstrip("/") or "/"
    return f"{(parts.hostname or '').lower()}{path}?{parts.query}"


def folder_of(url: str) -> str:
    """The top-level folder the template pass groups a page by: `blog` for `/blog/a-post`,
    and the empty string for the home page and pages one level deep."""
    segments = [segment for segment in urlsplit(url).path.split("/") if segment]
    return segments[0] if len(segments) > 1 else ""


def _base_url(page_url: str, base: str | None) -> str:
    try:
        return urljoin(page_url, base) if base else page_url
    except ValueError:
        return page_url


def classify(html: str, page_url: str) -> list[FoundLink]:
    """Rules 1 to 5 for every link of one page, in document order. Jump links, links to the
    page itself, links that are not http or https and links that cannot be parsed or are longer
    than `_HREF_MAX` characters are dropped first."""
    reader = _Reader()
    reader.feed(html)
    reader.close()
    base = _base_url(page_url, reader.base)
    own = page_key(page_url)
    found: list[FoundLink] = []
    for raw in reader.links:
        if len(raw.href) > _HREF_MAX:
            continue
        href = raw.href.strip()
        if not href or href.startswith("#"):
            continue
        try:
            target = urldefrag(urljoin(base, href)).url
            scheme = urlsplit(target).scheme
            key = page_key(target)
        except ValueError:
            continue
        if scheme not in ("http", "https") or key == own:
            continue
        words = " ".join("".join(raw.text).split())
        alts = " ".join(" ".join(raw.alts).split())
        text = " ".join(raw.label.split()) or words or alts
        rel = frozenset(raw.rel.lower().split())
        placement = _first_pass(raw.parent, rel, text, reader.articles)
        found.append(
            FoundLink(
                href=target,
                anchor=text,
                kind="image" if raw.has_image and not words else "text",
                rel=rel,
                placement=Placement.AUTO_GENERATED if placement is None else placement,
                container=_container(raw.parent),
                open=placement is None,
            )
        )
    return found


def place_links(
    pages: Mapping[str, Sequence[FoundLink]],
    *,
    template_share: float = TEMPLATE_SHARE,
    same_targets: float = SAME_TARGETS,
    steady_count: float = STEADY_COUNT,
    min_folder_pages: int = MIN_FOLDER_PAGES,
) -> dict[str, list[FoundLink]]:
    """The template pass over every page of a crawl, keyed by page URL, links in the same order.
    It only changes links the first pass called `content` or left open; an open link it does not
    claim stays `auto_generated`."""
    folders: dict[str, list[str]] = defaultdict(list)
    for url in pages:
        folders[folder_of(url)].append(url)
    claimed: dict[tuple[str, int], Placement] = {}
    for urls in folders.values():
        if len(urls) < min_folder_pages:
            continue
        # container -> page -> positions of the links the pass may change
        blocks: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
        for url in urls:
            for position, link in enumerate(pages[url]):
                if link.open or link.placement is Placement.CONTENT:
                    blocks[link.container][url].append(position)
        for on_pages in blocks.values():
            if len(on_pages) < template_share * len(urls):
                continue
            placement = _block_placement(pages, on_pages, same_targets, steady_count)
            if placement is None:
                continue
            for url, positions in on_pages.items():
                for position in positions:
                    claimed[(url, position)] = placement
    return {
        url: [
            replace(link, placement=claimed[(url, position)])
            if (url, position) in claimed
            else link
            for position, link in enumerate(links)
        ]
        for url, links in pages.items()
    }


def _block_placement(
    pages: Mapping[str, Sequence[FoundLink]],
    on_pages: Mapping[str, Sequence[int]],
    same_targets: float,
    steady_count: float,
) -> Placement | None:
    # For each target of the block, on how many of the block's pages it is linked.
    linked: Counter[str] = Counter()
    targets: dict[str, set[str]] = {}
    for url, positions in on_pages.items():
        targets[url] = {page_key(pages[url][position].href) for position in positions}
        linked.update(targets[url])
    # A page's link to itself was dropped, so a page counts as linking to itself here.
    for url in on_pages:
        key = page_key(url)
        if key in linked and key not in targets[url]:
            linked[key] += 1
    if sum(linked.values()) / (len(on_pages) * len(linked)) >= same_targets:
        return Placement.NAVIGATION
    counts = Counter(len(positions) for positions in on_pages.values())
    if counts.most_common(1)[0][1] / len(on_pages) >= steady_count:
        return Placement.AUTO_GENERATED
    return None
