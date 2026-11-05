"""Bodies of the quota routes (docs/19 section 3.2.5)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TrackedKeywordQuota(BaseModel):
    limit: int = Field(description="The most active tracked keywords the workspace may hold.")
    used: int = Field(
        description="Active tracked keywords of every project of the workspace that is not deleted."
    )


class TrackedKeywordQuotaResponse(BaseModel):
    data: TrackedKeywordQuota
