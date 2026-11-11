"""Bodies of the first-party integration routes (docs/19-api-specification.md section 3.10).

What connecting Google needs: the authorization address, connections (one Google login carries
Search Console and GA4), the properties of each product a connection can see, and the properties
linked to a project with the progress of the Search Console pull (`IntegrationSync`). There is
no route to start a sync by hand.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from idraft.api.pagination import OffsetPageInfo
from idraft.api.schemas.common import Body, UserRef

IntegrationKind = Literal["gsc", "ga4"]
ConnectionStatus = Literal["active", "reauth_required", "revoked", "error"]
IntegrationStatus = Literal["active", "reauth_required", "disabled", "error"]
# A Search Console property: `sc-domain:example.com` or a URL prefix such as `https://example.com/`.
PropertyText = Annotated[str, StringConstraints(min_length=1, max_length=2048)]
# A GA4 property: `properties/` and its number.
GA4_PROPERTY = re.compile(r"properties/[0-9]{1,20}")


class OAuthStart(BaseModel):
    authorization_url: str = Field(description="Where to send the person: Google's consent page.")
    state_expires_at: datetime


class AuthorizationResponse(BaseModel):
    data: OAuthStart


class ConnectionAccess(BaseModel):
    """Which products the person let us read when they connected. Google lets them untick a
    permission, so a connection can have one product and not the other."""

    gsc: bool = Field(description="Search Console (`webmasters.readonly`) was granted.")
    ga4: bool = Field(description="Google Analytics (`analytics.readonly`) was granted.")


class Connection(BaseModel):
    connection_id: UUID
    product: Literal["google", "bing_wmt", "cloudflare"]
    auth_method: Literal["oauth", "api_key", "api_token", "service_account"]
    subject_label: str | None = Field(description="The connected account, for display.")
    scopes: list[str]
    access: ConnectionAccess = Field(description="Per product, from the granted scopes.")
    status: ConnectionStatus
    connected_by: UserRef | None
    connected_at: datetime
    last_refresh_at: datetime | None
    last_error_code: str | None
    integration_count: int = Field(description="Properties linked to projects, not disabled.")


class ConnectionResponse(BaseModel):
    data: Connection


class ConnectionPage(BaseModel):
    data: list[Connection]
    page: OffsetPageInfo


class OverlapWarning(BaseModel):
    """Another property of the same site is already linked to a project. The two are never
    added together, so the person must pick one."""

    external_property: str
    project_id: UUID


class SiteProperty(BaseModel):
    external_property: str = Field(description="`sc-domain:example.com` or a URL prefix.")
    label: str
    property_type: Literal["domain", "url_prefix"]
    permission_level: str = Field(
        description="`siteOwner`, `siteFullUser`, `siteRestrictedUser` or `siteUnverifiedUser`."
    )
    is_selectable: bool = Field(
        description="False for an unverified user: Search Console refuses to read its numbers."
    )
    suggested_project_id: UUID | None = Field(
        description="The project whose primary domain this property matches; a Domain property "
        "is suggested before a URL-prefix one."
    )
    linked_project_id: UUID | None = Field(
        description="The project this property is already linked to. It cannot be linked twice."
    )
    overlap_warning: OverlapWarning | None


class SitePropertyList(BaseModel):
    data: list[SiteProperty]


class AnalyticsProperty(BaseModel):
    external_property: str = Field(description="`properties/123456`.")
    label: str = Field(description="The property's name in Google Analytics.")
    account_id: str = Field(description="`accounts/123`.")
    account_label: str = Field(description="The Analytics account's name.")
    property_type: Literal["ordinary", "subproperty", "rollup", "unspecified"]
    linked_project_id: UUID | None = Field(
        description="The project this property is already linked to. It cannot be linked twice."
    )


class AnalyticsPropertyList(BaseModel):
    data: list[AnalyticsProperty]


class IntegrationCreate(Body):
    connection_id: UUID
    kind: IntegrationKind
    external_property: PropertyText

    @model_validator(mode="after")
    def _ga4_property_format(self) -> Self:
        if self.kind == "ga4" and GA4_PROPERTY.fullmatch(self.external_property) is None:
            raise ValueError("a GA4 property is written `properties/` and its number")
        return self


class IntegrationSync(BaseModel):
    """Where the Search Console pull of a property has got to: what the sync strip shows."""

    phase: Literal["pending", "backfilling", "synced"] = Field(
        description="`pending`: the first 28 days are not all stored yet. `backfilling`: they "
        "are, and older days are still coming. `synced`: the history is complete and each day "
        "adds the days that became final."
    )
    window_start: date | None = Field(
        description="The 28 final days the Rankings columns sum, once they are stored."
    )
    window_end: date | None = Field(description="The latest final day the pull has reached.")
    covered_from: date | None = Field(description="The oldest day stored.")
    days_stored: int = Field(description="Days that have rows.")
    rows_stored: int
    consecutive_failures: int = Field(description="Passes in a row that ended in an error.")
    retry_after: datetime | None = Field(
        description="When a failed pass is tried again; the sync waits until then."
    )
    next_sync_at: datetime | None = Field(
        description="The next daily sync, from the property's schedule; null when it has none "
        "or it is paused."
    )


class Integration(BaseModel):
    integration_id: UUID
    project_id: UUID | None
    connection_id: UUID | None
    kind: Literal["gsc", "bing_wmt", "ga4", "cloudflare", "server_logs"]
    external_property: str
    external_account: str | None
    status: IntegrationStatus
    connection_status: ConnectionStatus | None
    last_success_at: datetime | None
    last_error: str | None
    backfill_state: dict[str, Any]
    sync: IntegrationSync | None = Field(
        description="The pull's progress, for a Search Console property; null for other kinds."
    )
    created_at: datetime


class IntegrationResponse(BaseModel):
    data: Integration


class IntegrationPage(BaseModel):
    data: list[Integration]
    page: OffsetPageInfo
