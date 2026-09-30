"""Bodies of the project routes (docs/19-api-specification.md section 3.3).

`primary_domain`, `default_location_id`, the settings and the own entity are taken by later
phases, when the tables they point at exist. Until then the first two are always null in a
response and none of them is accepted in a request. `deep_check_weekday` and `status` are
stored and have no effect yet: the schedules they steer arrive with rank collection.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from sightline.api.pagination import OffsetPageInfo
from sightline.api.schemas.common import Body, Name, Patch, UserRef, refuse_null
from sightline.api.slugs import ProjectSlug
from sightline.api.timezones import Timezone

ProjectStatus = Literal["active", "paused", "archived"]
# ISO 639-1.
LanguageCode = Annotated[str, StringConstraints(pattern=r"^[a-z]{2}$")]
# 0 is Sunday.
Weekday = Annotated[int, Field(ge=0, le=6, strict=True)]


class DomainRef(BaseModel):
    domain_id: int
    host: str
    registrable_domain: str
    category: str | None
    category_source: Literal["seed_list", "rule", "llm", "manual", "tenant_override"] | None


class Project(BaseModel):
    project_id: UUID
    workspace_id: UUID
    name: str
    slug: str
    primary_domain: DomainRef | None
    default_location_id: int | None
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


class ProjectUpdate(Patch):
    """At least one member. `default_language_code: null` removes it; the others cannot be null."""

    name: Name | None = None
    slug: ProjectSlug | None = None
    timezone: Timezone | None = None
    deep_check_weekday: Weekday | None = None
    default_language_code: LanguageCode | None = None
    status: ProjectStatus | None = None

    nullable = frozenset({"default_language_code"})
    _not_null = field_validator("name", "slug", "timezone", "deep_check_weekday", "status")(
        refuse_null
    )

    @model_validator(mode="after")
    def _says_something(self) -> ProjectUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self
