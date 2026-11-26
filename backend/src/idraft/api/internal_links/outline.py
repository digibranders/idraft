"""The outline of one page for the Outline tab (Pages spec 9.6.1): the verdicts the crawl row
already holds, joined to what `crawl/outline.py` reads from the stored HTML.

The title, the canonical address and the noindex verdict come from the crawl row with the rules
of the Issues checks, so this tab and the Issues page cannot disagree."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Final, Literal

from idraft.api.schemas.internal_links_extra import (
    OutlineCanonical,
    OutlineContent,
    OutlineHeading,
    OutlineLanguagePair,
    OutlineLanguages,
    OutlineRobots,
    OutlineSocial,
    OutlineStructuredBlock,
    OutlineText,
    PageOutlineBody,
)
from idraft.crawl.outline import (
    DESCRIPTION_MAX,
    DESCRIPTION_MIN,
    HTML_BYTES_MAX,
    THIN_WORDS,
    TITLE_MAX,
    TITLE_MIN,
    ParsedOutline,
    length_state,
    read_minutes,
)
from idraft.storage.raw import ObjectStore, RawStorageError, inflate_head

# The reasons `crawl_pages.non_indexable_reason` holds for a noindex the page itself asked for
# (the `noindex` check of the Issues rules tests the same two).
NOINDEX_REASONS: Final = ("meta_tag", "http_header")


@dataclass(frozen=True, slots=True)
class OutlineRow:
    url: str
    url_hash: bytes
    url_id: int
    status_code: int | None
    resource_type: str | None
    title: str | None
    canonical_url_id: int | None
    canonical_url: str | None
    non_indexable_reason: str | None


def row_state(row: OutlineRow) -> Literal["ok", "redirect", "error", "not_html"]:
    status = row.status_code
    if status is not None and 300 <= status <= 399:
        return "redirect"
    if status == 200:
        return "ok" if row.resource_type == "html" else "not_html"
    return "error"


async def stored_html(store: ObjectStore | None, key: str) -> tuple[str, bool] | None:
    """The page's stored HTML up to the byte cap and whether it was cut; None when it cannot be
    read: no storage, no object, or an object that is not a compressed payload."""
    if store is None:
        return None
    try:
        # shortcut: the store has no ranged read, a page's HTML packs to well under a megabyte;
        # add a range to ObjectStore.get when a stored page is ever larger.
        data = await store.get(key)
        head, truncated = await asyncio.to_thread(inflate_head, data, HTML_BYTES_MAX)
    except (RawStorageError, KeyError):
        return None
    return head.decode("utf-8", errors="replace"), truncated


def _text(text: str | None, chars: int, low: int, high: int) -> OutlineText:
    return OutlineText(text=text or None, chars=chars, state=length_state(chars, low, high))


def _canonical(row: OutlineRow) -> OutlineCanonical:
    if row.canonical_url_id is None:
        return OutlineCanonical(state="none", href=None)
    if row.canonical_url_id == row.url_id:
        return OutlineCanonical(state="self", href=row.url)
    return OutlineCanonical(state="elsewhere", href=row.canonical_url)


def outline_body(row: OutlineRow, parsed: ParsedOutline, truncated: bool) -> PageOutlineBody:
    title = (row.title or "").strip()
    return PageOutlineBody(
        url=row.url,
        truncated=truncated,
        title=_text(title, len(title), TITLE_MIN, TITLE_MAX),
        description=_text(
            parsed.description, parsed.description_chars, DESCRIPTION_MIN, DESCRIPTION_MAX
        ),
        canonical=_canonical(row),
        robots=OutlineRobots(
            meta=parsed.robots_meta, noindex=row.non_indexable_reason in NOINDEX_REASONS
        ),
        html_lang=parsed.html_lang,
        headings=[OutlineHeading(level=h.level, text=h.text) for h in parsed.headings],
        headings_total=parsed.headings_total,
        level_counts=list(parsed.level_counts),
        skipped_at=parsed.skipped_at,
        languages=OutlineLanguages(
            x_default=parsed.x_default,
            pairs=[
                OutlineLanguagePair(
                    code=pair.code,
                    href=pair.href,
                    is_self=pair.is_self,
                    valid=pair.valid,
                    suggestion=pair.suggestion,
                )
                for pair in parsed.hreflang
            ],
        ),
        social=OutlineSocial(
            og_title=parsed.og_title,
            og_description=parsed.og_description,
            og_image=parsed.og_image,
            og_type=parsed.og_type,
            twitter_card=parsed.twitter_card,
        ),
        structured_data=[
            OutlineStructuredBlock(types=list(block.types), parses=block.parses)
            for block in parsed.jsonld
        ],
        content=OutlineContent(
            words=parsed.words,
            read_minutes=read_minutes(parsed.words),
            thin=parsed.words < THIN_WORDS,
            images=parsed.images,
            images_without_alt=parsed.images_without_alt,
        ),
    )
