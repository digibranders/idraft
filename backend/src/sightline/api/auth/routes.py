"""Auth and current-user routes (docs/19-api-specification.md section 3.1).

Thin on purpose: parse the body, call the service, set or clear the cookie.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response

from sightline.api.auth.dependencies import (
    CurrentSession,
    FreshSession,
    OptionalSession,
    PendingOrActiveSession,
    clear_session_cookie,
    set_session_cookie,
)
from sightline.api.auth.service import AuthService, Profile, RequestInfo, request_info
from sightline.api.auth.sessions import SessionContext
from sightline.api.permissions import Role, permissions_for
from sightline.api.resources import Resources, get_resources
from sightline.api.schemas.auth import (
    Accepted,
    Done,
    EmailRequest,
    Me,
    MeMembership,
    MeResponse,
    MeSession,
    MeUser,
    MeWorkspace,
    PasswordChangeRequest,
    PasswordResetConfirmRequest,
    ProfileUpdate,
    ReauthenticateRequest,
    ReauthenticateResponse,
    RecoveryCodesResponse,
    RegisterRequest,
    RegisterResponse,
    SessionItem,
    SessionList,
    SignInRequest,
    SignInResponse,
    TotpConfirmRequest,
    TotpSetupResponse,
    TotpVerifyRequest,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/api/v1", tags=["auth"])


def get_auth_service(resources: Annotated[Resources, Depends(get_resources)]) -> AuthService:
    return resources.auth


def get_request_info(request: Request) -> RequestInfo:
    return request_info(
        client_host=None if request.client is None else request.client.host,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", None),
    )


Auth = Annotated[AuthService, Depends(get_auth_service)]
Info = Annotated[RequestInfo, Depends(get_request_info)]


def _cookie_lifetime(session: SessionContext) -> int:
    """Seconds the browser keeps the cookie: until the session can no longer be used."""
    end = (
        session.idle_expires_at if session.state == "pending_totp" else session.absolute_expires_at
    )
    return max(int((end - datetime.now(UTC)).total_seconds()), 0)


@router.post(
    "/auth/register",
    status_code=201,
    summary="Create an account",
    description="While registration is by invitation, `invitation_token` is required.",
)
async def register(
    body: RegisterRequest, background: BackgroundTasks, auth: Auth, info: Info
) -> RegisterResponse:
    registered = await auth.register(
        name=body.name,
        email=body.email,
        password=body.password,
        invitation_token=body.invitation_token,
        info=info,
    )
    if registered.email is not None:
        background.add_task(auth.deliver, registered.email)
    return RegisterResponse(user_id=registered.user_id, email_verified=registered.email_verified)


@router.post(
    "/auth/verify-email/request",
    status_code=202,
    summary="Send a new verification email",
    description="Answers 202 whether or not the address has an account.",
)
async def request_email_verification(
    body: EmailRequest, background: BackgroundTasks, auth: Auth, info: Info
) -> Accepted:
    await auth.limit_email_requests(info)
    background.add_task(auth.request_email_verification, email=body.email, info=info)
    return Accepted()


@router.post("/auth/verify-email", summary="Confirm an email address with the emailed token")
async def verify_email(body: VerifyEmailRequest, auth: Auth, info: Info) -> Done:
    await auth.verify_email(token=body.token, info=info)
    return Done()


@router.post(
    "/auth/sign-in",
    summary="Sign in with email and password",
    description=(
        "Sets the session cookie. `totp_required` means the session can only call "
        "`/auth/totp/verify` until a code is accepted."
    ),
)
async def sign_in(
    body: SignInRequest, response: Response, auth: Auth, info: Info
) -> SignInResponse:
    signed_in = await auth.sign_in(email=body.email, password=body.password, info=info)
    set_session_cookie(response, signed_in.token, max_age=_cookie_lifetime(signed_in.session))
    return SignInResponse(status=signed_in.status)


@router.post(
    "/auth/sign-out",
    status_code=204,
    summary="End the session",
    description="Always clears the cookie, whether or not it named a live session.",
)
async def sign_out(session: OptionalSession, auth: Auth, info: Info) -> Response:
    if session is not None:
        await auth.sign_out(session=session, info=info)
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.post(
    "/auth/password-reset/request",
    status_code=202,
    summary="Send a password reset email",
    description="Answers 202 whether or not the address has an account.",
)
async def request_password_reset(
    body: EmailRequest, background: BackgroundTasks, auth: Auth, info: Info
) -> Accepted:
    await auth.limit_email_requests(info)
    background.add_task(auth.request_password_reset, email=body.email, info=info)
    return Accepted()


@router.post(
    "/auth/password-reset/confirm",
    summary="Set a new password with the emailed token",
    description="Ends every session of the user. It does not sign anyone in.",
)
async def confirm_password_reset(
    body: PasswordResetConfirmRequest, background: BackgroundTasks, auth: Auth, info: Info
) -> Done:
    notice = await auth.confirm_password_reset(
        token=body.token, new_password=body.new_password, info=info
    )
    background.add_task(auth.deliver, notice)
    return Done()


@router.post(
    "/auth/password/change",
    summary="Change the password",
    description="Needs a fresh session. Ends the user's other sessions.",
)
async def change_password(
    body: PasswordChangeRequest,
    session: FreshSession,
    background: BackgroundTasks,
    auth: Auth,
    info: Info,
) -> Done:
    notice = await auth.change_password(
        session=session,
        current_password=body.current_password,
        new_password=body.new_password,
        info=info,
    )
    background.add_task(auth.deliver, notice)
    return Done()


def _secret(response: Response) -> None:
    """The body carries something shown once. No cache may keep it."""
    response.headers["Cache-Control"] = "no-store"


@router.post(
    "/auth/totp/setup",
    summary="Start two-factor enrolment",
    description="Needs a fresh session. Two-factor is not on until the first code is confirmed.",
)
async def setup_totp(
    session: FreshSession, response: Response, auth: Auth, info: Info
) -> TotpSetupResponse:
    setup = await auth.setup_totp(session=session, info=info)
    _secret(response)
    return TotpSetupResponse(otpauth_uri=setup.uri, secret=setup.secret)


@router.post(
    "/auth/totp/setup/confirm",
    summary="Turn two-factor on with a first code",
    description="Returns the recovery codes once and ends the user's other sessions.",
)
async def confirm_totp(
    body: TotpConfirmRequest, session: CurrentSession, response: Response, auth: Auth, info: Info
) -> RecoveryCodesResponse:
    codes = await auth.confirm_totp(session=session, code=body.code, info=info)
    _secret(response)
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post(
    "/auth/totp/verify",
    summary="Give the second factor",
    description=(
        "Completes a sign-in that answered `totp_required`, or refreshes a full session. "
        "The session cookie is replaced."
    ),
)
async def verify_totp(
    body: TotpVerifyRequest,
    session: PendingOrActiveSession,
    response: Response,
    auth: Auth,
    info: Info,
) -> Done:
    verified = await auth.verify_totp(
        session=session, code=body.code, recovery_code=body.recovery_code, info=info
    )
    set_session_cookie(response, verified.token, max_age=_cookie_lifetime(verified.session))
    return Done()


@router.post(
    "/auth/totp/recovery-codes",
    summary="Replace the recovery codes",
    description="Needs a fresh session. The previous codes stop working.",
)
async def regenerate_recovery_codes(
    session: FreshSession, response: Response, auth: Auth, info: Info
) -> RecoveryCodesResponse:
    codes = await auth.regenerate_recovery_codes(session=session, info=info)
    _secret(response)
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post(
    "/auth/totp/disable",
    summary="Turn two-factor off",
    description="Needs a fresh session. Refused for an owner or admin of any workspace.",
)
async def disable_totp(session: FreshSession, auth: Auth, info: Info) -> Done:
    await auth.disable_totp(session=session, info=info)
    return Done()


@router.get("/auth/sessions", summary="The caller's signed-in sessions")
async def list_sessions(session: CurrentSession, auth: Auth) -> SessionList:
    return SessionList(
        data=[
            SessionItem(
                session_id=item.id,
                created_at=item.created_at,
                last_seen_at=item.last_seen_at,
                ip=item.ip,
                user_agent=item.user_agent,
                is_current=item.id == session.session_id,
            )
            for item in await auth.list_sessions(session)
        ]
    )


@router.post(
    "/auth/sessions/revoke-others",
    status_code=204,
    summary="End every session of the caller except this one",
)
async def revoke_other_sessions(session: CurrentSession, auth: Auth, info: Info) -> Response:
    await auth.revoke_other_sessions(session=session, info=info)
    return Response(status_code=204)


@router.delete(
    "/auth/sessions/{session_id}",
    status_code=204,
    summary="End one of the caller's sessions",
    description=(
        "404 for a session that is not the caller's. Ending the current one clears the cookie."
    ),
)
async def revoke_session(
    session_id: UUID, session: CurrentSession, auth: Auth, info: Info
) -> Response:
    await auth.revoke_session(session=session, session_id=session_id, info=info)
    response = Response(status_code=204)
    if session_id == session.session_id:
        clear_session_cookie(response)
    return response


def _me(profile: Profile, session: SessionContext) -> MeResponse:
    return MeResponse(
        data=Me(
            user=MeUser(
                user_id=profile.user.id,
                name=profile.user.name,
                email=profile.user.email,
                email_verified=profile.user.email_verified_at is not None,
                image=profile.user.image,
                two_factor_enabled=profile.two_factor_enabled,
                created_at=profile.user.created_at,
            ),
            session=MeSession(fresh_until=session.fresh_until, expires_at=session.idle_expires_at),
            memberships=[
                MeMembership(
                    workspace=MeWorkspace(
                        workspace_id=item.workspace_id,
                        name=item.workspace_name,
                        slug=item.workspace_slug,
                        status=item.workspace_status,
                    ),
                    role=Role(item.role),
                    project_ids=item.project_ids,
                    permissions=permissions_for(Role(item.role)),
                )
                for item in profile.memberships
            ],
        )
    )


@router.get("/me", summary="The signed-in user, this session and their workspaces")
async def me(session: CurrentSession, auth: Auth) -> MeResponse:
    return _me(await auth.profile(session), session)


@router.post(
    "/me/reauthenticate",
    summary="Re-enter a credential before a sensitive action",
    description=(
        "The session cookie is replaced and the new session is fresh for 10 minutes. "
        "A user with two-factor on must give `totp_code`; the password alone is refused."
    ),
)
async def reauthenticate(
    body: ReauthenticateRequest,
    session: CurrentSession,
    response: Response,
    auth: Auth,
    info: Info,
) -> ReauthenticateResponse:
    rotated = await auth.reauthenticate(
        session=session, password=body.password, totp_code=body.totp_code, info=info
    )
    set_session_cookie(response, rotated.token, max_age=_cookie_lifetime(rotated.session))
    # `fresh` is always set on a rotated session; the fallback only satisfies the type.
    fresh_until = rotated.session.fresh_until or rotated.session.last_seen_at
    return ReauthenticateResponse(fresh_until=fresh_until)


@router.patch("/me", summary="Change the caller's name or picture")
async def update_me(body: ProfileUpdate, session: CurrentSession, auth: Auth) -> MeResponse:
    changes = body.model_dump(include=body.model_fields_set)
    return _me(await auth.update_profile(session=session, changes=changes), session)
