"""Bodies of the taxonomy routes (docs/19-api-specification.md section 3.5).

Vocabularies are workspace-wide or belong to one project; terms form a tree under each, with the
path of slugs from the root stored on every term. Term assignments, and the keyword and prompt
counts on a term, arrive with keywords (step 5) and prompts (step 8).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from sightline.api.pagination import OffsetPageInfo
from sightline.api.schemas.common import Body, Patch, printable, refuse_null

VocabularyKind = Literal[
    "topic", "cluster", "product", "service", "market", "campaign", "persona", "tag", "custom"
]
TermSource = Literal["manual", "import", "auto_cluster", "ai_suggestion"]

VOCABULARY_NAME_MAX = 100
TERM_NAME_MAX = 200
SLUG_MAX = 100
TERM_PATH_MAX = 1000
TERM_DESCRIPTION_MAX = 2000
TERM_BATCH_MAX = 500
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"

VocabularyName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=VOCABULARY_NAME_MAX),
    AfterValidator(printable),
]
TermName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=TERM_NAME_MAX),
    AfterValidator(printable),
]
Slug = Annotated[str, StringConstraints(max_length=SLUG_MAX, pattern=SLUG_PATTERN)]
TermDescription = Annotated[
    str, StringConstraints(max_length=TERM_DESCRIPTION_MAX), AfterValidator(printable)
]


def _term_path(value: str) -> str:
    """`CRM/CRM for Startups`: names from the root down, each one trimmed and none empty."""
    names = [name.strip() for name in value.split("/")]
    if any(not name or len(name) > TERM_NAME_MAX for name in names):
        raise PydanticCustomError(
            "invalid_term_path", "A path is term names separated by `/`, none of them empty."
        )
    return "/".join(names)


TermPath = Annotated[
    str,
    StringConstraints(min_length=1, max_length=TERM_PATH_MAX),
    AfterValidator(printable),
    AfterValidator(_term_path),
]


class VocabularyCreate(Body):
    kind: VocabularyKind
    name: VocabularyName
    project_id: UUID | None = Field(default=None, description="null: workspace-wide.")
    is_hierarchical: bool = False
    is_single_valued: bool = Field(
        default=False, description="A subject has at most one term of this vocabulary."
    )


class VocabularyUpdate(Patch):
    """At least one member; neither can be null."""

    name: VocabularyName | None = None
    is_single_valued: bool | None = None

    _not_null = field_validator("name", "is_single_valued")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> VocabularyUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class Vocabulary(BaseModel):
    vocabulary_id: UUID
    project_id: UUID | None
    kind: VocabularyKind
    name: str
    is_hierarchical: bool
    is_single_valued: bool
    term_count: int


class VocabularyResponse(BaseModel):
    data: Vocabulary


class VocabularyPage(BaseModel):
    data: list[Vocabulary]
    page: OffsetPageInfo


class TermInput(Body):
    """One term: a `name` under `parent_id` (a root when left out), or a `path` of names from
    the root (`CRM/CRM for Startups`), which creates any missing parent. `slug` is made from the
    name when left out; with `path` it is the last term's."""

    name: TermName | None = None
    parent_id: UUID | None = None
    path: TermPath | None = None
    slug: Slug | None = None
    description: TermDescription | None = None

    @model_validator(mode="after")
    def _named_once(self) -> TermInput:
        if (self.name is None) == (self.path is None):
            raise PydanticCustomError("one_of", "Give exactly one of `name` and `path`.")
        if self.path is not None and self.parent_id is not None:
            raise PydanticCustomError(
                "one_of", "A `path` starts at the root, so it takes no `parent_id`."
            )
        return self


class TermBatch(Body):
    items: Annotated[list[TermInput], Field(min_length=1, max_length=TERM_BATCH_MAX)]


class TermUpdate(Patch):
    """At least one member. `parent_id: null` moves the term to the root, which recomputes the
    path of its whole subtree; `description: null` removes it."""

    name: TermName | None = None
    slug: Slug | None = None
    parent_id: UUID | None = None
    description: TermDescription | None = None

    nullable = frozenset({"parent_id", "description"})
    _not_null = field_validator("name", "slug")(refuse_null)

    @model_validator(mode="after")
    def _says_something(self) -> TermUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        return self


class Term(BaseModel):
    term_id: UUID
    vocabulary_id: UUID
    parent_id: UUID | None
    name: str
    slug: str
    path: str = Field(description="Slugs from the root down, joined by `/`.")
    source: TermSource
    description: str | None
    created_at: datetime


class TermNode(Term):
    children: list[TermNode] = Field(description="Empty in the flat format.")


class TermList(BaseModel):
    data: list[Term]


class TermTree(BaseModel):
    data: list[TermNode]


class TermResponse(BaseModel):
    data: Term
