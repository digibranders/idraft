"""The auth use cases. Each one is a transaction that also writes its audit row.

A failure is never raised from inside the transaction that recorded it: the audit row of a wrong
password must survive the 401, so it is committed first and the error is raised afterwards.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api.auth import mail, repository
from sightline.api.auth.passwords import (
    BreachedPasswords,
    WeakPasswordError,
    check_policy,
    dummy_verify,
    hash_password,
    needs_rehash,
    verify_password,
)
from sightline.api.auth.repository import (
    EmailTakenError,
    MembershipRecord,
    TokenPurpose,
    UserRecord,
)
from sightline.api.auth.sessions import SessionContext, SessionStore
from sightline.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from sightline.api.auth.tokens import hash_token, new_token
from sightline.api.problems import (
    DuplicateError,
    InvalidCredentialsError,
    InvalidTokenError,
    RateLimitedError,
    RegistrationClosedError,
    ServiceUnavailableError,
    UnauthenticatedError,
    WeakPasswordProblemError,
)
from sightline.db.engine import user_transaction
from sightline.providers.email import EmailMessage, EmailSender

VERIFY_TOKEN_LIFETIME = timedelta(hours=24)
RESET_TOKEN_LIFETIME = timedelta(hours=1)
EMAILS_PER_HOUR = 3
EMAIL_REQUESTS_PER_HOUR_PER_IP = 30
REGISTRATIONS_PER_HOUR_PER_IP = 10
# argon2id needs 19 MiB per hash. This bounds how much memory sign-ins can take at once.
HASHING_CONCURRENCY = 4
_HOUR = 3600
_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class RequestInfo:
    """Where a request came from, for throttling and the audit log."""

    ip: str | None
    user_agent: str | None
    request_id: str | None

    @property
    def throttle_ip(self) -> str:
        return self.ip or "unknown"


def request_info(
    *, client_host: str | None, user_agent: str | None, request_id: str | None
) -> RequestInfo:
    """Build RequestInfo from what the server reports. An address that is not an IP is dropped."""
    ip: str | None = None
    if client_host is not None:
        try:
            ip = str(ipaddress.ip_address(client_host))
        except ValueError:
            ip = None
    return RequestInfo(ip=ip, user_agent=user_agent, request_id=request_id)


@dataclass(frozen=True, slots=True)
class Registered:
    user_id: UUID
    email_verified: bool
    email: EmailMessage | None


@dataclass(frozen=True, slots=True)
class SignedIn:
    token: str
    session: SessionContext
    status: Literal["signed_in", "totp_required"]


@dataclass(frozen=True, slots=True)
class Profile:
    user: UserRecord
    two_factor_enabled: bool
    memberships: list[MembershipRecord]


class AuthService:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        store: SessionStore,
        throttle: LoginThrottle,
        breached: BreachedPasswords | None,
        email: EmailSender,
        app_origin: str,
        registration: Literal["invited", "open"],
    ) -> None:
        self._sessions = sessions
        self._store = store
        self._throttle = throttle
        self._breached = breached
        self._email = email
        self._origin = app_origin
        self._registration = registration
        self._hashing = asyncio.Semaphore(HASHING_CONCURRENCY)

    # -----------------------------------------------------------------------------------------
    # Registration and email verification

    async def register(
        self,
        *,
        name: str,
        email: str,
        password: str,
        invitation_token: str | None,
        info: RequestInfo,
    ) -> Registered:
        now = datetime.now(UTC)
        await self._limit("register:ip", info.throttle_ip, REGISTRATIONS_PER_HOUR_PER_IP)
        invited = await self._holds_invitation(email, invitation_token, now)
        if self._registration == "invited" and not invited:
            # One answer whether the token is missing, unknown, used, expired or for someone else.
            raise RegistrationClosedError
        await self._check_password(password, email=email)
        password_hash = await self._hash(password)

        token = new_token()
        try:
            async with self._sessions() as db, db.begin():
                user_id = await repository.insert_user(
                    db, email=email, name=name, password_hash=password_hash
                )
                if invited:
                    # The invitation was sent to this address, so holding it proves the mailbox.
                    await repository.mark_email_verified(db, user_id=user_id, now=now)
                else:
                    await repository.insert_token(
                        db,
                        user_id=user_id,
                        purpose="email_verification",
                        token_hash=hash_token(token),
                        expires_at=now + VERIFY_TOKEN_LIFETIME,
                    )
                await self._audit(db, "auth.register", user_id, info, {"invited": invited})
        except EmailTakenError:
            raise DuplicateError("An account with this email already exists.") from None
        message = (
            None
            if invited
            else mail.verification_email(origin=self._origin, to=email, name=name, token=token)
        )
        return Registered(user_id=user_id, email_verified=invited, email=message)

    async def limit_email_requests(self, info: RequestInfo) -> None:
        """Bound how many verification and reset emails one address on the network can ask for."""
        await self._limit("email:ip", info.throttle_ip, EMAIL_REQUESTS_PER_HOUR_PER_IP)

    async def request_email_verification(self, *, email: str, info: RequestInfo) -> None:
        """Send a new verification link if there is an unverified account.

        Runs after the response has gone out, so neither the answer nor its timing says whether
        the address has an account.
        """
        await self._after_response(self._send_token_email(email, "email_verification", info))

    async def verify_email(self, *, token: str, info: RequestInfo) -> None:
        now = datetime.now(UTC)
        async with self._sessions() as db, db.begin():
            user_id = await repository.consume_token(
                db, token_hash=hash_token(token), purpose="email_verification", now=now
            )
            if user_id is not None:
                await repository.mark_email_verified(db, user_id=user_id, now=now)
                await self._audit(db, "auth.email_verified", user_id, info, None)
        if user_id is None:
            # One answer for unknown, used, expired and wrong-purpose tokens.
            raise InvalidTokenError

    # -----------------------------------------------------------------------------------------
    # Sign-in and sign-out

    async def sign_in(self, *, email: str, password: str, info: RequestInfo) -> SignedIn:
        now = datetime.now(UTC)
        wait = await self._guard(self._throttle.check(email=email, ip=info.throttle_ip))
        if wait is not None:
            raise RateLimitedError(
                "Too many failed attempts. Try again later.",
                headers={"Retry-After": str(wait)},
                retry_after_seconds=wait,
            )
        async with self._sessions() as db, db.begin():
            user = await repository.find_user_by_email(db, email)

        if user is None or user.disabled_at is not None:
            # Spend what a real check costs, so the answer does not come back faster.
            await self._in_thread(dummy_verify)
            reason = "unknown_email" if user is None else "disabled"
            await self._sign_in_failed(email=email, user=user, reason=reason, info=info)
            raise InvalidCredentialsError
        if not await self._verify(user.password_hash, password):
            await self._sign_in_failed(email=email, user=user, reason="wrong_password", info=info)
            raise InvalidCredentialsError

        await self._guard(self._throttle.success(email=email))
        new_hash = await self._hash(password) if needs_rehash(user.password_hash) else None
        async with self._sessions() as db, db.begin():
            if new_hash is not None:
                await repository.set_password_hash(
                    db, user_id=user.id, password_hash=new_hash, now=now
                )
            two_factor = await repository.has_confirmed_totp(db, user.id)
            token, session = await self._store.create(
                db,
                user_id=user.id,
                state="pending_totp" if two_factor else "active",
                # A password alone is a full sign-in only when there is no second factor.
                fresh=not two_factor,
                ip=info.ip,
                user_agent=info.user_agent,
                now=now,
            )
            await self._audit(db, "auth.sign_in", user.id, info, {"totp_pending": two_factor})
        return SignedIn(
            token=token, session=session, status="totp_required" if two_factor else "signed_in"
        )

    async def sign_out(self, *, session: SessionContext, info: RequestInfo) -> None:
        now = datetime.now(UTC)
        async with self._sessions() as db, db.begin():
            revoked = await self._store.revoke(
                db, session_id=session.session_id, user_id=session.user_id, now=now
            )
            if revoked is not None:
                await self._audit(db, "auth.sign_out", session.user_id, info, None)
        if revoked is not None:
            await self._store.forget([revoked])

    # -----------------------------------------------------------------------------------------
    # The current user

    async def profile(self, session: SessionContext) -> Profile:
        async with user_transaction(self._sessions, session.user_id) as db:
            user = await repository.get_user(db, session.user_id)
            if user is None:
                # The account was removed while its session was cached.
                raise UnauthenticatedError
            return Profile(
                user=user,
                two_factor_enabled=await repository.has_confirmed_totp(db, user.id),
                memberships=await repository.list_memberships(db, user.id),
            )

    # -----------------------------------------------------------------------------------------
    # Email

    async def deliver(self, message: EmailMessage) -> None:
        """Send a message after the response has gone out. A failure is logged, never raised."""
        try:
            await self._email.send(message)
        except Exception as error:
            _log.error(
                "email was not sent", error_kind=type(error).__name__, subject=message.subject
            )

    async def _after_response(self, work: Awaitable[None]) -> None:
        """Run background work. The caller has its answer already; a failure here is only logged."""
        try:
            await work
        except Exception as error:
            _log.error("background auth work failed", error_kind=type(error).__name__)

    async def _send_token_email(self, email: str, purpose: TokenPurpose, info: RequestInfo) -> None:
        try:
            allowed = await self._throttle.allow(
                f"email:{purpose}", email, limit=EMAILS_PER_HOUR, window_seconds=_HOUR
            )
        except ThrottleUnavailableError:
            _log.error("email request dropped: throttle unavailable", purpose=purpose)
            return
        if not allowed:
            return
        now = datetime.now(UTC)
        token = new_token()
        verifying = purpose == "email_verification"
        lifetime = VERIFY_TOKEN_LIFETIME if verifying else RESET_TOKEN_LIFETIME
        async with self._sessions() as db, db.begin():
            user = await repository.find_user_by_email(db, email)
            if user is None or user.disabled_at is not None:
                return
            if verifying and user.email_verified_at is not None:
                return
            await repository.supersede_tokens(db, user_id=user.id, purpose=purpose, now=now)
            await repository.insert_token(
                db,
                user_id=user.id,
                purpose=purpose,
                token_hash=hash_token(token),
                expires_at=now + lifetime,
            )
            await self._audit(db, f"auth.{purpose}.requested", user.id, info, None)
        build = mail.verification_email if verifying else mail.password_reset_email
        await self.deliver(build(origin=self._origin, to=user.email, name=user.name, token=token))

    # -----------------------------------------------------------------------------------------
    # Helpers

    async def _holds_invitation(self, email: str, token: str | None, now: datetime) -> bool:
        if token is None:
            return False
        async with self._sessions() as db, db.begin():
            invitation = await repository.find_invitation_by_token(db, hash_token(token))
        return (
            invitation is not None
            and invitation.status == "pending"
            and invitation.expires_at > now
            and invitation.email.casefold() == email.casefold()
        )

    async def _check_password(self, password: str, *, email: str) -> None:
        try:
            check_policy(password, email=email)
        except WeakPasswordError as error:
            raise WeakPasswordProblemError(reason=error.reason) from None
        if self._breached is not None and await self._breached.is_breached(password):
            raise WeakPasswordProblemError(reason="breached")

    async def _sign_in_failed(
        self, *, email: str, user: UserRecord | None, reason: str, info: RequestInfo
    ) -> None:
        """Count the failure and record it. Commits before the caller raises."""
        locked = await self._guard(self._throttle.failure(email=email, ip=info.throttle_ip))
        user_id = None if user is None else user.id
        async with self._sessions() as db, db.begin():
            await self._audit(
                db, "auth.sign_in_failed", user_id, info, {"reason": reason}, email=email
            )
            if locked:
                await self._audit(db, "auth.lockout", user_id, info, None, email=email)

    async def _audit(
        self,
        db: AsyncSession,
        action: str,
        user_id: UUID | None,
        info: RequestInfo,
        details: dict[str, object] | None,
        *,
        email: str | None = None,
    ) -> None:
        if user_id is not None:
            target_type, target_id = "user", str(user_id)
        else:
            # No account: name the attempt by a digest, so attempts on one address can be grouped
            # without storing whatever was typed into the form.
            digest = hashlib.sha256((email or "").casefold().encode("utf-8", "surrogatepass"))
            target_type, target_id = "email_sha256", digest.hexdigest()[:32]
        await repository.record_auth_event(
            db,
            action=action,
            user_id=user_id,
            target_type=target_type,
            target_id=target_id,
            ip=info.ip,
            user_agent=info.user_agent,
            request_id=info.request_id,
            details=None if details is None else json.dumps(details),
        )

    async def _limit(self, scope: str, subject: str, per_hour: int) -> None:
        allowed = await self._guard(
            self._throttle.allow(scope, subject, limit=per_hour, window_seconds=_HOUR)
        )
        if not allowed:
            raise RateLimitedError(
                "Too many requests. Try again later.",
                headers={"Retry-After": str(_HOUR)},
                retry_after_seconds=_HOUR,
            )

    @staticmethod
    async def _guard[T](operation: Awaitable[T]) -> T:
        """Await a throttle call. If Redis cannot count, the auth routes stop with 503."""
        try:
            return await operation
        except ThrottleUnavailableError:
            raise ServiceUnavailableError("Sign-in is temporarily unavailable.") from None

    async def _hash(self, password: str) -> str:
        return await self._in_thread(hash_password, password)

    async def _verify(self, encoded: str, password: str) -> bool:
        return await self._in_thread(verify_password, encoded, password)

    async def _in_thread[**P, T](
        self, function: Callable[P, T], *args: P.args, **kwargs: P.kwargs
    ) -> T:
        """Run a hashing call off the event loop, a few at a time."""
        async with self._hashing:
            return await asyncio.to_thread(function, *args, **kwargs)
