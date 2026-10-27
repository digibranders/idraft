"""Bodies of the workspace, member and invitation routes (docs/19 section 3.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from idraft.api.pagination import OffsetPageInfo
from idraft.api.permissions import Role
from idraft.api.schemas.common import (
    PROJECT_SCOPE_MAX,
    Body,
    Email,
    ImageUrl,
    Name,
    Patch,
    ProjectScope,
    Token,
    UserRef,
    refuse_null,
)
from idraft.api.slugs import WorkspaceSlug
from idraft.api.timezones import Timezone

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


class WorkspaceUpdate(Patch):
    """At least one field. `logo: null` removes the logo; the others cannot be null."""

    name: Name | None = None
    slug: WorkspaceSlug | None = None
    logo: ImageUrl | None = None
    timezone: Timezone | None = None

    nullable = frozenset({"logo"})
    _not_null = field_validator("name", "slug", "timezone")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> WorkspaceUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one of name, slug, logo, timezone")
        return self


class Member(BaseModel):
    user: UserRef
    role: Role
    project_ids: list[UUID] | None = Field(
        description="null means every project, an empty list none"
    )
    two_factor_enabled: bool | None = Field(
        description="null unless the caller manages members: it says who is worth phishing."
    )
    joined_at: datetime
    last_active_at: datetime | None = Field(
        description=(
            "When a signed-in session of theirs was last used, in any workspace. "
            "null when they are signed out everywhere, and unless the caller manages members."
        )
    )


class MemberResponse(BaseModel):
    data: Member


class MemberPage(BaseModel):
    data: list[Member]
    page: OffsetPageInfo


class MemberUpdate(Patch):
    """At least one field. `project_ids: null` gives every project, an empty list none."""

    role: Role | None = None
    project_ids: ProjectScope = Field(default=None, max_length=PROJECT_SCOPE_MAX)

    nullable = frozenset({"project_ids"})
    _not_null = field_validator("role")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> MemberUpdate:
        if not self.model_fields_set:
            raise ValueError("give role, project_ids or both")
        return self


InvitationStatus = Literal["pending", "accepted", "declined", "cancelled", "expired"]


class Invitation(BaseModel):
    invitation_id: UUID
    email: str
    role: Role
    project_ids: list[UUID] | None = Field(description="null means every project")
    status: InvitationStatus
    invited_by: UserRef
    expires_at: datetime
    created_at: datetime


class InvitationResponse(BaseModel):
    data: Invitation


class InvitationPage(BaseModel):
    data: list[Invitation]
    page: OffsetPageInfo


class InvitationCreate(Body):
    email: Email
    role: Role
    project_ids: ProjectScope = Field(default=None, max_length=PROJECT_SCOPE_MAX)


class InvitationAccept(Body):
    token: Token = Field(description="From the invitation link.")


class JoinedWorkspace(BaseModel):
    workspace_id: UUID
    name: str
    slug: str


class AcceptedInvitation(BaseModel):
    workspace: JoinedWorkspace = Field(description="Where the invitation led, to send the user.")
    member: Member


class AcceptedInvitationResponse(BaseModel):
    data: AcceptedInvitation
