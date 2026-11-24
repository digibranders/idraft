"""The client summary a shared link shows (plan 06, decisions D15 and P4).

It holds what the web's "Client summary (HTML)" download holds, and nothing else: counts and
tier names, the tier-to-tier link matrix, seven worklist counts and at most 20 lost links as page
paths of the project's own site with their anchor text. No ids, no page rows, no people.
"""

from __future__ import annotations

from datetime import datetime
from typing import Final, Literal

from pydantic import BaseModel, Field

LOST_LINKS_MAX: Final = 20

SummaryWorklistKey = Literal[
    "under_linked_t1",
    "orphans",
    "editorial_orphans",
    "deep_only_through_auto",
    "broken_and_redirected",
    "links_to_non_indexable",
    "weak_outlinks",
]
LostState = Literal["available", "no_comparison", "dropped"]


class SummaryTier(BaseModel):
    code: str | None = Field(description="T1, T2 and so on; null for the pages with no tier.")
    name: str | None
    pages: int
    average_depth: float | None


class SummaryFlowCell(BaseModel):
    from_code: str | None
    to_code: str | None
    links: int


class SummaryWorklist(BaseModel):
    key: SummaryWorklistKey
    count: int
    may_be_incomplete: bool = Field(
        description="Some pages refused the crawler, so this count may be incomplete."
    )


class SummaryLostLink(BaseModel):
    from_path: str
    to_path: str
    anchor: str


class SummaryLost(BaseModel):
    state: LostState = Field(
        description="`no_comparison` for a first crawl, `dropped` when the links of either crawl "
        "are no longer stored."
    )
    total: int | None = Field(
        description="Lost links to the important tiers; null unless available."
    )
    links: list[SummaryLostLink] = Field(max_length=LOST_LINKS_MAX)


class ClientSummary(BaseModel):
    host: str | None = Field(description="The project's website host.")
    crawled_at: datetime | None
    pages: int
    pages_blocked: int | None = Field(
        description="Pages that refused the crawler: unknown, not broken, so the numbers may be "
        "incomplete. null when not counted."
    )
    tiers: list[SummaryTier]
    flow: list[SummaryFlowCell]
    worklists: list[SummaryWorklist]
    lost: SummaryLost
    important_max_position: int | None = Field(
        description="Tiers T1 to this one count as important."
    )
    generated_at: datetime


class ClientSummaryResponse(BaseModel):
    data: ClientSummary
