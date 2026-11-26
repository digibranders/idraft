"""Response models of the first-party routes (docs/19-api-specification.md section 3.10; contract
note docs/ai-visibility/contracts/fp-ai-referrals.md)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from idraft.api.schemas.metrics import MetricWindow

ReferralClassifier = Literal["both", "ga4_ai_assistant_channel", "own_rules"]
ReferralGroupBy = Literal["assistant", "origin", "landing_page"]


class AiReferralCounts(BaseModel):
    """The three numbers of one classifier and key over one window."""

    sessions: int
    engaged_sessions: int
    key_events: str | None = Field(
        description="The sum of GA4 key events as a decimal string with two decimals; null when "
        "GA4 gave none."
    )


class AiReferralValue(AiReferralCounts):
    previous: AiReferralCounts | None = Field(
        description="The same numbers over the compared window. Null when nothing is compared, "
        "when the compared window is not fully collected, or when the key has no row in it."
    )


class AiReferralRow(BaseModel):
    key: str = Field(description="The assistant code, or the origin with `group_by=origin`.")
    ga4_ai_assistant_channel: AiReferralValue | None = Field(
        description="Sessions GA4's own `AI Assistant` channel group counts. Null when the "
        "classifier was not asked for or has no row for the key in the window."
    )
    own_rules: AiReferralValue | None = Field(
        description="Sessions our referrer rules count. Null when the classifier was not asked "
        "for or has no row for the key in the window."
    )
    difference: int | None = Field(
        description="`own_rules` sessions minus `ga4_ai_assistant_channel` sessions; null when "
        "either is null."
    )


class AiReferralsMeta(BaseModel):
    connected: bool = Field(
        description="The project has a ga4 integration whose status is not `disabled`."
    )
    collected_through: date | None = Field(
        description="The last day a finished sync run stored; null when the sync never finished "
        "or nothing is connected."
    )
    last_success_at: datetime | None
    window: MetricWindow
    compare_window: MetricWindow | None
    rules_version: int | None = Field(
        description="The rule set version of the `own_rules` rows in the window; null when there "
        "are none."
    )
    lower_bound: bool = Field(description="Always true: the figures are a lower bound.")
    notes: list[str] = Field(
        description="Fixed English sentences the web shows (lower bound, Google AI Mode and AI "
        "Overview not counted, the two classifiers, and what is not collected).",
        max_length=8,
    )


class AiReferralsResponse(BaseModel):
    data: list[AiReferralRow] = Field(
        description="One row per assistant (or origin) with a row in the window. An absent key "
        "is no row, and is read as zero only when `meta.collected_through` is at or after `to`."
    )
    meta: AiReferralsMeta
