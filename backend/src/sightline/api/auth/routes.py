"""Auth and current-user routes (docs/19-api-specification.md section 3.1).

Thin on purpose: parse the body, call the service, set or clear the cookie.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response

from sightline.api.auth.dependencies import (
    CurrentSession,
    OptionalSession,
    clear_session_cookie,
    set_session_cookie,
)
from sightline.api.auth.service import AuthService, RequestInfo, request_info
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
    RegisterRequest,
    RegisterResponse,
    SignInRequest,
    SignInResponse,
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


@router.get("/me", summary="The signed-in user, this session and their workspaces")
async def me(session: CurrentSession, auth: Auth) -> MeResponse:
    profile = await auth.profile(session)
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
