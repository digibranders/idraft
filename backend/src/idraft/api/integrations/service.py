"""Connecting Google (Search Console and GA4) to a project (docs/18 sections 3.2 and 4.1, doc 24
section 6).

One Google login is one connection and one consent: the authorization address asks for both
read-only product scopes, and the person may untick one (granular consent), so what a connection
can reach is read from its granted scopes. The flow: `authorize` stores a single-use state and
the PKCE verifier and answers Google's consent address; Google sends the person to the callback,
which consumes the state, trades the code for tokens, stores the refresh token encrypted and
creates or renews the connection; `search_console_properties` and `analytics_properties` list
what the account can read for each product; `choose` links one property of a kind to the project.
Disconnect, re-auth and revocation act on the connection and every property it carries.

No database transaction is held across a call to Google. Plaintext tokens live in local
variables only: never logged, never cached, never in an audit entry or an exception. The API
decrypts a refresh token for the property list and for the revoke at disconnect, which is wider
than doc 24 section 5.2 says (the callback only); the reason is in migration 0015.
"""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from urllib.parse import urlencode
from uuid import UUID

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api import audit
from idraft.api.auth.sessions import SessionContext
from idraft.api.integrations import repository
from idraft.api.integrations.properties import (
    UNVERIFIED,
    ProjectDomain,
    Property,
    overlapping,
    parse_property,
    suggestions,
)
from idraft.api.integrations.repository import (
    ConnectionRecord,
    ConnectionTakenError,
    IntegrationRecord,
    PropertyTakenError,
)
from idraft.api.integrations.state import OAuthStateStore, PendingAuthorization
from idraft.api.permissions import ROLE_PERMISSIONS, Permission, Role
from idraft.api.problems import (
    DuplicateError,
    IntegrationNotConfiguredError,
    IntegrationReauthRequiredError,
    IntegrationScopeMissingError,
    NotFoundError,
    PropertyNotAccessibleError,
    ServiceUnavailableError,
)
from idraft.api.request_info import RequestInfo
from idraft.api.schemas.integrations import (
    AnalyticsProperty,
    IntegrationKind,
    OAuthStart,
    OverlapWarning,
    SiteProperty,
)
from idraft.api.workspaces import repository as workspaces
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.providers.google.client import (
    KIND_SCOPES,
    GoogleClient,
    Site,
    TokenGrant,
    authorization_url,
    new_pkce,
)
from idraft.providers.google.client import (
    AnalyticsProperty as GoogleAnalyticsProperty,
)
from idraft.providers.google.errors import (
    GoogleClientRejectedError,
    GoogleError,
    GoogleInvalidGrantError,
    GooglePermissionError,
    GoogleQuotaError,
    GoogleUnavailableError,
)
from idraft.vault import store as vault
from idraft.vault.envelope import EnvelopeCipher, SecretUnreadableError

PRODUCT = "google"
_PROPERTY_TYPES = {"ordinary", "subproperty", "rollup"}
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class GoogleOAuthConfig:
    """The OAuth client of this installation and the address Google returns people to."""

    client_id: str
    client_secret: str
    redirect_uri: str


