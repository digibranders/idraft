"""Types shared by the request and response models of every area."""

from __future__ import annotations

import unicodedata
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from sightline.providers.email import ADDRESS_MAX, ADDRESS_PATTERN

NAME_MAX = 120
TOKEN_BODY_MAX = 128
IMAGE_URL_MAX = 2048
PROJECT_SCOPE_MAX = 500


def printable(value: str) -> str:
    if any(unicodedata.category(character) in ("Cc", "Cf", "Zl", "Zp") for character in value):
        raise ValueError("must not contain control characters")
    return value


def _email(value: str) -> str:
    # One spelling per address: a composed and a decomposed "é" are different bytes, and the
    # database would keep them as two addresses.
    value = unicodedata.normalize("NFC", value)
    # The same shape the email sender accepts, so an address that registers can be written to.
    if not ADDRESS_PATTERN.fullmatch(value):
        raise ValueError("must be an email address")
    return value


# Every string here carries a length constraint. Besides bounding the body, that makes Pydantic
# refuse text UTF-8 cannot carry (a lone surrogate, which JSON allows): the hashers and the
# database would raise on it. tests/api/auth/test_register.py pins this for each type.
Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX),
    AfterValidator(printable),
]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=ADDRESS_MAX),
    AfterValidator(printable),
    AfterValidator(_email),
]
# Shown in an <img>. https only, and nothing a browser would treat as a second attribute.
ImageUrl = Annotated[
    str,
    StringConstraints(max_length=IMAGE_URL_MAX, pattern=r"^https://[^\s<>\"'`\\]+$"),
    AfterValidator(printable),
]
Token = Annotated[str, StringConstraints(min_length=1, max_length=TOKEN_BODY_MAX)]


class Body(BaseModel):
    """A request body. Unknown members are refused, so a misspelt field is an error, not ignored."""

    model_config = ConfigDict(extra="forbid")


class UserRef(BaseModel):
    user_id: UUID
    name: str
    email: str


def _distinct(value: list[UUID] | None) -> list[UUID] | None:
    return None if value is None else sorted(set(value))


# The projects a membership is limited to. null means every project of the workspace.
ProjectScope = Annotated[list[UUID] | None, AfterValidator(_distinct)]


def refuse_null(value: object) -> object:
    """For a field of a partial update that may be left out and may not be null. Used as a field
    validator, so the error names the field."""
    if value is None:
        raise ValueError("cannot be null")
    return value
