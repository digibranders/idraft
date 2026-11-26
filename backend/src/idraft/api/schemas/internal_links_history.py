"""The page history tab's answer (spec 5 of the page history design)."""

from __future__ import annotations

from datetime import datetime
from typing import Final, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.crawl.page_history import ChangeType

VERSIONS_MAX: Final = 100
DeclaredSource = Literal["json_ld", "meta_modified", "og_updated", "sitemap"]


class PageHistoryChange(BaseModel):
    """One line of a version's change list. `level` is for headings. For `links`, `before` is
    `all` or `editorial` (which count moved) and `delta` the signed difference; for `words`
    `delta` is the signed difference in words."""

    type: ChangeType
    level: int | None
    before: str | None
    after: str | None
    delta: int | None


class PageHistoryVersion(BaseModel):
    run_id: UUID
    date: datetime = Field(description="The date of the crawl that saw this version.")
    kind: Literal["content", "site_wide", "first"]
    changes: list[PageHistoryChange]


class PageDeclared(BaseModel):
    date: datetime
    source: DeclaredSource


class PageGoogleCrawl(BaseModel):
    crawled_at: datetime | None
    behind: bool = Field(description="Google's last crawl is older than the last content change.")
    coverage_state: str | None


class PageHistory(BaseModel):
    readable: bool = Field(description="false for a redirect or an error page.")
    why: Literal["redirect", "error"] | None = Field(description="Set when not readable.")
    status: int | None = Field(description="Status of the page in the latest crawl.")
    first_seen: datetime = Field(description="The oldest crawl that held the page.")
    history_starts: datetime | None = Field(description="The oldest crawl with a kept check.")
    last_change: datetime | None
    changes: int = Field(description="Content versions, before the cap on `versions`.")
    declared: PageDeclared | None = Field(
        description="Newest declared date; null when none or the site's dates are unreliable."
    )
    declared_unreliable: bool
    versions: list[PageHistoryVersion] = Field(description="Newest first.")
    versions_capped: bool = Field(description=f"true when more than {VERSIONS_MAX} existed.")
    google: PageGoogleCrawl | None
    tracked: bool


class PageHistoryResponse(BaseModel):
    data: PageHistory
