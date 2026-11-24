"""Links between keywords and prompts (docs/19-api-specification.md section 3.8.1, cut to the
links a person makes and removes)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

LinkType = Literal[
    "exact_match", "manual", "generated", "semantic", "cluster", "ai_suggestion", "fanout"
]
LinkStatus = Literal["suggested", "active", "rejected"]


class KeywordPromptLinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keyword_id: UUID
    prompt_id: UUID
    is_primary: bool | None = Field(
        default=None,
        description="Make this the keyword the prompt's volume is read from. Left out, the "
        "link is primary when the prompt has no primary link yet.",
    )


class LinkedKeywordRef(BaseModel):
    keyword_id: UUID
    text: str
    language_code: str


class LinkedPromptRef(BaseModel):
    prompt_id: UUID


class KeywordPromptLink(BaseModel):
    link_id: UUID
    keyword: LinkedKeywordRef
    prompt: LinkedPromptRef
    link_type: LinkType
    confidence: float | None
    is_primary: bool
    status: LinkStatus
    created_at: datetime


class KeywordPromptLinkResponse(BaseModel):
    data: KeywordPromptLink


class KeywordPromptLinkList(BaseModel):
    data: list[KeywordPromptLink]
