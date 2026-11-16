"""Bodies and answers of the internal link tracker's routes (plan 02, API contract)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from idraft.api.schemas.common import Body, Patch, printable, refuse_null

TierName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=60),
    AfterValidator(printable),
]
TierDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200), AfterValidator(printable)
]


class TierRef(BaseModel):
    tier_id: UUID
    code: str
    name: str


class PageTier(BaseModel):
    tier_id: UUID
    position: int
    code: str = Field(description="T1 to T8, from the position.")
    name: str
    description: str
    label: str = Field(description='Code and name as filters show it: "T1 Money pages".')
    page_count: int = Field(description="Pages of the workspace's projects on this tier.")
    rule_count: int
    updated_at: datetime


class PageTierList(BaseModel):
    data: list[PageTier]


class PageTierResponse(BaseModel):
    data: PageTier


class PageTierCreate(Body):
    name: TierName
    description: TierDescription = ""


class PageTierPatch(Patch):
    name: TierName | None = None
    description: TierDescription | None = None

    _not_null = field_validator("name", "description")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> PageTierPatch:
        if not self.model_fields_set:
            raise ValueError("give a name or a description")
        return self
