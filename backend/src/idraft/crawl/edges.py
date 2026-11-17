"""The internal links of one crawled page as stored edges (spec 6.3 step 4; plan decision D7).

Each classified link's href is canonicalized (canonicalizer v1). Links to another site, links
that cannot name a page and links from the page to itself (jump links included: the fragment
is not part of a page's URL) are dropped. What is left is counted once per (target, placement,
anchor, kind, container, open, rel) with its occurrences. The container, the open flag and the
rel set are part of the key so that a merge never hides which block a link sat in (the template
pass works per container), whether the first pass left it open, or whether it passes equity;
`followed` is therefore the same for every occurrence of an edge. A link the first pass called
`content`, or left open (rule 4), is a template candidate for the second pass
(`idraft.crawl.template`).

A port other than the scheme's default is part of the URL, so a link to `example.com:8443` is an
edge to another page than `example.com`.

Pages are untrusted input. Anchors are read up to eight times `ANCHOR_MAX` characters
(`clean_text`), lose control characters, lone surrogates and invisible or bidi marks (a NUL or
a lone surrogate would be refused by the database; the joiners U+200C and U+200D stay, they
carry meaning in Persian,
Indic scripts and emoji), are put in NFC, have their whitespace collapsed and are cut to
`ANCHOR_MAX`. Each distinct href is canonicalized once per page.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final, Literal

from idraft.crawl.placement import FoundLink
from idraft.crawl.scopes import LinkScope, scope_of
from idraft.extraction.urls import CanonicalUrl, UrlRejectedError, canonicalize

ANCHOR_MAX: Final = 500
_OCCURRENCES_MAX: Final = 32_767
# Control characters that are not whitespace, U+200B, the left-to-right and right-to-left marks,
# the bidi embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069), U+061C, the
# invisible operators (U+2060 to U+2064), the byte order mark and lone surrogates.
_INVISIBLE: Final = re.compile(
    r"[\x00-\x08\x0e-\x1b\x7f-\x84\x86-\x9f"
    r"\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064"
    r"\u2066-\u2069\u061c\ufeff"
    r"\ud800-\udfff]"
)


@dataclass(frozen=True, slots=True)
class PageEdge:
    target: CanonicalUrl
    anchor: str
    kind: Literal["text", "image"]
    placement: str
    scope: LinkScope
    rel: tuple[str, ...]
    followed: bool
    occurrences: int
    container_hash: int | None
    template_candidate: bool


def container_hash(container: str) -> int:
    """A stable signed 64-bit number for a container path (`seo.crawl_links.container_hash`)."""
    digest = hashlib.blake2b(container.encode("utf-8", "replace"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def clean_text(text: str, *, limit: int) -> str:
    """Text of a page as it may be stored: read up to eight times `limit` characters, stripped
    of what the database refuses and of invisible marks, in NFC, whitespace collapsed, and cut
    to `limit`. The anchors of a page and the titles the provider reports go through it."""
    cleaned = unicodedata.normalize("NFC", _INVISIBLE.sub("", text[: 8 * limit]))
    return " ".join(cleaned.split())[:limit].rstrip()


def is_clean(text: str) -> bool:
    """Whether the text holds none of what `clean_text` removes (control characters, lone
    surrogates, invisible and bidi marks). An address that does not is not stored."""
    return _INVISIBLE.search(text) is None


def _anchor(text: str) -> str:
    return clean_text(text, limit=ANCHOR_MAX)


def page_edges(
    links: Sequence[FoundLink], *, page: CanonicalUrl, hosts: frozenset[str]
) -> list[PageEdge]:
    """The page's edges in document order of their first occurrence."""
    found: dict[tuple[bytes, str, str, str, int | None, bool, tuple[str, ...]], PageEdge] = {}
    canonical: dict[str, CanonicalUrl | None] = {}
    for link in links:
        if link.href not in canonical:
            try:
                canonical[link.href] = canonicalize(link.href)
            except UrlRejectedError:
                canonical[link.href] = None
        target = canonical[link.href]
        if target is None or target.host.name not in hosts or target.url_hash == page.url_hash:
            continue
        anchor = _anchor(link.anchor)
        placement = str(link.placement)
        rel = tuple(
            sorted({token for raw in link.rel if (token := _INVISIBLE.sub("", raw).lower())})
        )
        chash = container_hash(link.container) if link.container else None
        key = (target.url_hash, placement, anchor, link.kind, chash, link.open, rel)
        before = found.get(key)
        if before is not None:
            found[key] = replace(before, occurrences=min(before.occurrences + 1, _OCCURRENCES_MAX))
            continue
        found[key] = PageEdge(
            target=target,
            anchor=anchor,
            kind=link.kind,
            placement=placement,
            scope=scope_of(placement),
            rel=rel,
            followed="nofollow" not in rel,
            occurrences=1,
            container_hash=chash,
            template_candidate=placement == "content" or link.open,
        )
    return list(found.values())
