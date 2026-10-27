"""Bodies of the project routes (docs/19-api-specification.md section 3.3).

The settings arrive with their first reader (Phase 3). `deep_check_weekday` and `status` are
stored and have no effect yet: the schedules they steer arrive with rank collection.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from idraft.api.pagination import OffsetPageInfo
from idraft.api.schemas.common import (
    Body,
    DomainRef,
    LanguageCode,
    LocationRef,
    Name,
    Patch,
    UserRef,
    refuse_null,
)
from idraft.api.schemas.entities import DomainText, OwnEntityInput
from idraft.api.slugs import ProjectSlug
from idraft.api.timezones import Timezone

ProjectStatus = Literal["active", "paused", "archived"]
# 0 is Sunday.
Weekday = Annotated[int, Field(ge=0, le=6, strict=True)]
# Location ids are an `integer` column.
LocationId = Annotated[int, Field(gt=0, le=2_147_483_647, strict=True)]


class Project(BaseModel):
    project_id: UUID
    workspace_id: UUID
    name: str
    slug: str
    primary_domain: DomainRef | None
    default_location_id: int | None
    default_location: LocationRef | None = Field(
        description="The location `default_location_id` names."
    )
    default_language_code: str | None
    timezone: str
    deep_check_weekday: int = Field(description="Day of the weekly top-100 check. 0 is Sunday.")
    status: ProjectStatus
    data_version: int
    entity_config_version: int
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class ProjectResponse(BaseModel):
    data: Project


class ProjectPage(BaseModel):
    data: list[Project]
    page: OffsetPageInfo


ProjectWarning = Literal["timezone_change_applies_forward"]


class ProjectChangeMeta(BaseModel):
    warnings: list[ProjectWarning]


class ProjectChanged(BaseModel):
    data: Project
    meta: ProjectChangeMeta


class ProjectCreate(Body):
    name: Name
    slug: ProjectSlug
    timezone: Timezone | None = Field(
        default=None, description="An IANA time zone name. Defaults to the workspace's."
    )
    deep_check_weekday: Weekday = 1
    default_language_code: LanguageCode | None = None
    primary_domain: DomainText | None = Field(
        default=None, description="A host or URL; its host is stored."
    )
    default_location_id: LocationId | None = Field(
        default=None, description="A `location_id` of `GET /api/v1/locations`."
    )
    own_entity: OwnEntityInput | None = Field(
        default=None, description="Created with role `own`, primary."
    )


class ProjectUpdate(Patch):
    """At least one member. `default_language_code`, `primary_domain` and `default_location_id`
    may be null to remove them; the others cannot be null."""

    name: Name | None = None
    slug: ProjectSlug | None = None
    timezone: Timezone | None = None
    deep_check_weekday: Weekday | None = None
    default_language_code: LanguageCode | None = None
    status: ProjectStatus | None = None
    primary_domain: DomainText | None = None
    default_location_id: LocationId | None = None

    nullable = frozenset({"default_language_code", "primary_domain", "default_location_id"})
    _not_null = field_validator("name", "slug", "timezone", "deep_check_weekday", "status")(
        refuse_null
    )

    @model_validator(mode="after")
    def _says_something(self) -> ProjectUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self
