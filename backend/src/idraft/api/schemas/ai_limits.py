"""Request and response models of the quota and limits read (WP-13 prompts-lane; contract C1)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from idraft.api.schemas.operations import ManualRuns


class QuotaUse(BaseModel):
    limit: int
    used: int


class AiLimits(BaseModel):
    """What the page header and the confirm dialogs show before a click (CF-11, prompt-dialogs
    N06): the same numbers the writes check."""

    prompts: QuotaUse = Field(
        description="Active prompts of the whole workspace against `max_active_prompts`."
    )
    ai_observations_month: QuotaUse = Field(
        description="AI answers of the whole workspace this UTC month, planned runs included, "
        "against `max_ai_observations_per_month`, counted as Run now counts them."
    )
    manual_runs_today: ManualRuns


class AiLimitsResponse(BaseModel):
    data: AiLimits
