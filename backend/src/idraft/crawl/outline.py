"""The outline of one page, read from its HTML: description, robots meta, language, headings,
hreflang pairs, Open Graph and Twitter tags, JSON-LD blocks, word count and images.

The title, the canonical address and the noindex verdict are not read here: the caller takes
them from the crawl row, so this screen and the Issues checks agree (spec 9.6.1). Pages are
untrusted, so `parse_outline` never raises: every parser call keeps what was read so far, every
text and every list has a cap, and a counter keeps counting past a list's cap. The Issues
checks of its second slice use these functions and constants for their columns.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final, Literal
from urllib.parse import urljoin, urlsplit

from idraft.crawl.lang_codes import LANGUAGES, REGIONS
from idraft.crawl.mentions import visible_blocks
from idraft.crawl.placement import without_empty_comments

LengthState = Literal["ok", "short", "long", "missing"]

TITLE_MIN: Final = 30
TITLE_MAX: Final = 60
DESCRIPTION_MIN: Final = 70
DESCRIPTION_MAX: Final = 160
THIN_WORDS: Final = 200
WORDS_PER_MINUTE: Final = 230
HTML_BYTES_MAX: Final = 2_000_000
HEADINGS_MAX: Final = 200
HEADING_TEXT_MAX: Final = 200
META_TEXT_MAX: Final = 1_000
HREF_MAX: Final = 2_048
HREFLANG_MAX: Final = 100
JSONLD_BLOCKS_MAX: Final = 20
JSONLD_BLOCK_CHARS_MAX: Final = 200_000
JSONLD_TYPES_MAX: Final = 10

_CHUNK: Final = 65_536
_CODE_MAX: Final = 64  # a language or hreflang code is far shorter; this only bounds junk
_TYPE_MAX: Final = 100
_HEADINGS: Final = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
# Inside a heading these end a word: "Foo<br>Bar" reads "Foo Bar".
_BREAKS: Final = frozenset(
    {"br", "hr", "p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "section", "article"}
)
# `script` is here too: its text is never a heading's or a word's.
_HIDDEN: Final = frozenset({"template", "noscript", "style", "script"})
_SOCIAL: Final = frozenset({"og:title", "og:description", "og:image", "og:type", "twitter:card"})
_REGION_FIXES: Final = {"uk": "GB"}
_WORD: Final = re.compile(r"[^\W_]+")
_SPACES: Final = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Heading:
    level: int
    text: str


@dataclass(frozen=True, slots=True)
class HreflangPair:
    code: str
    href: str
    is_self: bool
    valid: bool
    suggestion: str | None


@dataclass(frozen=True, slots=True)
class JsonLdBlock:
    types: tuple[str, ...]
    parses: bool


@dataclass(frozen=True, slots=True)
class ParsedOutline:
    description: str | None
    description_chars: int
    robots_meta: str | None
    html_lang: str | None
    # `headings_total` and `level_counts` count every heading, one with no text too (an image
    # or a stray tag), so an `<h1>` holding only a logo is not a missing H1. `headings` lists
    # only those with text, at most HEADINGS_MAX; `skipped_at` indexes that list.
    headings: tuple[Heading, ...]
    headings_total: int
    level_counts: tuple[int, int, int, int, int, int]
    skipped_at: int | None
    hreflang: tuple[HreflangPair, ...]
    x_default: bool
    og_title: str | None
    og_description: str | None
    og_image: str | None
    og_type: str | None
    twitter_card: str | None
    jsonld: tuple[JsonLdBlock, ...]
    words: int
    images: int
    images_without_alt: int


EMPTY_OUTLINE: Final = ParsedOutline(
    description=None,
    description_chars=0,
    robots_meta=None,
    html_lang=None,
    headings=(),
    headings_total=0,
    level_counts=(0, 0, 0, 0, 0, 0),
    skipped_at=None,
    hreflang=(),
    x_default=False,
    og_title=None,
    og_description=None,
    og_image=None,
    og_type=None,
    twitter_card=None,
    jsonld=(),
    words=0,
    images=0,
    images_without_alt=0,
)


def length_state(chars: int, low: int, high: int) -> LengthState:
    if chars <= 0:
        return "missing"
    if chars < low:
        return "short"
    return "long" if chars > high else "ok"


def read_minutes(words: int) -> int:
    return max(1, (words + WORDS_PER_MINUTE // 2) // WORDS_PER_MINUTE)


def hreflang_valid(code: str) -> tuple[bool, str | None]:
    """Whether a hreflang code is `x-default` or a language of ISO 639-1 with an optional
    script (four letters) and an optional region of ISO 3166-1 alpha-2, without letter case;
    and, for a known slip (`en-UK`), the code that was meant."""
    parts = code.lower().split("-")
    if parts == ["x", "default"]:
        return True, None
    if len(parts) > 3 or parts[0] not in LANGUAGES:
        return False, None
    rest = parts[1:]
    if rest and _is_script(rest[0]):
        rest = rest[1:]
    if not rest or (len(rest) == 1 and rest[0] in REGIONS):
        return True, None
    fix = _REGION_FIXES.get(rest[0]) if len(parts) == 2 else None
    return False, f"{parts[0]}-{fix}" if fix else None


def _is_script(part: str) -> bool:
    return len(part) == 4 and part.isascii() and part.isalpha()


def _resolve(href: str, page_url: str) -> str | None:
    """`href` against the page's URL; None unless it is a short http(s) address with a host."""
    href = href.strip()
    if not href or len(href) > HREF_MAX:
        return None
    try:
        # `https:///path` and `http:path` name no host; urljoin would borrow the page's.
        if (own := urlsplit(href)).scheme and not own.netloc:
            return None
        resolved = urljoin(page_url, href)
        parts = urlsplit(resolved)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.netloc or len(resolved) > HREF_MAX:
        return None
    return resolved