class IntegrationService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        states: OAuthStateStore,
        cipher: EnvelopeCipher | None,
        http: httpx.AsyncClient,
        oauth: GoogleOAuthConfig | None,
        app_origin: str,
    ) -> None:
        self._sessions = sessions
        self._states = states
        self._cipher = cipher
        self._http = http
        self._oauth = oauth
        self._origin = app_origin

    # -- shared -------------------------------------------------------------------------------

    def _transaction(
        self, workspace_id: UUID, user_id: UUID | None = None
    ) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, workspace_id, user_id=user_id)

    def _configured(self) -> tuple[GoogleOAuthConfig, EnvelopeCipher]:
        if self._oauth is None or self._cipher is None:
            raise IntegrationNotConfiguredError(
                "Google sign-in is not set up for this installation."
            )
        return self._oauth, self._cipher

    def _google(self) -> GoogleClient:
        oauth, _ = self._configured()
        return GoogleClient(
            self._http, client_id=oauth.client_id, client_secret=oauth.client_secret
        )

    async def _access_token(
        self, access: WorkspaceAccess, connection_id: UUID, kind: IntegrationKind
    ) -> tuple[ConnectionRecord, str]:
        """The connection and a fresh access token, held in memory for this request only. A
        product whose permission was not granted is refused here, before Google is asked."""
        _, cipher = self._configured()
        async with self._transaction(access.workspace_id, access.user_id) as db:
            record = await repository.get_connection(db, access.workspace_id, connection_id)
            if record is None or record.product != PRODUCT:
                raise NotFoundError
            if record.status != "active" or record.credential_ref is None:
                raise IntegrationReauthRequiredError("Connect the Google account again.")
            if KIND_SCOPES[kind] not in record.scopes:
                raise IntegrationScopeMissingError(_scope_missing_detail(kind))
            try:
                refresh_token = await vault.read(
                    db,
                    cipher,
                    workspace_id=access.workspace_id,
                    secret_id=record.credential_ref,
                    kind=vault.REFRESH_TOKEN,
                )
                unreadable = False
            except SecretUnreadableError:
                refresh_token, unreadable = "", True
        if unreadable:
            _log.error("secret_unreadable", connection_id=str(connection_id))
            await self._needs_reauth(access.workspace_id, connection_id, "secret_unreadable")
            raise IntegrationReauthRequiredError("Connect the Google account again.")
        try:
            token = await self._google().refresh(refresh_token)
        except GoogleInvalidGrantError:
            await self._needs_reauth(access.workspace_id, connection_id, "invalid_grant")
            raise IntegrationReauthRequiredError("Connect the Google account again.") from None
        except GoogleClientRejectedError:
            _log.error("google_client_rejected", step="refresh")
            raise IntegrationNotConfiguredError(
                "Google did not accept this installation's OAuth client."
            ) from None
        except GoogleError as error:
            raise _unavailable(error) from None
        async with self._transaction(access.workspace_id) as db:
            await repository.note_refresh(
                db, workspace_id=access.workspace_id, connection_id=connection_id
            )
        return record, token.access_token

    async def _needs_reauth(self, workspace_id: UUID, connection_id: UUID, code: str) -> None:
        async with self._transaction(workspace_id) as db:
            await repository.mark_reauth_required(
                db, workspace_id=workspace_id, connection_id=connection_id, error_code=code
            )

    async def _sites(self, access_token: str) -> list[Site]:
        try:
            return await self._google().list_sites(access_token)
        except GoogleError as error:
            raise _unavailable(error) from None

    async def _analytics_properties(self, access_token: str) -> list[GoogleAnalyticsProperty]:
        try:
            return await self._google().list_analytics_properties(access_token)
        except GoogleError as error:
            raise _unavailable(error) from None

    # -- start --------------------------------------------------------------------------------

    async def authorize(self, access: WorkspaceAccess, project_id: UUID) -> OAuthStart:
        oauth, _ = self._configured()
        async with self._transaction(access.workspace_id, access.user_id) as db:
            context = await repository.project_context(db, access.workspace_id, project_id)
        if context is None:
            raise NotFoundError
        pkce = new_pkce()
        state, expires_at = await self._states.create(
            PendingAuthorization(
                user_id=access.user_id,
                workspace_id=access.workspace_id,
                project_id=project_id,
                product=PRODUCT,
                verifier=pkce.verifier,
            )
        )
        return OAuthStart(
            authorization_url=authorization_url(
                client_id=oauth.client_id,
                redirect_uri=oauth.redirect_uri,
                state=state,
                challenge=pkce.challenge,
            ),
            state_expires_at=expires_at,
        )

    # -- callback -----------------------------------------------------------------------------

    def _failure(self, error: str, *, base: str | None = None) -> str:
        """Where the person lands when the connection did not complete: the project's
        integrations page when it is known, else the app's front page."""
        if base is None:
            return f"{self._origin}/?{urlencode({'integration_error': error})}"
        return f"{base}?{urlencode({'error': error})}"

    async def complete(
        self,
        *,
        session: SessionContext | None,
        code: str | None,
        state: str | None,
        denied: bool,
        info: RequestInfo,
    ) -> str:
        """The callback. Always an address to send the person to: every refusal is a redirect
        carrying a short error code, since the person arrives here from Google's page."""
        pending = None if state is None else await self._states.consume(state)
        if pending is None or session is None or session.user_id != pending.user_id:
            return self._failure("invalid_state")
        base = await self._return_address(pending)
        if base is None:
            return self._failure("invalid_state")
        if self._oauth is None or self._cipher is None:
            return self._failure("integration_not_configured", base=base)
        if denied:
            return self._failure("scope_denied", base=base)
        if code is None:
            return self._failure("exchange_failed", base=base)
        google = self._google()
        try:
            grant = await google.exchange_code(
                code=code, verifier=pending.verifier, redirect_uri=self._oauth.redirect_uri
            )
        except GoogleInvalidGrantError:
            return self._failure("exchange_failed", base=base)
        except GoogleClientRejectedError:
            _log.error("google_client_rejected", step="exchange")
            return self._failure("integration_not_configured", base=base)
        except GoogleError:
            return self._failure("google_unavailable", base=base)
        # Google lets the person untick a permission: one product is enough, none is not.
        if not any(scope in grant.scopes for scope in KIND_SCOPES.values()):
            await _abandon(google, grant)
            return self._failure("scope_denied", base=base)
        if grant.refresh_token is None:
            await _abandon(google, grant)
            return self._failure("no_refresh_token", base=base)
        try:
            identity = await google.identity(grant.access_token)
        except GoogleError:
            await _abandon(google, grant)
            return self._failure("google_unavailable", base=base)
        try:
            connection_id = await self._store_connection(
                pending, grant, grant.refresh_token, identity.sub, identity.email, info
            )
        except ConnectionTakenError:
            await _abandon(google, grant)
            return self._failure("exchange_failed", base=base)
        return f"{base}?{urlencode({'connection_id': str(connection_id)})}"

    async def _return_address(self, pending: PendingAuthorization) -> str | None:
        """The project's integrations page, when the person may still connect for it: the
        session was bound to the user when the flow began, and a role changed since then counts."""
        async with self._transaction(pending.workspace_id, pending.user_id) as db:
            role = await workspaces.active_member_role(db, pending.workspace_id, pending.user_id)
            member = await workspaces.membership(db, pending.workspace_id, pending.user_id)
            context = await repository.project_context(db, pending.workspace_id, pending.project_id)
        if role is None or member is None or context is None:
            return None
        if Permission.INTEGRATIONS_MANAGE not in ROLE_PERMISSIONS[Role(role)]:
            return None
        if member.project_ids is not None and pending.project_id not in member.project_ids:
            return None
        if context.workspace_status != "active":
            return None
        return f"{self._origin}/{context.workspace_slug}/{context.project_slug}/integrations/google"

    async def _store_connection(
        self,
        pending: PendingAuthorization,
        grant: TokenGrant,
        refresh_token: str,
        subject: str,
        email: str | None,
        info: RequestInfo,
    ) -> UUID:
        _, cipher = self._configured()
        async with self._transaction(pending.workspace_id, pending.user_id) as db:
            existing = await repository.connection_by_subject(
                db, pending.workspace_id, PRODUCT, subject
            )
            secret_id = await vault.put(
                db,
                cipher,
                workspace_id=pending.workspace_id,
                kind=vault.REFRESH_TOKEN,
                plaintext=refresh_token,
            )
            if existing is None:
                connection_id = await repository.insert_connection(
                    db,
                    workspace_id=pending.workspace_id,
                    product=PRODUCT,
                    subject_id=subject,
                    subject_label=email,
                    credential_ref=secret_id,
                    scopes=grant.scopes,
                    connected_by=pending.user_id,
                )
                action: audit.AuditAction = "connection.created"
            else:
                connection_id = existing.id
                await repository.renew_connection(
                    db,
                    workspace_id=pending.workspace_id,
                    connection_id=connection_id,
                    subject_label=email,
                    credential_ref=secret_id,
                    scopes=grant.scopes,
                    granted_kinds=[k for k, scope in KIND_SCOPES.items() if scope in grant.scopes],
                    connected_by=pending.user_id,
                )
                if existing.credential_ref is not None:
                    await vault.delete_secret(
                        db, workspace_id=pending.workspace_id, secret_id=existing.credential_ref
                    )
                action = "connection.reconnected"
            await audit.record(
                db,
                workspace_id=pending.workspace_id,
                actor_id=pending.user_id,
                action=action,
                target_type="connection",
                target_id=connection_id,
                info=info,
                before=None if existing is None else {"status": existing.status},
                after={"product": PRODUCT, "status": "active", "subject_label": email},
            )
        return connection_id

    # -- reads --------------------------------------------------------------------------------

    async def connections(
        self,
        access: WorkspaceAccess,
        *,
        product: str | None,
        status: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[ConnectionRecord], int]:
        async with self._transaction(access.workspace_id, access.user_id) as db:
            return await repository.list_connections(
                db, access.workspace_id, product=product, status=status, offset=offset, limit=limit
            )

    async def integrations(
        self, access: WorkspaceAccess, project_id: UUID, *, offset: int, limit: int
    ) -> tuple[list[IntegrationRecord], int]:
        async with self._transaction(access.workspace_id, access.user_id) as db:
            if await repository.project_context(db, access.workspace_id, project_id) is None:
                raise NotFoundError
            return await repository.list_integrations(
                db, access.workspace_id, project_id, offset=offset, limit=limit
            )

    async def search_console_properties(
        self, access: WorkspaceAccess, connection_id: UUID
    ) -> list[SiteProperty]:
        _, access_token = await self._access_token(access, connection_id, "gsc")
        sites = await self._sites(access_token)
        async with self._transaction(access.workspace_id, access.user_id) as db:
            candidates = await repository.projects_with_domains(db, access.workspace_id)
            linked = await repository.linked_properties(db, access.workspace_id, "gsc")
        found = [parse_property(site.site_url, site.permission_level) for site in sites]
        suggested = suggestions(
            [
                ProjectDomain(project_id, host, registrable)
                for project_id, host, registrable in candidates
            ],
            found,
        )
        return [_view(prop, suggested, linked) for prop in sorted(found, key=_listing_order)]

    async def analytics_properties(
        self, access: WorkspaceAccess, connection_id: UUID
    ) -> list[AnalyticsProperty]:
        """The GA4 properties the account can see, by account then name. No domain matching and
        no suggestion: a property's site is a web stream, which takes more calls (docs/18)."""
        _, access_token = await self._access_token(access, connection_id, "ga4")
        found = await self._analytics_properties(access_token)
        async with self._transaction(access.workspace_id, access.user_id) as db:
            linked = await repository.linked_properties(db, access.workspace_id, "ga4")
        return [
            _analytics_view(prop, linked)
            for prop in sorted(
                found, key=lambda p: (p.account_name.casefold(), p.display_name.casefold(), p.name)
            )
        ]

    # -- changes ------------------------------------------------------------------------------

    async def choose(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        connection_id: UUID,
        kind: IntegrationKind,
        external_property: str,
        info: RequestInfo,
    ) -> IntegrationRecord:
        self._configured()
        async with self._transaction(access.workspace_id, access.user_id) as db:
            if await repository.project_context(db, access.workspace_id, project_id) is None:
                raise NotFoundError
        record, access_token = await self._access_token(access, connection_id, kind)
        if kind == "gsc":
            sites = {site.site_url: site for site in await self._sites(access_token)}
            site = sites.get(external_property)
            readable = site is not None and site.permission_level != UNVERIFIED
        else:
            readable = any(
                prop.name == external_property
                for prop in await self._analytics_properties(access_token)
            )
        if not readable:
            raise PropertyNotAccessibleError(
                "This account cannot read that property. Pick one from the list."
            )
        try:
            async with self._transaction(access.workspace_id, access.user_id) as db:
                integration_id = await self._link(
                    db, access, project_id, record, kind, external_property, info
                )
                created = await repository.get_integration(
                    db, access.workspace_id, project_id, integration_id
                )
        except PropertyTakenError:
            raise _property_taken(kind) from None
        if created is None:  # pragma: no cover - the row was written in this transaction
            raise NotFoundError
        return created

    @staticmethod
    async def _link(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        connection: ConnectionRecord,
        kind: IntegrationKind,
        external_property: str,
        info: RequestInfo,
    ) -> UUID:
        live = await repository.live_integration_status(db, access.workspace_id, project_id, kind)
        existing = await repository.property_row(db, access.workspace_id, kind, external_property)
        if live is not None:
            raise _property_taken(kind, own_project=True)
        if existing is None:
            integration_id = await repository.insert_integration(
                db,
                workspace_id=access.workspace_id,
                project_id=project_id,
                kind=kind,
                external_property=external_property,
                external_account=connection.subject_label,
                connection_id=connection.id,
                scopes=connection.scopes,
            )
        else:
            integration_id, owner, status = existing
            if owner != project_id or status != "disabled":
                raise _property_taken(kind)
            await repository.reactivate_integration(
                db,
                workspace_id=access.workspace_id,
                integration_id=integration_id,
                external_account=connection.subject_label,
                connection_id=connection.id,
                scopes=connection.scopes,
            )
        await audit.record(
            db,
            workspace_id=access.workspace_id,
            actor_id=access.user_id,
            action="integration.created",
            target_type="integration",
            target_id=integration_id,
            info=info,
            after={
                "kind": kind,
                "external_property": external_property,
                "project_id": str(project_id),
                "connection_id": str(connection.id),
            },
        )
        return integration_id

    async def disable(
        self, access: WorkspaceAccess, project_id: UUID, integration_id: UUID, info: RequestInfo
    ) -> IntegrationRecord:
        async with self._transaction(access.workspace_id, access.user_id) as db:
            record = await repository.get_integration(
                db, access.workspace_id, project_id, integration_id
            )
            if record is None:
                raise NotFoundError
            if record.status != "disabled":
                await repository.disable_integration(
                    db, workspace_id=access.workspace_id, integration_id=integration_id
                )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="integration.disabled",
                    target_type="integration",
                    target_id=integration_id,
                    info=info,
                    before={"status": record.status, "external_property": record.external_property},
                    after={"status": "disabled", "external_property": record.external_property},
                )
            changed = await repository.get_integration(
                db, access.workspace_id, project_id, integration_id
            )
        if changed is None:  # pragma: no cover - read in the same transaction
            raise NotFoundError
        return changed

    async def disconnect(
        self, access: WorkspaceAccess, connection_id: UUID, info: RequestInfo
    ) -> ConnectionRecord:
        """Revoke at Google (best effort), delete the secret, mark the connection revoked and
        stop its properties. The stored numbers stay (docs/24 section 6, docs/18 section 14)."""
        refresh_token = None
        async with self._transaction(access.workspace_id, access.user_id) as db:
            record = await repository.get_connection(db, access.workspace_id, connection_id)
            if record is None:
                raise NotFoundError
            if record.status == "revoked":
                return record
            if record.credential_ref is not None and self._cipher is not None:
                try:
                    refresh_token = await vault.read(
                        db,
                        self._cipher,
                        workspace_id=access.workspace_id,
                        secret_id=record.credential_ref,
                        kind=vault.REFRESH_TOKEN,
                    )
                except SecretUnreadableError:
                    refresh_token = None
        if refresh_token is not None and self._oauth is not None:
            await self._google().revoke(refresh_token)
        async with self._transaction(access.workspace_id, access.user_id) as db:
            current = await repository.get_connection(
                db, access.workspace_id, connection_id, lock=True
            )
            if current is None:  # pragma: no cover - connections are never deleted
                raise NotFoundError
            if current.status != "revoked":
                await repository.revoke_connection(
                    db, workspace_id=access.workspace_id, connection_id=connection_id
                )
                if current.credential_ref is not None:
                    await vault.delete_secret(
                        db, workspace_id=access.workspace_id, secret_id=current.credential_ref
                    )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="connection.revoked",
                    target_type="connection",
                    target_id=connection_id,
                    info=info,
                    before={"status": current.status, "subject_label": current.subject_label},
                    after={"status": "revoked", "subject_label": current.subject_label},
                )
            revoked = await repository.get_connection(db, access.workspace_id, connection_id)
        if revoked is None:  # pragma: no cover - read in the same transaction
            raise NotFoundError
        return revoked


