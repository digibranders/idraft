"""Bodies of the workspace routes (docs/19-api-specification.md section 3.2.1)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from sightline.api.schemas.common import Body, ImageUrl, Name, Timezone
from sightline.api.slugs import WorkspaceSlug

WorkspaceStatus = Literal["active", "suspended", "deleting"]


class Workspace(BaseModel):
    workspace_id: UUID
    name: str
    slug: str
    logo: str | None
    plan_code: str
    timezone: str
    status: WorkspaceStatus
    created_at: datetime
    purge_after: datetime | None


class WorkspaceResponse(BaseModel):
    data: Workspace


class WorkspaceList(BaseModel):
    data: list[Workspace]


class WorkspaceCreate(Body):
    name: Name
    slug: WorkspaceSlug
    timezone: Timezone = Field(default="UTC", description="An IANA time zone name.")


class WorkspaceUpdate(Body):
    """At least one member. `logo: null` removes the logo; the others cannot be null."""

    name: Name | None = None
    slug: WorkspaceSlug | None = None
    logo: ImageUrl | None = None
    timezone: Timezone | None = None

    @model_validator(mode="after")
    def _says_something(self) -> WorkspaceUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one of name, slug, logo, timezone")
        for field in ("name", "slug", "timezone"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self
