"""Request and response models of layouts (WP-11 layouts-api; contract C12a, docs/19 section
3.11.5c and the layout spec sections 4, 6 and 9)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from idraft.api.schemas.common import Body, printable
from idraft.domain.ai_engines import EngineCode

NUMBERS_MAX: Final = 6
CARDS_MAX: Final = 12

LayoutScreen = Literal[
    "overview",
    "ai_overview",
    "rankings",
    "prompts",
    "citations",
    "sources",
    "pages",
    "inspector.keyword",
    "inspector.prompt",
    "inspector.page",
    "inspector.citation",
    # The topic drawer (owner decision D-16).
    "inspector.topic",
]
CardWidth = Literal["third", "half", "two_thirds", "full"]
# A plain token (layout spec section 6.3 rule 6).
ItemId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
# A card type or metric key of the catalog; WP-11 checks it against the generated catalog JSON
# for the screen (owner decision D-10).
CatalogKey = Annotated[
    str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
]
OptionKey = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")]
OptionValue = Annotated[str, StringConstraints(max_length=256), AfterValidator(printable)]


class NumberItem(Body):
    id: ItemId
    metric: CatalogKey = Field(description="A metric registry key (docs/16 section 2.1).")
    engine: EngineCode | None = Field(
        default=None, description="Required when `metric` is an AI metric."
    )


class CardItem(Body):
    id: ItemId
    type: CatalogKey
    width: CardWidth | None = Field(
        default=None, description="Dashboard screens only; left out: the type's default."
    )
    options: dict[OptionKey, OptionValue] | None = Field(
        default=None,
        description="A flat object of strings; each card type checks its own in the web app.",
    )


class LayoutDocument(Body):
    """The numbers and cards of one screen, in order: a full snapshot, at most 16 KB."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: Literal[1] = Field(
        alias="schema", serialization_alias="schema", description="The document format version."
    )
    numbers: Annotated[list[NumberItem], Field(max_length=NUMBERS_MAX)] | None = None
    cards: Annotated[list[CardItem], Field(max_length=CARDS_MAX)] | None = None


class LayoutEditor(BaseModel):
    user_id: UUID
    name: str


class ResolvedLayout(BaseModel):
    screen: LayoutScreen
    source: Literal["personal", "team", "builtin"]
    document: LayoutDocument | None = Field(
        description="Null when `source` is `builtin`: the web app holds the built-in default."
    )
    team_default_exists: bool
    updated_at: datetime | None
    updated_by: LayoutEditor | None


class ResolvedLayoutResponse(BaseModel):
    data: ResolvedLayout
