"""Client reports: the guest link, the scheduled email and the report a guest reads.

The report is cut from the summary and the cited domains on purpose: no prompt text, no answer
text, no costs, no ids of runs, answers or observations. A field added here is a field every
guest link of every project can read, so each one is a decision.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from idraft.api.schemas.ai import MetricCell
from idraft.api.schemas.ai_sources import DomainRole
from idraft.api.schemas.internal_links_share import ExpiryDays, Share
from idraft.providers.email import ADDRESS_MAX, ADDRESS_PATTERN

RECIPIENTS_MAX = 10
SCHEDULES_MAX = 10
type ReportScheduleFrequency = Literal["weekly", "monthly"]
type ReportRole = Literal["own", "competitor"]


class ReportShareCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expires_in_days: ExpiryDays = Field(
        default=30, description="Days until the link stops working."
    )


class CreatedReportShare(Share):
    token: str = Field(
        description="The secret of the link, shown this once. The public read is "
        "`/api/v1/public/reports/{token}` and the web builds its own address."
    )


class ReportShareList(BaseModel):
    data: list[Share]


class ReportShareResponse(BaseModel):
    data: Share


class CreatedReportShareResponse(BaseModel):
    data: CreatedReportShare


def _address(value: str) -> str:
    address = value.strip().lower()
    if len(address) > ADDRESS_MAX or not ADDRESS_PATTERN.fullmatch(address):
        raise ValueError("each recipient must be one email address")
    return address


def _recipients(values: list[str]) -> list[str]:
    # One mailbox once, in the order given.
    return list(dict.fromkeys(values))


Recipients = Annotated[
    list[Annotated[str, AfterValidator(_address)]],
    AfterValidator(_recipients),
    Field(min_length=1, max_length=RECIPIENTS_MAX),
]


class ReportScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: ReportScheduleFrequency
    recipients: Recipients


class ReportScheduleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: ReportScheduleFrequency | None = None
    recipients: Recipients | None = None
    paused: bool | None = None


class ReportSchedule(BaseModel):
    id: UUID
    frequency: ReportScheduleFrequency
    recipients: list[str]
    paused: bool
    next_run_at: datetime = Field(description="The next send, 06:00 UTC, once the schedule runs.")
    last_sent_at: datetime | None
    last_error: str | None = Field(description="Why the last send failed; null after a good one.")
    created_by: UUID
    created_at: datetime


class ReportScheduleList(BaseModel):
    data: list[ReportSchedule]


class ReportScheduleResponse(BaseModel):
    data: ReportSchedule


class ReportWeek(BaseModel):
    week_start: date
    is_pooled: bool
    pool_weeks: int | None = Field(
        description="With `is_pooled`: the weeks the point holds, 1 to 4, its own included."
    )
    mentioned: MetricCell
    cited: MetricCell


class ReportEngine(BaseModel):
    engine_code: str
    mentioned: MetricCell
    cited: MetricCell
    weeks: list[ReportWeek] = Field(description="Oldest first.")


class ReportBrandEngine(BaseModel):
    """The valid answers that name the brand. Share of voice is not sent: the owner's definition
    (the brand's mentions over every tracked brand's) is worked out from these counts by whoever
    shows it."""

    engine_code: str
    mentioned: MetricCell


class ReportBrand(BaseModel):
    """Your brand or a tracked competitor, by name."""

    name: str
    role: ReportRole
    engines: list[ReportBrandEngine]


class ReportDomain(BaseModel):
    registrable_domain: str
    domain_role: DomainRole
    citation_units: int
    source_share: MetricCell


class ClientReport(BaseModel):
    host: str
    window_from: str = Field(description="First project-local day, `YYYY-MM-DD`.")
    window_to: str = Field(description="Last project-local day, `YYYY-MM-DD`.")
    timezone: str
    generated_at: datetime
    prompt_count: int
    engines: list[ReportEngine]
    brands: list[ReportBrand]
    cited_domains: list[ReportDomain] = Field(description="Most citations first, at most 10.")


class ClientReportResponse(BaseModel):
    data: ClientReport
