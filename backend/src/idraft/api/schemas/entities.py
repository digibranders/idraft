"""Bodies of the entity routes (docs/19-api-specification.md section 3.4).

Entities belong to a workspace; a project gives one a role. Hosts and path prefixes are read with
the canonicalizer's own functions, so what is stored compares directly with canonical URLs, and a
regex alias is compiled by RE2 before it is accepted. `meta.rederivations` and `meta.backfills`
arrive with the work they describe (steps 8 and 5).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Discriminator,
    Field,
    StringConstraints,
    Tag,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from idraft.api.pagination import CursorPageInfo
from idraft.api.schemas.common import (
    BATCH_TAG,
    ONE_TAG,
    Body,
    DomainRef,
    LanguageCode,
    Patch,
    UserRef,
    body_shape,
    printable,
    refuse_null,
)
from idraft.extraction.aliases import (
    InvalidAliasPatternError,
    MatchMethod,
    MatchMode,
    MentionStatus,
    check_pattern,
)
from idraft.extraction.domains import MatchScope, ProjectRole
from idraft.extraction.urls import UrlRejectedError, normalize_host, normalize_path_prefix

EntityType = Literal["brand", "product", "organization", "person", "other"]

ENTITY_NAME_MAX = 200
ALIAS_MAX = 200
DESCRIPTION_MAX = 2000
HINT_MAX = 100
HINTS_MAX = 50
DOMAIN_INPUT_MAX = 2048
PATH_PREFIX_MAX = 512
ALIAS_BATCH_MAX = 200
ENTITY_DOMAINS_MAX = 50
OWN_ENTITY_DOMAINS_MAX = 20
OWN_ENTITY_ALIASES_MAX = 50
ALIAS_TEST_TEXT_MAX = 100 * 1024


def _host(value: str) -> str:
    try:
        normalize_host(value)
    except UrlRejectedError as error:
        raise PydanticCustomError("invalid_domain", "Not a host name or an http(s) URL.") from error
    return value


def _path_prefix(value: str) -> str:
    try:
        return normalize_path_prefix(value)
    except ValueError as error:
        raise PydanticCustomError(
            "invalid_path_prefix", "A path prefix is a path with no query or fragment."
        ) from error


EntityName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=ENTITY_NAME_MAX),
    AfterValidator(printable),
]
Description = Annotated[
    str, StringConstraints(max_length=DESCRIPTION_MAX), AfterValidator(printable)
]
Hint = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=HINT_MAX),
    AfterValidator(printable),
]
Hints = Annotated[list[Hint], Field(max_length=HINTS_MAX)]
AliasText = Annotated[
    str, StringConstraints(min_length=1, max_length=ALIAS_MAX), AfterValidator(printable)
]
# A host (`acme.com`) or a URL whose host is meant (`https://www.acme.com/pricing`).
DomainText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=DOMAIN_INPUT_MAX),
    AfterValidator(printable),
    AfterValidator(_host),
]
PathPrefix = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=PATH_PREFIX_MAX),
    AfterValidator(printable),
    AfterValidator(_path_prefix),
]
# A series colour of the design system, `--chart-1` to `--chart-6`, so it follows the theme.
ColorIndex = Annotated[int, Field(ge=1, le=6, strict=True)]


class EntityRef(BaseModel):
    entity_id: UUID
    canonical_name: str
    entity_type: EntityType
    role: ProjectRole | None = Field(description="The role in the project asked about, if any.")
    color_index: int | None = Field(
        description="`--chart-1` to `--chart-6`; null lets the client choose."
    )


# Aliases.


def alias_shape(alias: str, match_mode: MatchMode, *, case_sensitive: bool) -> str:
    """Spaces around a word alias are a typo; around a pattern they can mean something. A
    pattern is compiled with its own case setting, which changes the program's size. The
    alias routes call this again on the result of a partial change."""
    if match_mode == "regex":
        try:
            check_pattern(alias, case_sensitive=case_sensitive)
        except InvalidAliasPatternError as error:
            raise PydanticCustomError(
                "invalid_regex",
                "RE2 cannot run this pattern: no backreferences or lookaround, and not too "
                "large (doc 13 stage 4).",
            ) from error
        return alias
    alias = alias.strip()
    if not alias:
        raise PydanticCustomError("string_too_short", "An alias has at least one character.")
    return alias


class AliasInput(Body):
    alias: AliasText
    match_mode: MatchMode = "word_boundary"
    case_sensitive: bool = False
    language_code: LanguageCode | None = None
    is_negative: bool = Field(default=False, description="A phrase that must not count.")
    requires_context: bool = Field(
        default=False, description="Counts only near a disambiguation hint."
    )

    @model_validator(mode="after")
    def _shaped(self) -> AliasInput:
        self.alias = alias_shape(self.alias, self.match_mode, case_sensitive=self.case_sensitive)
        return self


class AliasBatch(Body):
    items: Annotated[list[AliasInput], Field(min_length=1, max_length=ALIAS_BATCH_MAX)]


AliasBody = Annotated[
    Annotated[AliasInput, Tag(ONE_TAG)] | Annotated[AliasBatch, Tag(BATCH_TAG)],
    Discriminator(body_shape),
]


class AliasUpdate(Patch):
    """At least one member. `language_code: null` removes it; the others cannot be null."""

    alias: AliasText | None = None
    match_mode: MatchMode | None = None
    case_sensitive: bool | None = None
    language_code: LanguageCode | None = None
    is_negative: bool | None = None
    requires_context: bool | None = None

    nullable = frozenset({"language_code"})
    _not_null = field_validator(
        "alias", "match_mode", "case_sensitive", "is_negative", "requires_context"
    )(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> AliasUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class Alias(BaseModel):
    alias_id: UUID
    entity_id: UUID
    alias: str
    match_mode: MatchMode
    case_sensitive: bool
    language_code: str | None
    is_negative: bool
    requires_context: bool
    created_by: UserRef | None
    created_at: datetime


class AliasList(BaseModel):
    data: list[Alias]


class AliasResponse(BaseModel):
    data: Alias


# Entity domains.


class DomainInput(Body):
    domain: DomainText
    match_scope: MatchScope = "registrable"
    path_prefix: PathPrefix | None = Field(
        default=None, description="Given exactly when `match_scope` is `path_prefix`."
    )

    @model_validator(mode="after")
    def _scoped(self) -> DomainInput:
        if (self.match_scope == "path_prefix") != (self.path_prefix is not None):
            raise PydanticCustomError(
                "path_prefix_mismatch",
                "Give `path_prefix` exactly when `match_scope` is `path_prefix`.",
            )
        if self.match_scope == "registrable":
            refuse_public_suffix(self.domain)
        return self


def refuse_public_suffix(domain: str) -> None:
    """`co.uk` or `github.io` as a registrable domain would claim every site under it."""
    host = normalize_host(domain)
    if not host.is_ip and host.registrable_domain == host.public_suffix:
        raise PydanticCustomError(
            "domain_is_public_suffix",
            "A public suffix is shared by many sites; name a host under it.",
        )


class EntityDomain(BaseModel):
    entity_domain_id: UUID
    entity_id: UUID
    domain: DomainRef
    match_scope: MatchScope
    path_prefix: str | None


class EntityDomainList(BaseModel):
    data: list[EntityDomain]


EntityDomainWarning = Literal["domain_role_conflict"]


class EntityDomainMeta(BaseModel):
    warnings: list[EntityDomainWarning] = Field(
        description=(
            "`domain_role_conflict`: another entity in a project that has this one claims the "
            "same domain at the same specificity (doc 13 stage 2)."
        )
    )


class EntityDomainCreated(BaseModel):
    data: EntityDomain
    meta: EntityDomainMeta


# Entities.


class EntityCreate(Body):
    entity_type: EntityType
    canonical_name: EntityName
    parent_entity_id: UUID | None = None
    description: Description | None = None
    is_ambiguous: bool = Field(
        default=False, description="The name is also a common word (`Notion`, `Monday`)."
    )
    disambiguation_hints: Hints = Field(
        default_factory=list, description="Words that confirm the entity nearby (`crm`)."
    )
    aliases: Annotated[list[AliasInput], Field(max_length=ALIAS_BATCH_MAX)] = Field(
        default_factory=list
    )
    domains: Annotated[list[DomainInput], Field(max_length=ENTITY_DOMAINS_MAX)] = Field(
        default_factory=list
    )


class EntityUpdate(Patch):
    """At least one member. `parent_entity_id` and `description` may be null to remove them."""

    canonical_name: EntityName | None = None
    entity_type: EntityType | None = None
    parent_entity_id: UUID | None = None
    description: Description | None = None
    is_ambiguous: bool | None = None
    disambiguation_hints: Hints | None = None

    nullable = frozenset({"parent_entity_id", "description"})
    _not_null = field_validator(
        "canonical_name", "entity_type", "is_ambiguous", "disambiguation_hints"
    )(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> EntityUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class Entity(BaseModel):
    entity_id: UUID
    entity_type: EntityType
    canonical_name: str
    parent_entity_id: UUID | None
    description: str | None
    is_ambiguous: bool
    disambiguation_hints: list[str]
    alias_count: int
    domains: list[EntityDomain]
    created_at: datetime
    updated_at: datetime


class EntityProjectRole(BaseModel):
    project_id: UUID
    role: ProjectRole
    is_primary: bool
    removed_at: datetime | None


class EntityDetail(Entity):
    aliases: list[Alias]
    projects: list[EntityProjectRole] = Field(
        description="Every project that has given the entity a role, removed roles included."
    )


class EntityResponse(BaseModel):
    data: Entity


class EntityDetailResponse(BaseModel):
    data: EntityDetail


class EntityPage(BaseModel):
    data: list[Entity]
    page: CursorPageInfo


# Project roles.


PRIMARY_NEEDS_OWN = "Only an `own` entity is primary."


class ProjectEntityCreate(Body):
    entity_id: UUID
    role: ProjectRole
    is_primary: bool = Field(
        default=False,
        description="Only for `own`; one per project, so the current primary one stops being "
        "primary.",
    )
    track_seo: bool = True
    track_ai: bool = True
    color_index: ColorIndex | None = None

    @field_validator("is_primary")
    @classmethod
    def _primary_is_own(cls, is_primary: bool, info: ValidationInfo) -> bool:
        # `role` is validated first; when it failed, its own error is the one to report.
        if is_primary and info.data.get("role", "own") != "own":
            raise PydanticCustomError("primary_needs_own", PRIMARY_NEEDS_OWN)
        return is_primary


class ProjectEntityUpdate(Patch):
    """At least one member. `color_index: null` removes it; the others cannot be null."""

    role: ProjectRole | None = None
    is_primary: bool | None = None
    track_seo: bool | None = None
    track_ai: bool | None = None
    color_index: ColorIndex | None = None

    nullable = frozenset({"color_index"})
    _not_null = field_validator("role", "is_primary", "track_seo", "track_ai")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> ProjectEntityUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class ProjectEntity(BaseModel):
    project_id: UUID
    entity: EntityRef
    role: ProjectRole
    is_primary: bool
    track_seo: bool
    track_ai: bool
    color_index: int | None
    added_at: datetime
    removed_at: datetime | None
    alias_count: int
    domains: list[EntityDomain]


class ProjectEntityList(BaseModel):
    data: list[ProjectEntity]


class ProjectEntityResponse(BaseModel):
    data: ProjectEntity


class ProjectDomain(BaseModel):
    entity: EntityRef
    domain: DomainRef
    match_scope: MatchScope
    path_prefix: str | None


class ProjectDomainList(BaseModel):
    data: list[ProjectDomain]


# The own entity a new project can be created with.


def _registrable_rule(domain: str) -> str:
    refuse_public_suffix(domain)
    return domain


def _word_alias(alias: str) -> str:
    return alias_shape(alias, "word_boundary", case_sensitive=False)


# Each item is checked like the alias and domain bodies it becomes, so an error names its index.
OwnDomain = Annotated[DomainText, AfterValidator(_registrable_rule)]
OwnAlias = Annotated[AliasText, AfterValidator(_word_alias)]


class OwnEntityInput(Body):
    canonical_name: EntityName
    domains: Annotated[list[OwnDomain], Field(max_length=OWN_ENTITY_DOMAINS_MAX)] = Field(
        default_factory=list, description="Hosts or URLs, each matched by registrable domain."
    )
    aliases: Annotated[list[OwnAlias], Field(max_length=OWN_ENTITY_ALIASES_MAX)] = Field(
        default_factory=list,
        description="Word aliases that ignore case, trimmed; repeats in any case are one alias.",
    )


# The alias test.


class AliasTestRequest(Body):
    """Exactly one of `text` and `markdown`, at most 100 KB as UTF-8 (`413 payload_too_large`
    beyond). Markdown is matched as its source text for now; an observation id is taken once
    observations exist (step 8)."""

    text: str | None = None
    markdown: str | None = None

    @model_validator(mode="after")
    def _one_of(self) -> AliasTestRequest:
        if (self.text is None) == (self.markdown is None):
            raise PydanticCustomError("one_of", "Give exactly one of `text` and `markdown`.")
        return self


class AliasTestSpan(BaseModel):
    start: int = Field(description="Offset into the text sent, in UTF-16 code units.")
    end: int
    alias_id: UUID | None = Field(
        description="The stored alias that matched; None for the canonical name (`alias_name`) "
        "and a domain-shaped alias (`alias_domain`)."
    )
    match_method: MatchMethod
    score: float
    status: MentionStatus = Field(description="This span's own status; see doc 13 stage 5.")
    via_entity_id: UUID | None = Field(
        description="For `via_product`: the product whose mention counts for this entity."
    )


class AliasTestMention(BaseModel):
    entity: EntityRef
    spans: list[AliasTestSpan]
    confidence: float
    status: MentionStatus


class AliasTestNegative(BaseModel):
    start: int
    end: int
    alias_id: UUID


class AliasTestResult(BaseModel):
    mentions: list[AliasTestMention]
    negatives_applied: list[AliasTestNegative]
    skipped_alias_ids: list[UUID] = Field(
        description="Stored patterns the matcher cannot run (doc 13 stage 4), left out."
    )


class AliasTestResponse(BaseModel):
    data: AliasTestResult
