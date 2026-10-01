"""Bodies of the registry routes (docs/19-api-specification.md section 3.2.5): the locations
collection can target and the domain categories of doc 14."""

from __future__ import annotations

from pydantic import BaseModel, Field

from sightline.api.pagination import CursorPageInfo


class Location(BaseModel):
    location_id: int = Field(description="The Google Ads geo target id, as DataForSEO uses it.")
    name: str = Field(description="As DataForSEO gives it: `Austin,Texas,United States`.")
    country_iso: str
    location_type: str = Field(
        description="As DataForSEO gives it: `Country`, `State`, `City`, `DMA Region`, ..."
    )
    parent_id: int | None
    supports: list[str] = Field(description="Surfaces a provider can collect there: `serp`.")


class LocationPage(BaseModel):
    data: list[Location]
    page: CursorPageInfo


class DomainCategory(BaseModel):
    code: str
    label: str
    description: str


class DomainCategoryList(BaseModel):
    data: list[DomainCategory]
