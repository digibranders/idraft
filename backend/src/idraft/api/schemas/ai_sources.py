"""What the Citations page, the prompt inspector's Citations tab and its fan-out view read
(docs/19 section 3.7.7, cut to slice 1 data; plan D2): sources by registrable domain and by
page, the citations behind them, and the queries ChatGPT issued while answering."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field

from idraft.api.pagination import CursorPageInfo, OffsetPageInfo
from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.metrics import MetricWindow
from idraft.domain.ai_engines import EngineCode

DomainRole = Literal["own", "competitor", "third_party"]
SourceSort = Literal["-citation_units", "-observations", "-prompts"]
SourceCompare = Literal["none", "previous_period"]

TITLE_MAX = 300
RAW_URL_MAX = 1000
QUERY_MAX = 300


def _bounded(limit: int) -> BeforeValidator:
    """Cut text a provider sent to `limit` characters, ending in `...`. Cutting, not rejecting:
    a response model that refused a long title would turn a stored answer into a 500."""

    def cut(value: object) -> object:
        if isinstance(value, str) and len(value) > limit:
            return value[: limit - 3] + "..."
        return value

    return BeforeValidator(cut)


_TITLE = (
    f"Provider text (untrusted: show it as text, never as markup); cut to {TITLE_MAX} characters "
    "with a trailing `...`."
)


_QUERY = (
    f"Provider text (untrusted: show it as text, never as markup); cut to {QUERY_MAX} "
    "characters with a trailing `...`."
)


def _absent(value: object) -> bool:
    """A block nobody asked for is left out of the answer, not sent as null."""
    return value is None


class PreviousUnits(BaseModel):
    citation_units: int
    observations: int = Field(description="Answers that cited it then.")


_PREVIOUS = (
    "With `compare=previous_period`: its citation units and citing answers over as many days "
    "just before the window, 0 when it was not cited there (docs/16 C5). Left out otherwise."
)

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
    previous: PreviousUnits | None = Field(default=None, exclude_if=_absent, description=_PREVIOUS)


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
    compare_window: MetricWindow | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare`: the window `previous` counts, as many days just before.",
    )
    previous_answers: int | None = Field(
        default=None,
        exclude_if=_absent,
        description="With `compare`: the valid answers in scope in that window. 0 means it has no "
        "data, so a `previous` of 0 there says nothing about the source.",
    )


class SourceDomainPage(BaseModel):
    data: list[SourceDomainRow]
    page: OffsetPageInfo
    meta: SourcesMeta


class SourcePageRow(BaseModel):
    url_id: int
    url: str = Field(description="The canonical URL: the link to follow.")
    host: str
    registrable_domain: str
    title: Annotated[str | None, _bounded(TITLE_MAX)] = Field(
        description="A title an answer gave the page; null if none did. " + _TITLE
    )
    domain_role: DomainRole
    role_entity_id: UUID | None
    citation_units: int = Field(description=_UNITS)
    observations: int = Field(description="Answers that cite it.")
    prompts: int = Field(description="Prompts whose answers cite it.")
    engines: list[EngineUnits]
    source_share: MetricCell
    first_seen_at: datetime
    last_seen_at: datetime
    previous: PreviousUnits | None = Field(default=None, exclude_if=_absent, description=_PREVIOUS)


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
    raw_url: Annotated[str, _bounded(RAW_URL_MAX)] = Field(
        description="As the provider gave it: evidence, not a link (untrusted: never follow or "
        f"render it as one); cut to {RAW_URL_MAX} characters with a trailing `...`."
    )
    host: str
    registrable_domain: str
    title: Annotated[str | None, _bounded(TITLE_MAX)] = Field(
        description="The title the answer gave this citation; null if none. " + _TITLE
    )
    citation_kind: str
    domain_role: DomainRole
    role_entity_id: UUID | None
    occurrences: int


class CitationPage(BaseModel):
    data: list[CitationRow]
    page: CursorPageInfo


class FanoutCitedDomain(BaseModel):
    registrable_domain: str
    domain_role: DomainRole
    role_entity_id: UUID | None
    citation_units: int


class FanoutQueryRow(BaseModel):
    query_text: Annotated[str, _bounded(QUERY_MAX)] = Field(
        description="Its most common spelling in the answers. " + _QUERY
    )
    normalized_text: Annotated[str, _bounded(QUERY_MAX)] = Field(
        description="Lower case, trimmed, inner whitespace as one space: what queries are "
        "grouped by (docs/16 F4). " + _QUERY
    )
    engine_code: EngineCode
    observations: int = Field(
        description="Answers that issued it, each once (docs/16 F4); `meta.answers` is the "
        "denominator."
    )
    prompts: int
    prompt_ids: list[UUID] = Field(description="The prompts whose answers issued it.")
    first_seen_at: datetime
    last_seen_at: datetime
    cited_domains: list[FanoutCitedDomain] = Field(
        description="The 5 registrable domains with the most citation units in the answers that "
        "issued it: an association, not a link (which query found which source is not stored)."
    )


class FanoutMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode]
    min_support: int
    answers: int = Field(
        description="Valid answers in scope on these engines: the denominator of `observations`."
    )
    answers_with_fanout: int = Field(
        description="Of those, the answers that issued a query (docs/16 F1)."
    )
    answers_truncated: int = Field(
        description="Of those, the answers whose stored list is shorter than the queries they "
        "issued (the 16 KB bound on the stored extras keeps the first ones): their other "
        "queries are in no row."
    )
    engines_without_fanout: list[EngineCode] = Field(
        description="Engines that do not show the queries they issue: not exposed, never zero."
    )


class FanoutQueryPage(BaseModel):
    data: list[FanoutQueryRow]
    page: OffsetPageInfo
    meta: FanoutMeta
