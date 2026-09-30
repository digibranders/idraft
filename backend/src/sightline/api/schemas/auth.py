"""Bodies of the auth and current-user routes (docs/19-api-specification.md section 3.1)."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from sightline.api.permissions import Role

NAME_MAX = 120
EMAIL_MAX = 254
# Far above the policy limit: the policy answers with a reason, this only bounds the body.
PASSWORD_BODY_MAX = 1024
TOKEN_BODY_MAX = 128
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
    AfterValidator(_email),
]
Password = Annotated[str, StringConstraints(max_length=PASSWORD_BODY_MAX)]
Token = Annotated[
    str,
    StringConstraints(min_length=1, max_length=TOKEN_BODY_MAX),
]


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
