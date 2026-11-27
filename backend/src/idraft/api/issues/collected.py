"""What the crawl itself kept for the checks that read a page's HTML or its response time: a crawl
read before migration 0047, or whose pages had no HTML, has neither, and those checks do not run
on it (spec section 15). Two reads of the crawl's pages, one `EXISTS` each."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.page_filter import PageScope
from idraft.db.tables import crawl_pages


@dataclass(frozen=True, slots=True)
class Collected:
    facts: bool
    """At least one page of the crawl had its HTML read."""
    timing: bool
    """At least one page of the crawl has a response time."""


async def read_collected(db: AsyncSession, scope: PageScope) -> Collected:
    where = (
        crawl_pages.c.workspace_id == scope.workspace_id,
        crawl_pages.c.run_id == scope.run_id,
    )
    found = (
        await db.execute(
            select(
                exists().where(*where, crawl_pages.c.facts_read),
                exists().where(*where, crawl_pages.c.response_ms.is_not(None)),
            )
        )
    ).one()
    return Collected(facts=bool(found[0]), timing=bool(found[1]))
