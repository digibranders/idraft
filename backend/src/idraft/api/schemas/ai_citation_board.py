"""Reads of the Citations page (WP-76; the design preview's #/citations): the six measures, the
cited pages with the prompts behind them, the gap analysis against up to five competitors, and
their drawers, over each prompt and engine's last 1, 2 or 4 runs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.pagination import OffsetPageInfo
from idraft.api.schemas.ai_sources import DomainRole, EngineUnits
from idraft.domain.ai_engines import EngineCode

BrandState = Literal["cited", "mentioned", "not", "none"]
CitedPageSort = Literal[
    "-citations",
    "citations",
    "-change",
    "change",
    "-prompts",
    "prompts",
    "-last_cited",
    "last_cited",
    "page",
    "-page",
]


class RunSlot(BaseModel):
    """One run position over every prompt and engine: slot 1 is each pair's latest run."""

    slot: int = Field(ge=1, description="1 is each prompt and engine's latest run with an answer.")
    first_at: datetime = Field(description="The earliest answer in this slot.")
    last_at: datetime = Field(description="The latest answer in this slot.")
    answers: int


class RunWindow(BaseModel):
    runs: int = Field(description="1, 2 or 4: the slots of the current window.")
    timezone: str
    current: list[RunSlot] = Field(description="Slots 1 to `runs` that hold answers.")
    previous: list[RunSlot] = Field(description="Slots `runs + 1` to `2 * runs` that hold answers.")
    trend: list[RunSlot] = Field(description="Slots 1 to 8 that hold answers, oldest first.")
    answers: int = Field(description="Answers in the current window.")
    prompts: int = Field(description="Prompts with an answer in the current window.")
    latest_answer_at: datetime | None
    latest_run_number: int | None = Field(
        description="How many AI prompt runs the project has had up to the latest answer's run."
    )


class EngineCitationCounts(BaseModel):
    engine_code: EngineCode
    answers: int
    answers_citing: int = Field(description="Answers with at least one own citation unit.")
    prompts: int
    prompts_citing: int
    previous_answers: int
    previous_answers_citing: int
    previous_prompts: int
    previous_prompts_citing: int


class CitationOverview(BaseModel):
    window: RunWindow
    engines: list[EngineCitationCounts]
    citations: int = Field(description="Own citation units in the current window.")
    previous_citations: int
    matched_citations: int = Field(
        description="Own units now, on the prompt and engine pairs answered in both windows."
    )
    matched_previous_citations: int
    matched_pairs: int
    own_urls: int
    previous_own_urls: int
    domains: int
    previous_domains: int


class PromptCount(BaseModel):
    prompt_id: UUID
    text: str
    citations: int


class CitedPageRow(BaseModel):
    url_id: int
    url: str
    host: str
    registrable_domain: str
    path: str
    title: str | None
    domain_role: DomainRole
    entity_id: UUID | None
    entity_name: str | None
    color_index: int | None
    citations: int
    previous_citations: int
    prompts: int
    top_prompts: list[PromptCount] = Field(max_length=10, description="Most citations first.")
    engines: list[EngineUnits]
    trend: list[int] = Field(description="Units per slot of `window.trend`, oldest first.")
    last_cited_at: datetime


class OwnerCounts(BaseModel):
    own: int
    competitor: int
    third_party: int
    all: int


class CitedPagesMeta(BaseModel):
    window: RunWindow
    owners: OwnerCounts = Field(description="Pages per role, whatever the role filter and `q`.")
    citations: int = Field(description="Units of the rows the filter and `q` keep, every page.")


class CitedPagePage(BaseModel):
    data: list[CitedPageRow]
    page: OffsetPageInfo
    meta: CitedPagesMeta


class EngineAnswers(BaseModel):
    engine_code: EngineCode
    cited: int
    answers: int


class CitedPagePrompt(BaseModel):
    prompt_id: UUID
    text: str
    cited: int
    answers: int
    engines: list[EngineAnswers]
    last_cited_at: datetime


class CitedAlongside(BaseModel):
    registrable_domain: str
    domain_role: DomainRole
    entity_id: UUID | None
    entity_name: str | None
    color_index: int | None
    answers: int = Field(description="Answers citing this page that also cite this domain.")


class CitedPageDetail(BaseModel):
    page: CitedPageRow
    prompts: list[CitedPagePrompt]
    alongside: list[CitedAlongside] = Field(max_length=8)
    window: RunWindow


class BrandCell(BaseModel):
    cited: int
    mentioned: int
    answers: int
    state: BrandState


class EngineBrandCell(BrandCell):
    engine_code: EngineCode


class BrandOnPrompt(BaseModel):
    total: BrandCell
    engines: list[EngineBrandCell]
    cited_on: int = Field(description="Engines with answers where the brand is cited.")
    platforms: int = Field(description="Engines with answers.")


class CompetitorOnPrompt(BrandOnPrompt):
    entity_id: UUID


class PromptTopic(BaseModel):
    term_id: UUID
    name: str


class CitationGapRow(BaseModel):
    prompt_id: UUID
    text: str
    topic: PromptTopic | None = Field(description="The prompt's first term in path order.")
    you: BrandOnPrompt
    competitors: list[CompetitorOnPrompt]
    lost_on: list[EngineCode]
    lost_to: list[UUID]
    gap: int = Field(description="How many engines the prompt is lost on.")
    competitor_answers: int


class GapCompetitor(BaseModel):
    entity_id: UUID
    name: str
    color_index: int | None
    domain: str | None


class CitationGapsMeta(BaseModel):
    window: RunWindow
    competitors: list[GapCompetitor]
    prompts: int
    gaps: int


class CitationGapList(BaseModel):
    data: list[CitationGapRow]
    meta: CitationGapsMeta


class GapPage(BaseModel):
    url_id: int
    url: str
    entity_id: UUID | None
    citations: int
    engines: list[EngineCode]


class CitationGapDetail(BaseModel):
    row: CitationGapRow
    answers: int
    competitor_pages: list[GapPage]
    own_pages: list[GapPage]
    closest_pages: list[GapPage] = Field(max_length=3)
    third_party_pages: list[GapPage] = Field(max_length=5)
    window: RunWindow
