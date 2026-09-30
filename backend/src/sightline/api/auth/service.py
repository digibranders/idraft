"""The auth use cases. Each one is a transaction that also writes its audit row.

A failure is never raised from inside the transaction that recorded it: the audit row of a wrong
password must survive the 401, so it is committed first and the error is raised afterwards.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
from collections.abc import Awaitable, Callable, Mapping
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
    SessionRecord,
    TokenPurpose,
    UserRecord,
)
from sightline.api.auth.sessions import SessionContext, SessionStore
from sightline.api.auth.throttle import LoginThrottle, ThrottleUnavailableError
from sightline.api.auth.tokens import hash_token, new_token
from sightline.api.auth.totp import (
    TotpCipher,
    hash_recovery_code,
    matching_step,
    new_recovery_codes,
    new_secret,
    provisioning_uri,
)
from sightline.api.permissions import TOTP_REQUIRED_ROLES
from sightline.api.problems import (
    ConflictError,
    DuplicateError,
    InvalidCodeError,
    InvalidCredentialsError,
    InvalidTokenError,
    NotFoundError,
    RateLimitedError,
    RegistrationClosedError,
    SecondFactorRequiredError,
    ServiceUnavailableError,
    TotpAlreadyEnabledError,
    TotpNotEnabledError,
    TwoFactorRequiredForRoleError,
    UnauthenticatedError,
    WeakPasswordProblemError,
)
from sightline.db.engine import user_transaction
from sightline.providers.email import EmailMessage, EmailSender

VERIFY_TOKEN_LIFETIME = timedelta(hours=24)
RESET_TOKEN_LIFETIME = timedelta(hours=1)
EMAILS_PER_HOUR = 3
EMAIL_REQUESTS_PER_HOUR_PER_IP = 30
# Tokens are 256 random bits, so this is about load, not guessing.
TOKEN_ATTEMPTS_PER_HOUR_PER_IP = 60
REGISTRATIONS_PER_HOUR_PER_IP = 10
# argon2id needs 19 MiB per hash. This bounds how much memory sign-ins can take at once.
HASHING_CONCURRENCY = 4
_HOUR = 3600
_log = structlog.get_logger(__name__)


class _SessionEndedError(Exception):
    """The session being replaced was revoked meanwhile. Aborts the surrounding transaction."""


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
    # The token hash of the session this one replaced, to evict from the cache after commit.
    replaced: bytes | None = None


@dataclass(frozen=True, slots=True)
class TotpSetup:
    uri: str
    secret: str


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
        totp: TotpCipher,
        email: EmailSender,
        app_origin: str,
        registration: Literal["invited", "open"],
    ) -> None:
        self._sessions = sessions
        self._store = store
        self._throttle = throttle
        self._breached = breached
        self._totp = totp
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
        async with self._sessions() as db, db.begin():
            invited = await self._holds_invitation(db, email, invitation_token, now)
        if self._registration == "invited" and not invited:
            # One answer whether the token is missing, unknown, used, expired or for someone else.
            raise RegistrationClosedError
        await self._check_password(password, email=email)
        password_hash = await self._hash(password)

        token = new_token()
        try:
            async with self._sessions() as db, db.begin():
                # Hashing took a moment: the invitation may have been cancelled since.
                if invited and not await self._holds_invitation(db, email, invitation_token, now):
                    raise RegistrationClosedError
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
        await self._limit("token:ip", info.throttle_ip, TOKEN_ATTEMPTS_PER_HOUR_PER_IP)
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
        await self._refuse_if_locked(email, info)
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

        new_hash = await self._hash(password) if needs_rehash(user.password_hash) else None
        signed_in = await self._open_session(user, password, new_hash, info, now)
        if signed_in is None:
            raise InvalidCredentialsError
        if signed_in.status == "signed_in":
            # Only a completed sign-in clears the failure count. With a second factor still
            # owed, clearing it here would let someone who knows the password start over after
            # every few wrong codes and guess the code without limit.
            await self._guard(self._throttle.success(email=email))
        return signed_in

    async def _open_session(
        self,
        user: UserRecord,
        password: str,
        new_hash: str | None,
        info: RequestInfo,
        now: datetime,
    ) -> SignedIn | None:
        """Create the session for a verified password. None if the password no longer matches.

        The row lock orders this against a password change or reset, which updates the same row
        before it revokes sessions: either this session exists by then and is revoked with the
        rest, or the change came first and is seen here.
        """
        async with self._sessions() as db, db.begin():
            current = await repository.lock_password_hash(
                db, user.id, exclusive=new_hash is not None
            )
            if current is None:
                return None
            if current != user.password_hash:
                # The hash changed since it was verified a moment ago: a parallel sign-in
                # rehashed it, or the password really changed. Only the stored hash decides.
                if not await self._verify(current, password):
                    return None
                new_hash = None
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
    # Passwords

    async def request_password_reset(self, *, email: str, info: RequestInfo) -> None:
        """Send a reset link if the address has an enabled account. Runs after the response."""
        await self._after_response(self._send_token_email(email, "password_reset", info))

    async def confirm_password_reset(
        self, *, token: str, new_password: str, info: RequestInfo
    ) -> EmailMessage:
        """Set a new password with an emailed token, and end every session of the user.

        Returns the notice to send. The token is used only once the new password is acceptable,
        so a refused password does not cost the user their link.
        """
        now = datetime.now(UTC)
        await self._limit("token:ip", info.throttle_ip, TOKEN_ATTEMPTS_PER_HOUR_PER_IP)
        token_hash = hash_token(token)
        async with self._sessions() as db, db.begin():
            user_id = await repository.find_token_user(
                db, token_hash=token_hash, purpose="password_reset", now=now
            )
            user = None if user_id is None else await repository.get_user(db, user_id)
        if user is None or user.disabled_at is not None:
            raise InvalidTokenError
        await self._check_password(new_password, email=user.email)
        password_hash = await self._hash(new_password)

        revoked: list[bytes] = []
        consumed: UUID | None = None
        async with self._sessions() as db, db.begin():
            # Locking the user row first orders this against a sign-in in progress. It finds
            # no row if the account was disabled while the password was being hashed.
            if await repository.lock_password_hash(db, user.id, exclusive=True) is not None:
                consumed = await repository.consume_token(
                    db, token_hash=token_hash, purpose="password_reset", now=now
                )
            if consumed is not None:
                await repository.set_password_hash(
                    db, user_id=user.id, password_hash=password_hash, now=now
                )
                # The token arrived by email, so it also proves the mailbox.
                await repository.mark_email_verified(db, user_id=user.id, now=now)
                revoked = await self._store.revoke_all(
                    db, user_id=user.id, except_session_id=None, now=now
                )
                await self._audit(
                    db, "auth.password.reset", user.id, info, {"sessions_ended": len(revoked)}
                )
        if consumed is None:
            raise InvalidTokenError
        await self._store.forget(revoked)
        try:
            # Whoever holds the mailbox may sign in again, even if someone locked the account.
            await self._throttle.clear(email=user.email)
        except ThrottleUnavailableError:
            _log.warning("account lock not cleared after a password reset")
        return mail.password_changed_email(
            origin=self._origin, to=user.email, name=user.name, signed_out="all"
        )

    async def change_password(
        self,
        *,
        session: SessionContext,
        current_password: str,
        new_password: str,
        info: RequestInfo,
    ) -> EmailMessage:
        """Change the password of the signed-in user and end their other sessions."""
        now = datetime.now(UTC)
        user = await self._user(session)
        await self._refuse_if_locked(user.email, info)
        if not await self._verify(user.password_hash, current_password):
            await self._credential_failed(user, "auth.password.change_failed", info)
            raise InvalidCredentialsError
        if new_password == current_password:
            raise WeakPasswordProblemError(reason="unchanged")
        await self._check_password(new_password, email=user.email)
        password_hash = await self._hash(new_password)

        revoked: list[bytes] = []
        async with self._sessions() as db, db.begin():
            current = await repository.lock_password_hash(db, user.id, exclusive=True)
            # Changed since it was verified a moment ago: only the stored hash decides.
            still_mine = current == user.password_hash or (
                current is not None and await self._verify(current, current_password)
            )
            if still_mine:
                await repository.set_password_hash(
                    db, user_id=user.id, password_hash=password_hash, now=now
                )
                revoked = await self._store.revoke_all(
                    db, user_id=user.id, except_session_id=session.session_id, now=now
                )
                await self._audit(
                    db, "auth.password.changed", user.id, info, {"sessions_ended": len(revoked)}
                )
        if not still_mine:
            raise InvalidCredentialsError
        await self._store.forget(revoked)
        await self._credential_accepted(user)
        return mail.password_changed_email(
            origin=self._origin, to=user.email, name=user.name, signed_out="others"
        )

    # -----------------------------------------------------------------------------------------
    # Two-factor

    async def setup_totp(self, *, session: SessionContext, info: RequestInfo) -> TotpSetup:
        """Start enrolment. The secret is stored encrypted and does nothing until confirmed."""
        user = await self._user(session)
        secret = new_secret()
        async with self._sessions() as db, db.begin():
            stored = await repository.store_unconfirmed_totp(
                db,
                user_id=user.id,
                secret_encrypted=self._totp.encrypt(secret, user_id=user.id),
            )
            if stored:
                await self._audit(db, "auth.totp.setup_started", user.id, info, None)
        if not stored:
            raise TotpAlreadyEnabledError
        return TotpSetup(uri=provisioning_uri(secret, email=user.email), secret=secret)

    async def confirm_totp(
        self, *, session: SessionContext, code: str, info: RequestInfo
    ) -> list[str]:
        """Turn two-factor on with a first valid code. Returns the recovery codes, shown once."""
        now = datetime.now(UTC)
        user = await self._user(session)
        await self._refuse_if_locked(user.email, info)
        async with self._sessions() as db, db.begin():
            record = await repository.get_totp(db, user.id)
        if record is None:
            raise ConflictError("Start two-factor setup first.")
        if record.confirmed:
            raise TotpAlreadyEnabledError
        secret = self._totp.decrypt(record.secret_encrypted, user_id=user.id)
        step = matching_step(secret, code, at=now)
        if step is None:
            await self._credential_failed(user, "auth.totp.confirm_failed", info)
            raise InvalidCodeError

        codes = new_recovery_codes()
        revoked: list[bytes] = []
        async with self._sessions() as db, db.begin():
            confirmed = await repository.confirm_totp(
                db,
                user_id=user.id,
                step=step,
                recovery_code_hashes=[hash_recovery_code(item) for item in codes],
                now=now,
            )
            if confirmed:
                revoked = await self._store.revoke_all(
                    db, user_id=user.id, except_session_id=session.session_id, now=now
                )
                await self._audit(db, "auth.totp.enabled", user.id, info, None)
        if not confirmed:
            # Another request confirmed first. Its recovery codes are the real ones.
            raise TotpAlreadyEnabledError
        await self._store.forget(revoked)
        return codes

    async def verify_totp(
        self,
        *,
        session: SessionContext,
        code: str | None,
        recovery_code: str | None,
        info: RequestInfo,
    ) -> SignedIn:
        """Complete a sign-in, or refresh a full session, with the second factor.

        The session is replaced, not upgraded: a new token, fresh, ending when the old one would.
        """
        user = await self._user(session)
        await self._refuse_if_locked(user.email, info)
        method = "code" if code is not None else "recovery_code"
        rotated = await self._use_second_factor(
            user,
            session,
            code=code,
            recovery_code=recovery_code,
            info=info,
            action="auth.totp.verified",
            details={"method": method},
        )
        if rotated is None:
            await self._credential_failed(user, "auth.totp.verify_failed", info)
            raise InvalidCodeError
        await self._credential_accepted(user)
        return rotated

    async def reauthenticate(
        self,
        *,
        session: SessionContext,
        password: str | None,
        totp_code: str | None,
        info: RequestInfo,
    ) -> SignedIn:
        """Prove again who is at the keyboard. Replaces the session with a fresh one."""
        now = datetime.now(UTC)
        user = await self._user(session)
        await self._refuse_if_locked(user.email, info)
        if password is not None:
            async with self._sessions() as db, db.begin():
                two_factor = await repository.has_confirmed_totp(db, user.id)
            if two_factor:
                # A fresh session may replace recovery codes and change the password. If the
                # password alone could make it fresh, a stolen cookie plus the password would
                # be enough to take the second factor away.
                raise SecondFactorRequiredError
            rotated = await self._use_password(user, session, password, info, now)
        else:
            rotated = await self._use_second_factor(
                user,
                session,
                code=totp_code,
                recovery_code=None,
                info=info,
                action="auth.reauthenticated",
                details={"method": "code"},
            )
        if rotated is None:
            await self._credential_failed(user, "auth.reauthenticate_failed", info)
            raise InvalidCredentialsError
        await self._credential_accepted(user)
        return rotated

    async def _use_password(
        self,
        user: UserRecord,
        session: SessionContext,
        password: str,
        info: RequestInfo,
        now: datetime,
    ) -> SignedIn | None:
        """Check the password and, if it holds, replace the session. None when it is wrong."""
        if not await self._verify(user.password_hash, password):
            return None
        async with self._sessions() as db, db.begin():
            rotated = await self._rotate(db, session, info, now)
            if rotated is not None:
                await self._audit(db, "auth.reauthenticated", user.id, info, {"method": "password"})
        if rotated is not None and rotated.replaced is not None:
            await self._store.forget([rotated.replaced])
        return rotated

    async def regenerate_recovery_codes(
        self, *, session: SessionContext, info: RequestInfo
    ) -> list[str]:
        codes = new_recovery_codes()
        async with self._sessions() as db, db.begin():
            replaced = await repository.replace_recovery_codes(
                db,
                user_id=session.user_id,
                recovery_code_hashes=[hash_recovery_code(item) for item in codes],
            )
            if replaced:
                await self._audit(
                    db, "auth.totp.recovery_codes_replaced", session.user_id, info, None
                )
        if not replaced:
            raise TotpNotEnabledError
        return codes

    async def disable_totp(self, *, session: SessionContext, info: RequestInfo) -> None:
        """Turn two-factor off, unless a role of the user requires it."""
        now = datetime.now(UTC)
        async with user_transaction(self._sessions, session.user_id) as db:
            required = await repository.holds_role(
                db, user_id=session.user_id, roles=sorted(TOTP_REQUIRED_ROLES)
            )
        if required:
            raise TwoFactorRequiredForRoleError
        revoked: list[bytes] = []
        async with self._sessions() as db, db.begin():
            if await repository.delete_totp(db, session.user_id):
                revoked = await self._store.revoke_all(
                    db, user_id=session.user_id, except_session_id=session.session_id, now=now
                )
                await self._audit(db, "auth.totp.disabled", session.user_id, info, None)
        await self._store.forget(revoked)

    async def _use_second_factor(
        self,
        user: UserRecord,
        session: SessionContext,
        *,
        code: str | None,
        recovery_code: str | None,
        info: RequestInfo,
        action: str,
        details: dict[str, object],
    ) -> SignedIn | None:
        """Check a TOTP code or a recovery code and, if it holds, replace the session.

        Using the factor and creating the session are one transaction: a code is never spent on a
        session that was not created. None when the factor is wrong, already used or not set up.
        """
        now = datetime.now(UTC)
        async with self._sessions() as db, db.begin():
            record = await repository.get_totp(db, user.id)
        if record is None or not record.confirmed:
            return None
        step: int | None = None
        if code is not None:
            secret = self._totp.decrypt(record.secret_encrypted, user_id=user.id)
            step = matching_step(secret, code, at=now)
            if step is None:
                return None

        try:
            async with self._sessions() as db, db.begin():
                if step is not None:
                    # A step can be claimed once, so a replayed code stops here.
                    if not await repository.claim_totp_step(db, user_id=user.id, step=step):
                        return None
                    left = record.recovery_codes_left
                else:
                    remaining = await repository.use_recovery_code(
                        db, user_id=user.id, code_hash=hash_recovery_code(recovery_code or "")
                    )
                    if remaining is None:
                        return None
                    left = remaining
                rotated = await self._rotate(db, session, info, now)
                if rotated is None:
                    # The session ended meanwhile. Leaving by exception rolls the claim back.
                    raise _SessionEndedError
                await self._audit(
                    db, action, user.id, info, details | {"recovery_codes_left": left}
                )
        except _SessionEndedError:
            return None
        if rotated.replaced is not None:
            await self._store.forget([rotated.replaced])
        return rotated

    async def _rotate(
        self, db: AsyncSession, session: SessionContext, info: RequestInfo, now: datetime
    ) -> SignedIn | None:
        """Replace a session with a new, fresh, active one that ends when the old one would.

        None if the old session was revoked meanwhile: a dead session is never exchanged.
        """
        replaced = await self._store.revoke(
            db, session_id=session.session_id, user_id=session.user_id, now=now
        )
        if replaced is None:
            return None
        token, new_session = await self._store.create(
            db,
            user_id=session.user_id,
            state="active",
            fresh=True,
            ip=info.ip,
            user_agent=info.user_agent,
            now=now,
            absolute_expires_at=session.absolute_expires_at,
        )
        return SignedIn(token=token, session=new_session, status="signed_in", replaced=replaced)

    async def _user(self, session: SessionContext) -> UserRecord:
        """The account behind a session. A cached session can outlive its account by a minute:
        nothing that changes the account may rely on the cache alone."""
        async with self._sessions() as db, db.begin():
            user = await repository.get_user(db, session.user_id)
        if user is None or user.disabled_at is not None:
            raise UnauthenticatedError
        return user

    # -----------------------------------------------------------------------------------------
    # Sessions

    async def list_sessions(self, session: SessionContext) -> list[SessionRecord]:
        async with self._sessions() as db, db.begin():
            return await repository.list_live_sessions(
                db, user_id=session.user_id, now=datetime.now(UTC)
            )

    async def revoke_session(
        self, *, session: SessionContext, session_id: UUID, info: RequestInfo
    ) -> None:
        """End one of the caller's sessions. A session of someone else does not exist for them."""
        now = datetime.now(UTC)
        async with self._sessions() as db, db.begin():
            revoked = await self._store.revoke(
                db, session_id=session_id, user_id=session.user_id, now=now
            )
            if revoked is not None:
                await self._audit(db, "auth.session.revoked", session.user_id, info, {"count": 1})
        if revoked is None:
            raise NotFoundError
        await self._store.forget([revoked])

    async def revoke_other_sessions(self, *, session: SessionContext, info: RequestInfo) -> None:
        now = datetime.now(UTC)
        async with self._sessions() as db, db.begin():
            revoked = await self._store.revoke_all(
                db, user_id=session.user_id, except_session_id=session.session_id, now=now
            )
            await self._audit(
                db, "auth.session.revoked", session.user_id, info, {"count": len(revoked)}
            )
        await self._store.forget(revoked)

    # -----------------------------------------------------------------------------------------
    # The current user

    async def update_profile(
        self, *, session: SessionContext, changes: Mapping[str, str | None]
    ) -> Profile:
        async with self._sessions() as db, db.begin():
            await repository.update_profile(
                db, user_id=session.user_id, changes=changes, now=datetime.now(UTC)
            )
        return await self.profile(session)

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

    @staticmethod
    async def _holds_invitation(
        db: AsyncSession, email: str, token: str | None, now: datetime
    ) -> bool:
        if token is None:
            return False
        return await repository.holds_pending_invitation(
            db, token_hash=hash_token(token), email=email, now=now
        )

    async def _check_password(self, password: str, *, email: str) -> None:
        try:
            check_policy(password, email=email)
        except WeakPasswordError as error:
            raise WeakPasswordProblemError(reason=error.reason) from None
        if self._breached is not None and await self._breached.is_breached(password):
            raise WeakPasswordProblemError(reason="breached")

    async def _refuse_if_locked(self, email: str, info: RequestInfo) -> None:
        wait = await self._guard(self._throttle.check(email=email, ip=info.throttle_ip))
        if wait is not None:
            raise RateLimitedError(
                "Too many failed attempts. Try again later.",
                headers={"Retry-After": str(wait)},
                retry_after_seconds=wait,
            )

    async def _credential_failed(self, user: UserRecord, action: str, info: RequestInfo) -> None:
        """Record a wrong credential from a signed-in user, then count it.

        The audit row is committed first, so it exists even if Redis cannot count.
        """
        async with self._sessions() as db, db.begin():
            await self._audit(db, action, user.id, info, None)
        if await self._guard(self._throttle.failure(email=user.email, ip=info.throttle_ip)):
            async with self._sessions() as db, db.begin():
                await self._audit(db, "auth.lockout", user.id, info, None)

    async def _credential_accepted(self, user: UserRecord) -> None:
        """A right credential clears the account's failures, as a successful sign-in does."""
        try:
            await self._throttle.success(email=user.email)
        except ThrottleUnavailableError:
            _log.warning("failure count not cleared after a successful credential check")

    async def _sign_in_failed(
        self, *, email: str, user: UserRecord | None, reason: str, info: RequestInfo
    ) -> None:
        """Record the failure, then count it. Both are committed before the caller raises.

        The audit row comes first, so it exists even if Redis cannot count.
        """
        user_id = None if user is None else user.id
        async with self._sessions() as db, db.begin():
            await self._audit(
                db, "auth.sign_in_failed", user_id, info, {"reason": reason}, email=email
            )
        if await self._guard(self._throttle.failure(email=email, ip=info.throttle_ip)):
            async with self._sessions() as db, db.begin():
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