_PRODUCT_NAMES = {"gsc": "Search Console", "ga4": "GA4"}


def _property_taken(kind: IntegrationKind, *, own_project: bool = False) -> DuplicateError:
    if own_project:
        return DuplicateError(f"The project already has a {_PRODUCT_NAMES[kind]} property.")
    return DuplicateError("This property is already linked to a project.")


def _scope_missing_detail(kind: IntegrationKind) -> str:
    return (
        f"{_PRODUCT_NAMES[kind]} access was not granted. Connect the Google account again "
        "and tick it."
    )


def _unavailable(error: GoogleError) -> ServiceUnavailableError:
    if isinstance(error, GoogleQuotaError):
        return ServiceUnavailableError(
            "Google is limiting requests. Try again in a few minutes.", code="google_rate_limited"
        )
    if isinstance(error, GoogleUnavailableError):
        return ServiceUnavailableError(
            "Google did not answer. Try again.", code="google_unavailable"
        )
    if isinstance(error, GooglePermissionError):
        return ServiceUnavailableError(
            "Google refused the request. The API may not be enabled for this installation.",
            code="google_unavailable",
        )
    return ServiceUnavailableError(
        "Google gave an answer that could not be used. Try again.", code="google_unavailable"
    )


async def _abandon(google: GoogleClient, grant: TokenGrant) -> None:
    """A grant that cannot be used is given back, so nothing of ours is left authorized."""
    await google.revoke(grant.refresh_token or grant.access_token)


def _listing_order(prop: Property) -> tuple[bool, str]:
    return (prop.property_type != "domain", prop.label)


def _analytics_view(prop: GoogleAnalyticsProperty, linked: dict[str, UUID]) -> AnalyticsProperty:
    kind = prop.property_type.removeprefix("PROPERTY_TYPE_").lower()
    return AnalyticsProperty.model_validate(
        {
            "external_property": prop.name,
            "label": prop.display_name or prop.name,
            "account_id": prop.account,
            "account_label": prop.account_name or prop.account,
            "property_type": kind if kind in _PROPERTY_TYPES else "unspecified",
            "linked_project_id": linked.get(prop.name),
        }
    )


def _view(prop: Property, suggested: dict[str, UUID], linked: dict[str, UUID]) -> SiteProperty:
    overlap = overlapping(prop, linked)
    return SiteProperty(
        external_property=prop.external_property,
        label=prop.label,
        property_type=prop.property_type,
        permission_level=prop.permission_level,
        is_selectable=prop.is_selectable,
        suggested_project_id=suggested.get(prop.external_property),
        linked_project_id=linked.get(prop.external_property),
        overlap_warning=None
        if overlap is None
        else OverlapWarning(external_property=overlap[0], project_id=overlap[1]),
    )
