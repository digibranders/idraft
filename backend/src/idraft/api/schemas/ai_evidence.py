"""The answer compare of the evidence viewer (WP-26 evidence-viewer; contract
docs/ai-visibility/contracts/evidence.md): what one answer gained, lost and kept against the
earlier answer of the same prompt and engine."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.schemas.ai_sources import DomainRole
from idraft.domain.ai_engines import EngineCode


class CompareEntity(BaseModel):
    """A tracked entity the answer names."""

    entity_id: UUID
    name: str
    role: Literal["own", "competitor", "watch"]


class CompareSource(BaseModel):
    """A cited source, by registrable domain."""

    registrable_domain: str
    host: str = Field(description="The host of the first citation of the domain.")
    domain_role: DomainRole
    title: str | None = Field(description="The title of the first citation of the domain.")


class CompareSide(BaseModel):
    """One of the two answers compared."""

    # A 64-bit id, as a string: JavaScript numbers lose precision past 2^53.
    observation_id: str
    observed_at: datetime
    own_mentioned: bool
    own_domain_cited: bool


class CompareEntities(BaseModel):
    gained: list[CompareEntity] = Field(description="Named now, not in the baseline.")
    lost: list[CompareEntity] = Field(description="Named in the baseline, not now.")
    kept: list[CompareEntity] = Field(description="Named in both.")


class CompareSources(BaseModel):
    gained: list[CompareSource] = Field(description="Cited now, not in the baseline.")
    lost: list[CompareSource] = Field(description="Cited in the baseline, not now.")
    kept_count: int = Field(description="Registrable domains cited in both.")


class AnswerCompare(BaseModel):
    prompt_id: UUID
    engine_code: EngineCode
    latest: CompareSide = Field(description="The answer of the path.")
    baseline: CompareSide = Field(
        description="The newest earlier valid answer of the same prompt and engine that "
        "mentioned the own brand."
    )
    entities: CompareEntities
    sources: CompareSources


class AnswerCompareResponse(BaseModel):
    data: AnswerCompare
