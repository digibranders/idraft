"""Types shared by the request and response models of every area."""

from __future__ import annotations

import unicodedata
from typing import Annotated, ClassVar, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    GetJsonSchemaHandler,
    StringConstraints,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, PydanticCustomError

from sightline.providers.email import ADDRESS_MAX, ADDRESS_PATTERN

NAME_MAX = 120
TOKEN_BODY_MAX = 128
IMAGE_URL_MAX = 2048
PROJECT_SCOPE_MAX = 500


def printable(value: str) -> str:
    if any(unicodedata.category(character) in ("Cc", "Cf", "Zl", "Zp") for character in value):
        raise ValueError("must not contain control characters")
    return value


# Normalising can shorten a string (a letter and its accent become one character) and lengthen
# it, so the limit is checked on the result. It is also slow on long runs of accents, so nothing
# longer than this is normalised at all: the longest decomposition of one character is four,
# so no address of ADDRESS_MAX characters is longer than this before it is composed.
_RAW_ADDRESS_MAX = 4 * ADDRESS_MAX


def _one_spelling(value: object) -> object:
    """A composed and a decomposed "é" are different bytes, and the database would keep them as
    two addresses. Runs before the length check of the type."""
    if not isinstance(value, str):
        return value
    # Padding is not part of the address, and must not count against it.
    value = value.strip()
    if len(value) > _RAW_ADDRESS_MAX:
        raise PydanticCustomError(
            "string_too_long",
            "String should have at most {max_length} characters",
            {"max_length": ADDRESS_MAX},
        )
    return unicodedata.normalize("NFC", value)


def _email(value: str) -> str:
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
    # The constraints first, so they are the string's own and report as such; the validator
    # below them still runs before they are checked.
    StringConstraints(strip_whitespace=True, min_length=3, max_length=ADDRESS_MAX),
    BeforeValidator(_one_spelling),
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
# A text filter in a query string (`filter[q]`). A control character or a lone surrogate would
# reach the database as a 500, so it is a 422 here.
QueryText = Annotated[
    str, StringConstraints(min_length=1, max_length=200), AfterValidator(printable)
]


class Body(BaseModel):
    """A request body. Unknown members are refused, so a misspelt field is an error, not ignored."""

    model_config = ConfigDict(extra="forbid")


class UserRef(BaseModel):
    user_id: UUID
    name: str
    email: str


class DomainRef(BaseModel):
    domain_id: int
    host: str
    registrable_domain: str
    category: str | None
    category_source: Literal["seed_list", "rule", "llm", "manual", "tenant_override"] | None


class LocationRef(BaseModel):
    location_id: int
    name: str
    country_iso: str
    location_type: str


# ISO 639-1.
LanguageCode = Annotated[str, StringConstraints(pattern=r"^[a-z]{2}$")]


def _distinct(value: list[UUID] | None) -> list[UUID] | None:
    return None if value is None else sorted(set(value))


# The projects a membership is limited to. null means every project of the workspace.
ProjectScope = Annotated[list[UUID] | None, AfterValidator(_distinct)]


class Patch(Body):
    """The body of a partial update: a field left out is not changed.

    Every field is optional, so in Python every field can be None. Only the ones named in
    `nullable` may be sent as null, to clear a value; the others refuse it (`refuse_null`). The
    API document says the same, so a generated client types them as "string, may be left out"
    and not as "string or null".
    """

    nullable: ClassVar[frozenset[str]] = frozenset()

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        schema = handler.resolve_ref_schema(handler(core_schema))
        for name, described in schema.get("properties", {}).items():
            options = described.get("anyOf")
            if name in cls.nullable or options is None:
                continue
            kept = [option for option in options if option != {"type": "null"}]
            if len(kept) == 1:
                del described["anyOf"]
                described.pop("default", None)
                described.update(kept[0])
        return schema


def refuse_null(value: object) -> object:
    """For a field of a partial update that may be left out and may not be null. Used as a field
    validator, so the error names the field."""
    if value is None:
        raise PydanticCustomError("null_not_allowed", "Cannot be null.")
    return value
