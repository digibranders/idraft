"""The date a page says it was last modified (spec 4.1 of the page history design).

Order of trust: JSON-LD `dateModified`, `article:modified_time`, `og:updated_time`, then the
sitemap's value. Pure: no I/O. Pages are untrusted, so `declared_of` never raises: every
parser call keeps what it read, every text has a cap, and a value that is not a plausible date
is skipped so the next source gets its turn.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from typing import Final, Literal

DeclaredSource = Literal["json_ld", "meta_modified", "og_updated", "sitemap"]

HTML_CHARS_MAX: Final = 2_000_000
JSONLD_BLOCKS_MAX: Final = 20
JSONLD_BLOCK_CHARS_MAX: Final = 200_000
JSONLD_DEPTH_MAX: Final = 8
DATE_CHARS_MAX: Final = 64
EARLIEST: Final = datetime(1995, 1, 1, tzinfo=UTC)
FUTURE_SLACK: Final = timedelta(days=1)  # a clock a day fast is not a future date

_CHUNK: Final = 65_536


@dataclass(frozen=True, slots=True)
class Declared:
    at: datetime  # timezone-aware, UTC
    source: DeclaredSource


def _plausible(value: datetime, now: datetime) -> datetime | None:
    """`value` in UTC (no zone is read as UTC), or None when it is before 1995 or too far ahead."""
    try:
        aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    except OverflowError:  # a zone offset pushes it past year 1 or 9999
        return None
    return aware if EARLIEST <= aware <= now + FUTURE_SLACK else None


def _parse(raw: object, now: datetime) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        return _plausible(datetime.fromisoformat(raw.strip()[:DATE_CHARS_MAX]), now)
    except (ValueError, OverflowError):
        return None


def _modified_dates(node: object, depth: int = 0) -> Iterator[object]:
    """Every `dateModified` in a JSON-LD document: top level, arrays and `@graph`."""
    if depth > JSONLD_DEPTH_MAX:
        return
    if isinstance(node, list):
        for item in node:
            yield from _modified_dates(item, depth + 1)
    elif isinstance(node, dict):
        if "dateModified" in node:
            yield node["dateModified"]
        if "@graph" in node:
            yield from _modified_dates(node["@graph"], depth + 1)


class _Head(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self.metas: dict[str, str] = {}
        self._ld: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        found = dict(attrs)
        kind = (found.get("type") or "").split(";")[0].strip().lower()  # drop `; charset=...`
        if tag == "script" and kind == "application/ld+json":
            self._ld = ""
        elif tag == "meta":
            key = (found.get("property") or found.get("name") or "").strip().lower()
            if key and key not in self.metas:
                self.metas[key] = found.get("content") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.finish_block()

    def handle_data(self, data: str) -> None:
        if self._ld is not None and len(self._ld) <= JSONLD_BLOCK_CHARS_MAX:
            self._ld += data[: JSONLD_BLOCK_CHARS_MAX + 1 - len(self._ld)]

    def finish_block(self) -> None:
        # an over-long block is not parsed
        if (
            self._ld is not None
            and len(self.blocks) < JSONLD_BLOCKS_MAX
            and len(self._ld) <= JSONLD_BLOCK_CHARS_MAX
        ):
            self.blocks.append(self._ld)
        self._ld = None


def _read_head(html: str) -> _Head:
    head = _Head()
    html = html[:HTML_CHARS_MAX]
    try:
        for start in range(0, len(html), _CHUNK):
            head.feed(html[start : start + _CHUNK])
        head.close()
    except Exception:  # garbage in: keep what was read before the parser gave up
        pass
    head.finish_block()
    return head


def declared_of(html: str, sitemap_lastmod: datetime | None) -> Declared | None:
    """The page's own last-modified claim, or None. Several JSON-LD values: the latest wins."""
    now = datetime.now(UTC)
    head = _read_head(html)
    found: list[datetime] = []
    for block in head.blocks:
        try:
            document = json.loads(block)
        except Exception:  # not JSON, or nested past the recursion limit
            continue
        found.extend(d for raw in _modified_dates(document) if (d := _parse(raw, now)))
    if found:
        return Declared(max(found), "json_ld")
    if (at := _parse(head.metas.get("article:modified_time"), now)) is not None:
        return Declared(at, "meta_modified")
    if (at := _parse(head.metas.get("og:updated_time"), now)) is not None:
        return Declared(at, "og_updated")
    if sitemap_lastmod is not None and (at := _plausible(sitemap_lastmod, now)) is not None:
        return Declared(at, "sitemap")
    return None