def _text(value: str | None) -> str | None:
    return (value or "").strip()[:META_TEXT_MAX] or None


class _Outline(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self._page_url = page_url
        self._hidden = 0
        self._in_body = False
        self._html_seen = False
        self._description_seen = False
        self._robots_seen = False
        self.html_lang: str | None = None
        self.description: str | None = None
        self.description_chars = 0
        self.robots_meta: str | None = None
        self.social: dict[str, str | None] = {}
        self.hreflang: list[HreflangPair] = []
        self.x_default = False
        self.headings: list[Heading] = []
        self.headings_total = 0
        self.level_counts = [0] * 6
        # (text, whether it is not to be parsed: over the cap, or never closed)
        self.jsonld: list[tuple[str, bool]] = []
        self.images = 0
        self.images_without_alt = 0
        self.skipped_at: int | None = None
        self._prev_level = 0  # the level of the last counted heading, 0 before the first
        self._skip_pending = False
        self._level = 0  # the open heading's level, 0 when none
        self._heading = ""
        self._ld: str | None = None  # the open JSON-LD block's text so far
        self._ld_over = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HEADINGS:
            self.finish_heading()
        elif tag in _BREAKS and self._level and not self._hidden:
            self.handle_data(" ")
        if tag in _HIDDEN:
            if tag == "script" and not self._hidden and self._is_json_ld(attrs):
                self._ld, self._ld_over = "", False
            self._hidden += 1
        elif self._hidden:
            return
        elif tag == "html" and not self._html_seen:
            self._html_seen = True
            self.html_lang = (dict(attrs).get("lang") or "").strip()[:_CODE_MAX] or None
        elif tag == "body":
            self._in_body = True
        elif tag in _HEADINGS:
            self._level, self._heading = int(tag[1]), ""
        elif tag == "img":
            self.images += 1
            if "alt" not in dict(attrs):
                self.images_without_alt += 1
        elif self._in_body:
            return
        elif tag == "meta":
            self._meta(dict(attrs))
        elif tag == "link":
            self._link(dict(attrs))

    def handle_endtag(self, tag: str) -> None:
        if tag in _HEADINGS:
            self.finish_heading()
        elif tag in _BREAKS and self._level and not self._hidden:
            self.handle_data(" ")
        elif tag in _HIDDEN:
            if tag == "script" and self._ld is not None:
                if len(self.jsonld) < JSONLD_BLOCKS_MAX:
                    self.jsonld.append((self._ld, self._ld_over))
                self._ld = None
            self._hidden = max(0, self._hidden - 1)

    def handle_data(self, data: str) -> None:
        if self._ld is not None:
            room = JSONLD_BLOCK_CHARS_MAX + 1 - len(self._ld)
            self._ld += data[:room]
            self._ld_over = len(self._ld) > JSONLD_BLOCK_CHARS_MAX
        elif self._level and not self._hidden and len(self._heading) < HEADING_TEXT_MAX:
            piece = _SPACES.sub(" ", data)
            if not self._heading:
                piece = piece.lstrip()
            elif self._heading.endswith(" "):
                piece = piece.removeprefix(" ")
            self._heading = (self._heading + piece)[:HEADING_TEXT_MAX]

    def finish_heading(self) -> None:
        if not self._level:
            return
        # Every heading is counted, so `<h1><img alt="Brand"></h1>` is an H1; one with no text
        # (an image, a stray tag) is not worth a row in the list.
        self.level_counts[self._level - 1] += 1
        self.headings_total += 1
        # A skip is measured against the previous counted heading and reported at the next
        # one with text, the index of that row in `headings`.
        if self._prev_level and self._level - self._prev_level > 1:
            self._skip_pending = True
        self._prev_level = self._level
        if text := self._heading.strip():
            if len(self.headings) < HEADINGS_MAX:
                if self._skip_pending and self.skipped_at is None:
                    self.skipped_at = len(self.headings)
                self.headings.append(Heading(self._level, text))
            self._skip_pending = False
        self._level, self._heading = 0, ""

    def finish_json_ld(self) -> None:
        """A JSON-LD script the page never closed is a block that does not parse."""
        if self._ld is not None and len(self.jsonld) < JSONLD_BLOCKS_MAX:
            self.jsonld.append((self._ld, True))
        self._ld = None

    @staticmethod
    def _is_json_ld(attrs: list[tuple[str, str | None]]) -> bool:
        kind = dict(attrs).get("type") or ""
        return kind.strip().lower() == "application/ld+json"

    def _meta(self, found: dict[str, str | None]) -> None:
        name = (found.get("name") or "").strip().lower()
        prop = (found.get("property") or "").strip().lower()
        content = found.get("content") or ""
        if name == "description" and not self._description_seen:
            self._description_seen = True
            trimmed = content.strip()
            self.description = trimmed[:META_TEXT_MAX] or None
            self.description_chars = len(trimmed)
        elif name == "robots" and not self._robots_seen:
            self._robots_seen = True
            self.robots_meta = _text(content)
        for key in (name, prop):
            if key in _SOCIAL and key not in self.social:
                self.social[key] = (
                    _resolve(content, self._page_url) if key == "og:image" else _text(content)
                )

    def _link(self, found: dict[str, str | None]) -> None:
        if "alternate" not in (found.get("rel") or "").lower().split():
            return
        code = (found.get("hreflang") or "").strip()[:_CODE_MAX]
        href = _resolve(found.get("href") or "", self._page_url)
        if not code or href is None:
            return
        if code.lower() == "x-default":
            self.x_default = True
        if len(self.hreflang) < HREFLANG_MAX:
            valid, suggestion = hreflang_valid(code)
            is_self = href == self._page_url
            self.hreflang.append(HreflangPair(code, href, is_self, valid, suggestion))


def _types_of(data: object) -> list[str]:
    """The `@type` values of a JSON-LD document's top level, of a top-level list and of `@graph`."""
    found: list[str] = []
    for node in data if isinstance(data, list) else [data]:
        if not isinstance(node, dict):
            continue
        graph = node.get("@graph")
        for item in [node, *(graph if isinstance(graph, list) else [graph])]:
            kinds = item.get("@type") if isinstance(item, dict) else None
            for kind in kinds if isinstance(kinds, list) else [kinds]:
                if not isinstance(kind, str):
                    continue
                if kind[:_TYPE_MAX] not in found:
                    found.append(kind[:_TYPE_MAX])
                if len(found) == JSONLD_TYPES_MAX:
                    return found
    return found


def _jsonld_block(text: str, unparsed: bool) -> JsonLdBlock:
    if unparsed:
        return JsonLdBlock((), False)
    try:
        return JsonLdBlock(tuple(_types_of(json.loads(text))), True)
    except Exception:  # not JSON, or nested past the recursion limit (RecursionError)
        return JsonLdBlock((), False)


def parse_outline(html: str, page_url: str) -> ParsedOutline:
    """Read the outline of a page. Never raises: whatever was read before a parser error is kept."""
    parser = _Outline(page_url)
    cleaned = without_empty_comments(html)
    try:
        for start in range(0, len(cleaned), _CHUNK):
            parser.feed(cleaned[start : start + _CHUNK])
        parser.close()
    except Exception:  # garbage in, so whatever the parser raises, keep what it has read
        pass
    parser.finish_heading()
    parser.finish_json_ld()
    try:
        words = sum(len(_WORD.findall(block)) for block in visible_blocks(html))
    except Exception:  # `visible_blocks` has no guard of its own
        words = 0
    counts = parser.level_counts
    social = parser.social
    return ParsedOutline(
        description=parser.description,
        description_chars=parser.description_chars,
        robots_meta=parser.robots_meta,
        html_lang=parser.html_lang,
        headings=tuple(parser.headings),
        headings_total=parser.headings_total,
        level_counts=(counts[0], counts[1], counts[2], counts[3], counts[4], counts[5]),
        skipped_at=parser.skipped_at,
        hreflang=tuple(parser.hreflang),
        x_default=parser.x_default,
        og_title=social.get("og:title"),
        og_description=social.get("og:description"),
        og_image=social.get("og:image"),
        og_type=social.get("og:type"),
        twitter_card=social.get("twitter:card"),
        jsonld=tuple(_jsonld_block(text, over) for text, over in parser.jsonld),
        words=words,
        images=parser.images,
        images_without_alt=parser.images_without_alt,
    )
