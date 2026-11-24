"""What the alert routes accept and answer (docs/19 section 3.11.5, version 1: in the app only).

A rule has no `destinations`, and its `channels` and `digest_mode` are fixed to `in_app` and
`immediate` until email and Slack are built. Ids of alerts are 64-bit numbers and travel as
strings, like every other 64-bit id of the API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from idraft.alerts.catalog import Channel, RuleScope, RuleType, Severity
from idraft.api.pagination import CursorPageInfo, OffsetPageInfo

RuleName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
# A 64-bit id as text; the service turns it into a number.
AlertId = Annotated[str, StringConstraints(pattern=r"^[0-9]{1,19}$")]
ACKNOWLEDGE_MAX = 500


class AlertRuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: RuleName
    rule_type: RuleType
    scope: RuleScope = Field(default_factory=RuleScope)
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Checked against the rule type's `params_schema` (`422 invalid_params`).",
    )
    is_active: bool = True


class AlertRuleUpdate(BaseModel):
    """Any of these; the rule type cannot change."""

    model_config = ConfigDict(extra="forbid")

    name: RuleName | None = None
    scope: RuleScope | None = None
    params: dict[str, Any] | None = None
    is_active: bool | None = None


class AlertRule(BaseModel):
    id: UUID
    name: str
    rule_type: RuleType
    scope: RuleScope
    params: dict[str, Any]
    channels: list[Literal["in_app"]]
    digest_mode: Literal["immediate"]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AlertRuleResponse(BaseModel):
    data: AlertRule


class AlertRulePage(BaseModel):
    data: list[AlertRule]
    page: OffsetPageInfo


class AlertRuleType(BaseModel):
    rule_type: RuleType
    channel: Channel
    default_severity: Severity
    params_schema: dict[str, Any]


class AlertRuleTypeList(BaseModel):
    data: list[AlertRuleType]


class AlertEvent(BaseModel):
    id: AlertId
    rule_id: UUID
    subject_type: Literal["prompt", "keyword"]
    subject_id: str
    subject_label: str
    event_kind: RuleType
    severity: Severity
    evidence: dict[str, Any] = Field(
        description="The counts or ranks before and after: `engine_code`, `run_id`, `before`, "
        "`after` and `competitor` for AI alerts; `from_rank`, `to_rank`, `positions_lost` and "
        "`positions` for a rank drop."
    )
    occurred_at: datetime
    acknowledged_by: UUID | None
    acknowledged_at: datetime | None


class AlertEventPage(BaseModel):
    data: list[AlertEvent]
    page: CursorPageInfo


class AcknowledgeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[AlertId] = Field(min_length=1, max_length=ACKNOWLEDGE_MAX)


class Acknowledged(BaseModel):
    acknowledged: int = Field(description="Alerts that were open and are now acknowledged.")


class AcknowledgedResponse(BaseModel):
    data: Acknowledged
