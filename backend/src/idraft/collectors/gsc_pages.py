"""Clicks and impressions per page and day from Search Console (plan 04 decision D10).

The query pull stores every row over all pages (`domain/gsc_pull.ALL_PAGES`), because summing
pages overstates impressions. A page's own numbers are asked for apart, with the dimensions
`[date, page]`, and kept in `fp.gsc_page_daily`: one row per property, day and page. They are
shown as what they are, Google's numbers for the page, never added up into a site total. A row
also keeps position times impressions, and the addresses Google used are kept in
`fp.gsc_page_forms`, so a later read of one page can filter by them.

Only addresses that `core.urls` already knows are kept: a crawl or a tracked keyword made the
URL, and a page nobody crawled has no row in the screens that use these numbers.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.gsc_store import IntegrationFacts
from idraft.db.tables import gsc_page_daily, gsc_page_forms, tracked_pages, urls
from idraft.domain.gsc_pull import WINDOW_DAYS
from idraft.extraction.urls import UrlRejectedError, canonicalize
from idraft.providers.google.client import AnalyticsRow
from idraft.providers.google.errors import GoogleResponseError

PAGE_DAYS = WINDOW_DAYS
_CHUNK = 5_000
_CENTS = Decimal("0.01")


@dataclass(frozen=True, slots=True)
class PageDayRow:
    url_hash: bytes
    clicks: int
    impressions: int
    position_sum: Decimal
    # The addresses exactly as Search Console returned them: what a page filter must name.
    forms: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PageClicks:
    clicks: int
    impressions: int


def page_day_rows(rows: Sequence[AnalyticsRow], day: date) -> tuple[list[PageDayRow], int]:
    """`[date, page]` rows as rows to store, and how many were left out: an address the
    canonicalizer refuses. Spellings that canonicalize to one URL are added together."""
    merged: dict[bytes, PageDayRow] = {}
    skipped = 0
    for row in rows:
        if len(row.keys) != 2:
            raise GoogleResponseError("a page row does not have a date and a page")
        stamp, page = row.keys
        if stamp != day.isoformat():
            raise GoogleResponseError("a row is of another day than the one asked for")
        try:
            url_hash = canonicalize(page).url_hash
        except (UrlRejectedError, ValueError):
            skipped += 1
            continue
        weighted = Decimal(str(row.position)) * row.impressions
        before = merged.get(url_hash)
        if before is None:
            merged[url_hash] = PageDayRow(url_hash, row.clicks, row.impressions, weighted, (page,))
            continue
        merged[url_hash] = PageDayRow(
            url_hash,
            before.clicks + row.clicks,
            before.impressions + row.impressions,
            before.position_sum + weighted,
            before.forms if page in before.forms else (*before.forms, page),
        )
    return list(merged.values()), skipped


async def replace_page_day(
    db: AsyncSession, facts: IntegrationFacts, day: date, rows: Sequence[PageDayRow]
) -> tuple[int, int]:
    """Make `rows` the day's rows. Returns (written, unknown): the rows kept, and the pages whose
    URL `core.urls` does not know. Running it again with the same rows changes nothing."""
    ids: dict[bytes, int] = {}
    for start in range(0, len(rows), _CHUNK):
        chunk = [row.url_hash for row in rows[start : start + _CHUNK]]
        found = await db.execute(
            select(urls.c.url_hash, urls.c.id).where(urls.c.url_hash.in_(chunk))
        )
        ids.update({row.url_hash: row.id for row in found})
    await db.execute(
        delete(gsc_page_daily).where(
            gsc_page_daily.c.workspace_id == facts.workspace_id,
            gsc_page_daily.c.integration_id == facts.integration_id,
            gsc_page_daily.c.metric_date == day,
        )
    )
    kept = [
        {
            "integration_id": facts.integration_id,
            "metric_date": day,
            "url_id": ids[row.url_hash],
            "workspace_id": facts.workspace_id,
            "project_id": facts.project_id,
            "clicks": row.clicks,
            "impressions": row.impressions,
            "position_sum": row.position_sum.quantize(_CENTS),
        }
        for row in rows
        if row.url_hash in ids
    ]
    for start in range(0, len(kept), _CHUNK):
        await db.execute(upsert(gsc_page_daily).values(kept[start : start + _CHUNK]))
    forms = [
        {
            "integration_id": facts.integration_id,
            "url_id": ids[row.url_hash],
            "page": form,
            "workspace_id": facts.workspace_id,
            "last_seen": day,
        }
        for row in rows
        if row.url_hash in ids
        for form in row.forms
    ]
    for start in range(0, len(forms), _CHUNK):
        statement = upsert(gsc_page_forms).values(forms[start : start + _CHUNK])
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=["integration_id", "url_id", "page"],
                set_={
                    "last_seen": func.greatest(
                        gsc_page_forms.c.last_seen, statement.excluded.last_seen
                    )
                },
            )
        )
    return len(kept), len(rows) - len(kept)


async def stored_page_days(
    db: AsyncSession, facts: IntegrationFacts, start: date, end: date
) -> set[date]:
    rows = await db.execute(
        select(gsc_page_daily.c.metric_date)
        .where(
            gsc_page_daily.c.workspace_id == facts.workspace_id,
            gsc_page_daily.c.integration_id == facts.integration_id,
            gsc_page_daily.c.metric_date.between(start, end),
        )
        .distinct()
    )
    return {row.metric_date for row in rows}


async def prune_pages(db: AsyncSession, facts: IntegrationFacts, before: date) -> None:
    """Delete days before `before`, except those of a page the project tracks: those are kept."""
    tracked = select(tracked_pages.c.url_id).where(
        tracked_pages.c.workspace_id == facts.workspace_id,
        tracked_pages.c.project_id == facts.project_id,
    )
    await db.execute(
        delete(gsc_page_daily).where(
            gsc_page_daily.c.workspace_id == facts.workspace_id,
            gsc_page_daily.c.integration_id == facts.integration_id,
            gsc_page_daily.c.metric_date < before,
            gsc_page_daily.c.url_id.not_in(tracked),
        )
    )


async def page_clicks(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    window: tuple[date, date],
    url_ids: Collection[int] | None,
) -> dict[int, PageClicks]:
    """Clicks and impressions per page over `window` (inclusive), for `url_ids` or, when None,
    for every page that has a row. A page with no row in the window is absent, not zero: the
    caller says 0 only when the property is connected and its pull is `ok`."""
    statement = (
        select(
            gsc_page_daily.c.url_id,
            func.sum(gsc_page_daily.c.clicks).label("clicks"),
            func.sum(gsc_page_daily.c.impressions).label("impressions"),
        )
        .where(
            gsc_page_daily.c.workspace_id == workspace_id,
            gsc_page_daily.c.project_id == project_id,
            gsc_page_daily.c.integration_id == integration_id,
            gsc_page_daily.c.metric_date.between(*window),
        )
        .group_by(gsc_page_daily.c.url_id)
    )
    if url_ids is not None:
        statement = statement.where(gsc_page_daily.c.url_id.in_(list(url_ids)))
    return {
        row.url_id: PageClicks(int(row.clicks), int(row.impressions))
        for row in await db.execute(statement)
    }
