"""The AI tab of the page drawer: prompts that cited the page, citations by day, and the pages
cited in the same answers (section 4 of docs/superpowers/specs/2026-11-28-page-ai-tab-design.md).
Every field is required, so the generated client types every field as required."""

from __future__ import annotations

from datetime import datetime
from typing import Final, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.schemas.ai_sources import DomainRole

PROMPT_LIMIT: Final = 25
ALONGSIDE_LIMIT: Final = 10
PageAiState = Literal["ready", "no_prompts", "no_answers"]
PageAiPlatformCode = Literal["chatgpt_web", "gemini_web", "google_ai_mode"]


class PageAiWindow(BaseModel):
    from_: str = Field(alias="from", serialization_alias="from")
    to: str
    timezone: str

    model_config = {"populate_by_name": True}


class PageAiCompared(BaseModel):
    from_: str = Field(alias="from", serialization_alias="from")
    to: str

    model_config = {"populate_by_name": True}


class PageAiPlatform(BaseModel):
    engine_code: PageAiPlatformCode
    label: str
    answers: int
    answers_citing: int
    previous_answers_citing: int | None


class PageAiPromptPlatform(BaseModel):
    engine_code: PageAiPlatformCode
    label: str
    answers: int
    answers_citing: int


class PageAiPrompt(BaseModel):
    prompt_id: UUID
    text: str
    answers: int
    answers_citing: int
    platforms: list[PageAiPromptPlatform]
    last_cited_at: datetime


class PageAiDay(BaseModel):
    date: str
    answers: int
    answers_citing: int


class PageAiAlongside(BaseModel):
    url_id: int
    url: str
    path: str
    title: str | None
    host: str
    registrable_domain: str
    domain_role: DomainRole
    in_crawl: bool
    answers_shared: int


class PageAi(BaseModel):
    state: PageAiState
    window: PageAiWindow
    days: int
    compare_window: PageAiCompared | None
    answers: int
    answers_citing: int
    previous_answers: int | None
    previous_answers_citing: int | None
    platforms: list[PageAiPlatform]
    prompts: list[PageAiPrompt]
    prompts_total: int
    trend: list[PageAiDay]
    alongside: list[PageAiAlongside]
    alongside_total: int


class PageAiResponse(BaseModel):
    data: PageAi
