"""Shareable client summary links (plan 06, decision D15): what the people who manage them see.
The public read of the summary itself is `internal_links_summary`."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# A link always expires: a day count the owner chose, and "never" is not offered.
type ExpiryDays = Literal[7, 30, 90]
type ShareState = Literal["active", "expired", "revoked"]


class ShareCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expires_in_days: ExpiryDays = Field(
        default=30, description="Days until the link stops working."
    )


class Share(BaseModel):
    """A link as listed. The token is never here: it is shown once, when the link is made."""

    id: UUID
    created_at: datetime
    created_by: UUID
    expires_at: datetime
    revoked_at: datetime | None
    state: ShareState


class CreatedShare(Share):
    token: str = Field(
        description="The secret of the link, shown this once. The public page is "
        "`/api/v1/public/internal-links/summary/{token}` and the web builds its own address."
    )


class ShareList(BaseModel):
    data: list[Share]


class ShareResponse(BaseModel):
    data: Share


class CreatedShareResponse(BaseModel):
    data: CreatedShare
