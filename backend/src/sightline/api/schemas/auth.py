"""Bodies of the auth and current-user routes (docs/19-api-specification.md section 3.1)."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from sightline.api.permissions import Role

NAME_MAX = 120
EMAIL_MAX = 254
# Far above the policy limit: the policy answers with a reason, this only bounds the body.
PASSWORD_BODY_MAX = 1024
TOKEN_BODY_MAX = 128
IMAGE_URL_MAX = 2048
_EMAIL = re.compile(r"[^\s<>@,;\x00-\x1f\x7f]+@[^\s<>@,;\x00-\x1f\x7f]+")


def _printable(value: str) -> str:
    if any(unicodedata.category(character) in ("Cc", "Cf", "Zl", "Zp") for character in value):
        raise ValueError("must not contain control characters")
    return value


def _email(value: str) -> str:
    if not _EMAIL.fullmatch(value):
        raise ValueError("must be an email address")
    return value


# Every string here carries a length constraint. Besides bounding the body, that makes Pydantic
# refuse text UTF-8 cannot carry (a lone surrogate, which JSON allows): the hashers and the
# database would raise on it. tests/api/auth/test_register.py pins this for each type.
Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX),
    AfterValidator(_printable),
]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=EMAIL_MAX),
    AfterValidator(_printable),
    AfterValidator(_email),
]
Password = Annotated[str, StringConstraints(max_length=PASSWORD_BODY_MAX)]
# Shown in an <img>. https only, and nothing a browser would treat as a second attribute.
ImageUrl = Annotated[
    str,
    StringConstraints(max_length=IMAGE_URL_MAX, pattern=r"^https://[^\s<>\"'`\\]+$"),
    AfterValidator(_printable),
]
Token = Annotated[str, StringConstraints(min_length=1, max_length=TOKEN_BODY_MAX)]
# Pydantic's regex engine anchors `$` at the very end: a trailing newline does not match.
TotpCode = Annotated[str, StringConstraints(pattern=r"^[0-9]{6}$")]
RecoveryCode = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class _Body(BaseModel):
    """A request body. Unknown members are refused, so a misspelt field is an error, not ignored."""

    model_config = ConfigDict(extra="forbid")


class RegisterRequest(_Body):
    name: Name
    email: Email
    password: Password
    invitation_token: Token | None = Field(
        default=None,
        description="From an invitation link. Required while registration is by invitation only.",
    )


class RegisterResponse(BaseModel):
    user_id: UUID
    email_verified: bool


class EmailRequest(_Body):
    email: Email


class VerifyEmailRequest(_Body):
    token: Token


class SignInRequest(_Body):
    email: Email
    password: Password


class SignInResponse(BaseModel):
    status: Literal["signed_in", "totp_required"]


class Accepted(BaseModel):
    """The request was taken. The answer is the same whether or not the address has an account."""

    status: Literal["accepted"] = "accepted"


class Done(BaseModel):
    status: Literal["ok"] = "ok"


class MeUser(BaseModel):
    user_id: UUID
    name: str
    email: str
    email_verified: bool
    image: str | None
    two_factor_enabled: bool
    created_at: datetime


class MeSession(BaseModel):
    fresh_until: datetime | None
    expires_at: datetime
    auth_method: Literal["session"] = "session"


class MeWorkspace(BaseModel):
    workspace_id: UUID
    name: str
    slug: str
    status: Literal["active", "suspended", "deleting"]


class MeMembership(BaseModel):
    workspace: MeWorkspace
    role: Role
    project_ids: list[UUID] | None = Field(description="null means every project")
    permissions: list[str]


class Me(BaseModel):
    user: MeUser
    session: MeSession
    memberships: list[MeMembership]


class MeResponse(BaseModel):
    data: Me


class PasswordResetConfirmRequest(_Body):
    token: Token
    new_password: Password


class PasswordChangeRequest(_Body):
    current_password: Password
    new_password: Password


class SessionItem(BaseModel):
    session_id: UUID
    created_at: datetime
    last_seen_at: datetime
    ip: str | None
    user_agent: str | None
    is_current: bool


class SessionList(BaseModel):
    data: list[SessionItem]


class ProfileUpdate(_Body):
    """At least one member. `image: null` removes the picture; `name` cannot be null."""

    name: Name | None = None
    image: ImageUrl | None = None

    @model_validator(mode="after")
    def _says_something(self) -> ProfileUpdate:
        if not self.model_fields_set:
            raise ValueError("give name, image or both")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class TotpSetupResponse(BaseModel):
    otpauth_uri: str = Field(description="For the QR code an authenticator app scans.")
    secret: str = Field(description="The same secret, for typing in by hand. Shown once.")


class TotpConfirmRequest(_Body):
    code: TotpCode


class RecoveryCodesResponse(BaseModel):
    recovery_codes: list[str] = Field(description="Shown once. Each works one time.")


class TotpVerifyRequest(_Body):
    """Exactly one of `code` and `recovery_code`."""

    code: TotpCode | None = None
    recovery_code: RecoveryCode | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> TotpVerifyRequest:
        if (self.code is None) == (self.recovery_code is None):
            raise ValueError("give exactly one of code and recovery_code")
        return self


class ReauthenticateRequest(_Body):
    """Exactly one of `password` and `totp_code`."""

    password: Password | None = None
    totp_code: TotpCode | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> ReauthenticateRequest:
        if (self.password is None) == (self.totp_code is None):
            raise ValueError("give exactly one of password and totp_code")
        return self


class ReauthenticateResponse(BaseModel):
    fresh_until: datetime
