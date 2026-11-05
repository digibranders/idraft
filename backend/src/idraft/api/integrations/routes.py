"""First-party integration routes (docs/19-api-specification.md section 3.10), Search Console.

Starting a connection answers JSON with Google's address, not a 302: the web app calls it with
`fetch` and then navigates, and a redirect to another origin would be refused there. The return
from Google is a 302 to the project's integrations page, whatever happens.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import RedirectResponse

from idraft.api.auth.dependencies import LenientSession
from idraft.api.integrations.repository import ConnectionRecord, IntegrationRecord
from idraft.api.integrations.service import IntegrationService
from idraft.api.pagination import Offset, OffsetPageInfo
from idraft.api.permissions import Permission
from idraft.api.request_info import Info
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.common import UserRef
from idraft.api.schemas.integrations import (
    AuthorizationResponse,
    Connection,
    ConnectionPage,
    ConnectionResponse,
    ConnectionStatus,
    Integration,
    IntegrationCreate,
    IntegrationPage,
    IntegrationResponse,
    IntegrationSync,
    SitePropertyList,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.api.workspaces.dependencies import require_permission
from idraft.domain.gsc_pull import PullState

TAG = "integrations"
project_router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations", tags=[TAG]
)
connection_router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/connections", tags=[TAG])
oauth_router = APIRouter(prefix="/api/v1/oauth", tags=[TAG])

# Connections are the workspace's credentials, shared by all its projects, so a manager limited to
# some projects neither manages them nor links one to a project: every route that changes or lists
# them needs a manager of every project. Reading what a project has linked is `data:read`.
Manage = Annotated[
    WorkspaceAccess,
    Depends(require_permission(Permission.INTEGRATIONS_MANAGE, every_project=True)),
]
ManageFresh = Annotated[
    WorkspaceAccess,
    Depends(require_permission(Permission.INTEGRATIONS_MANAGE, every_project=True, fresh=True)),
]
ReadProject = Annotated[WorkspaceAccess, Depends(require_permission(Permission.DATA_READ))]


def get_integration_service(
    resources: Annotated[Resources, Depends(get_resources)],
) -> IntegrationService:
    return resources.integrations


Integrations = Annotated[IntegrationService, Depends(get_integration_service)]


def _connection(record: ConnectionRecord) -> Connection:
    connected_by = None
    if (
        record.connected_by_id is not None
        and record.connected_by_name is not None
        and record.connected_by_email is not None
    ):
        connected_by = UserRef(
            user_id=record.connected_by_id,
            name=record.connected_by_name,
            email=record.connected_by_email,
        )
    return Connection.model_validate(
        {
            "connection_id": record.id,
            "product": record.product,
            "auth_method": record.auth_method,
            "subject_label": record.subject_label,
            "scopes": record.scopes,
            "status": record.status,
            "connected_by": connected_by,
            "connected_at": record.connected_at,
            "last_refresh_at": record.last_refresh_at,
            "last_error_code": record.last_error_code,
            "integration_count": record.integration_count,
        }
    )


def _sync(record: IntegrationRecord) -> IntegrationSync | None:
    if record.kind != "gsc":
        return None
    state = PullState.read(record.backfill_state)
    window = state.window
    return IntegrationSync(
        phase="synced" if state.complete else "backfilling" if state.recent_done else "pending",
        window_start=None if window is None else window[0],
        window_end=None if window is None else window[1],
        covered_from=state.oldest_day,
        days_stored=state.days_stored,
        rows_stored=state.rows_stored,
        consecutive_failures=state.failures,
        retry_after=state.retry_after,
        next_sync_at=record.next_sync_at,
    )


def _integration(record: IntegrationRecord) -> Integration:
    return Integration.model_validate(
        {
            "integration_id": record.id,
            "project_id": record.project_id,
            "connection_id": record.connection_id,
            "kind": record.kind,
            "external_property": record.external_property,
            "external_account": record.external_account,
            "status": record.status,
            "connection_status": record.connection_status,
            "last_success_at": record.last_success_at,
            "last_error": record.last_error,
            "backfill_state": record.backfill_state,
            "sync": _sync(record),
            "created_at": record.created_at,
        }
    )


@project_router.post(
    "/{kind}/authorize",
    summary="Start connecting a Google account",
    description=(
        "Answers Google's consent address; the web app sends the person there. The address "
        "carries a single-use state and a PKCE challenge, both valid for 10 minutes and bound to "
        "the caller, the workspace and the project. Google returns the person to "
        "`GET /api/v1/oauth/google/callback`. `integration_not_configured` (503) when this "
        "installation has no Google OAuth client."
    ),
)
async def authorize(
    kind: Literal["gsc"], project_id: UUID, access: ManageFresh, integrations: Integrations
) -> AuthorizationResponse:
    return AuthorizationResponse(data=await integrations.authorize(access, project_id))


@project_router.get("", summary="The properties linked to a project")
async def list_project_integrations(
    project_id: UUID, access: ReadProject, page: Offset, integrations: Integrations
) -> IntegrationPage:
    records, total = await integrations.integrations(
        access, project_id, offset=page.offset, limit=page.limit
    )
    return IntegrationPage(
        data=[_integration(record) for record in records],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
    )


@project_router.post(
    "",
    status_code=201,
    summary="Link a Search Console property to the project",
    description=(
        "The connection must be active and its account must be able to read the property "
        "(`property_not_accessible`, 422). A project has one live property and a property "
        "belongs to one project of the workspace (`duplicate`, 409). Nothing is pulled yet."
    ),
)
async def choose_property(
    project_id: UUID,
    body: IntegrationCreate,
    access: Manage,
    integrations: Integrations,
    info: Info,
) -> IntegrationResponse:
    record = await integrations.choose(
        access,
        project_id,
        connection_id=body.connection_id,
        external_property=body.external_property,
        info=info,
    )
    return IntegrationResponse(data=_integration(record))


@project_router.delete(
    "/{integration_id}",
    summary="Stop using a property for the project",
    description="The property is switched off and the numbers already stored are kept.",
)
async def disable_integration(
    project_id: UUID,
    integration_id: UUID,
    access: ManageFresh,
    integrations: Integrations,
    info: Info,
) -> IntegrationResponse:
    record = await integrations.disable(access, project_id, integration_id, info)
    return IntegrationResponse(data=_integration(record))


@connection_router.get("", summary="The workspace's connections")
async def list_connections(
    access: Manage,
    page: Offset,
    integrations: Integrations,
    product: Annotated[
        Literal["gsc", "ga4", "bing_wmt", "cloudflare"] | None, Query(alias="filter[product]")
    ] = None,
    status: Annotated[ConnectionStatus | None, Query(alias="filter[status]")] = None,
) -> ConnectionPage:
    records, total = await integrations.connections(
        access, product=product, status=status, offset=page.offset, limit=page.limit
    )
    return ConnectionPage(
        data=[_connection(record) for record in records],
        page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=total),
    )


@connection_router.get(
    "/{connection_id}/properties",
    summary="The Search Console properties of a connection",
    description=(
        "Asks Google, so it can answer `google_unavailable` or `google_rate_limited` (503). "
        "`suggested_project_id` names the project whose primary domain the property matches, "
        "a Domain property before a URL prefix. `integration_reauth_required` (409) when the "
        "account must connect again."
    ),
)
async def list_properties(
    connection_id: UUID, access: Manage, integrations: Integrations
) -> SitePropertyList:
    return SitePropertyList(data=await integrations.properties(access, connection_id))


@connection_router.delete(
    "/{connection_id}",
    summary="Disconnect a Google account",
    description=(
        "Revokes the token at Google (best effort), deletes the stored credential, marks the "
        "connection revoked and switches off its properties. The numbers already stored are "
        "kept. Disconnecting a revoked connection changes nothing."
    ),
)
async def disconnect(
    connection_id: UUID, access: ManageFresh, integrations: Integrations, info: Info
) -> ConnectionResponse:
    return ConnectionResponse(
        data=_connection(await integrations.disconnect(access, connection_id, info))
    )


@oauth_router.get(
    "/google/callback",
    summary="Where Google returns the person after consent",
    description=(
        "Public, but the single-use `state` must belong to the caller's session. Always a 302 to "
        "the project's integrations page: `.../integrations/gsc?connection_id=...` on success, "
        "`...?error=<code>` otherwise, with `invalid_state`, `scope_denied`, `no_refresh_token`, "
        "`exchange_failed`, `google_unavailable` or `integration_not_configured`. When the "
        "project cannot be known (a wrong or reused state) it goes to the app's front page with "
        "`?integration_error=invalid_state`."
    ),
    response_class=Response,
    responses={
        302: {
            "description": "Redirect to the web app.",
            "headers": {"Location": {"schema": {"type": "string"}}},
        }
    },
)
async def google_callback(
    session: LenientSession,
    integrations: Integrations,
    info: Info,
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=256)] = None,
    error: Annotated[str | None, Query(max_length=256)] = None,
) -> RedirectResponse:
    target = await integrations.complete(
        session=session, code=code, state=state, denied=error is not None, info=info
    )
    return RedirectResponse(target, status_code=302, headers={"Cache-Control": "no-store"})
