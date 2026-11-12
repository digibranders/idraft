"""What the Citations page, the prompt inspector's Citations tab and its fan-out view read
(docs/19 section 3.7.7, cut to slice 1 data; plan D2): sources by registrable domain and by
page, the citations behind them, and the queries ChatGPT issued while answering."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.pagination import CursorPageInfo, OffsetPageInfo
from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.metrics import MetricWindow
from idraft.domain.ai_engines import EngineCode

DomainRole = Literal["own", "competitor", "third_party"]
SourceSort = Literal["-citation_units", "-observations", "-prompts"]

_UNITS = (
    "Citation units: distinct canonical URLs per answer (docs/16 C2); a URL an answer cites "
    "twice is one, and `occurrences` never counts."
)


class EngineUnits(BaseModel):
    engine_code: EngineCode
    citation_units: int


class SourceDomainRow(BaseModel):
    registrable_domain: str = Field(
        description="What sources are grouped by (docs/14 section 3, docs/16 C1): every host of "
        "one registrable domain, `www.` included."
    )
    domain_role: DomainRole
    role_entity_id: UUID | None = Field(
        description="The tracked entity whose domain rule the citations matched; null for a "
        "third party. A registrable domain whose citations matched different rules has a row "
        "per role and entity."
    )
    citation_units: int = Field(description=_UNITS)
    observations: int = Field(description="Answers that cite it.")
    prompts: int = Field(description="Prompts whose answers cite it.")
    engines: list[EngineUnits] = Field(
        description="Its citation units per engine of `meta.engine_codes`, in that order."
    )
    source_share: MetricCell = Field(
        description="Its citation units over every citation unit in scope (docs/16 C1); "
        "`n_observations` is the valid answers in scope."
    )
    first_seen_at: datetime = Field(description="Its first citation in the window.")
    last_seen_at: datetime = Field(description="Its last citation in the window.")


class RoleUnits(BaseModel):
    domain_role: DomainRole
    citation_units: int
    observations: int = Field(description="Answers that cite a source of this role.")


class SourcesMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode]
    answers: int = Field(description="Valid answers in scope, citing or not.")
    answers_citing: int = Field(description="Of those, the answers that cite a source.")
    citation_units: int = Field(
        description="Every citation unit in scope: the denominator of `source_share`. "
        "`filter[domain_role_in]` narrows the rows, not this."
    )
    by_role: list[RoleUnits] = Field(description="Own, competitor and third party, each once.")


class SourceDomainPage(BaseModel):
    data: list[SourceDomainRow]
    page: OffsetPageInfo
    meta: SourcesMeta


class SourcePageRow(BaseModel):
    url_id: int
    url: str = Field(description="The canonical URL: the link to follow.")
    host: str
    registrable_domain: str
    title: str | None = Field(description="A title an answer gave the page; null if none did.")
    domain_role: DomainRole
    role_entity_id: UUID | None
    citation_units: int = Field(description=_UNITS)
    observations: int = Field(description="Answers that cite it.")
    prompts: int = Field(description="Prompts whose answers cite it.")
    engines: list[EngineUnits]
    source_share: MetricCell
    first_seen_at: datetime
    last_seen_at: datetime


class SourcePagePage(BaseModel):
    data: list[SourcePageRow]
    page: OffsetPageInfo
    meta: SourcesMeta


class CitationRow(BaseModel):
    observation_id: str = Field(description="A 64-bit id, as a string.")
    observed_at: datetime
    prompt_id: UUID
    engine_code: EngineCode
    citation_index: int = Field(description="Its place in the answer's source list, from 1.")
    url_id: int
    url: str = Field(description="The canonical URL: the link to follow.")
    raw_url: str = Field(description="As the provider gave it: evidence, not a link.")
    host: str
    registrable_domain: str
    title: str | None
    citation_kind: str
    domain_role: DomainRole
    role_entity_id: UUID | None
    occurrences: int


class CitationPage(BaseModel):
    data: list[CitationRow]
    page: CursorPageInfo
