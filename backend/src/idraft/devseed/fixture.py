"""The Eventus Security fixture (`fixtures/ai-prompts/eventus-security.json`), read strictly.

The seed uses the static parts only: the project, the brand and its competitors, the engines, the
topics and the prompts. The prompts' `profile` and the top-level `model_change`, `sources`,
`competitor_pages` and `phrases` exist to generate the web mocks' answers; they are accepted as
JSON and never read. Any other key, a missing key or a value of the wrong type fails the load
(`FixtureError`), so a changed fixture never seeds half of itself.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Annotated, Final, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    ValidationError,
    model_validator,
)

from idraft.ai.text import normalize
from idraft.api.schemas.ai import CountryIso, Importance, PromptType
from idraft.api.schemas.keywords import FunnelStage, Intent
from idraft.domain.ai_engines import PROMPT_TEXT_MAX, EngineCode

# backend/src/idraft/devseed/fixture.py: parents[4] is the repository root.
DEFAULT_FIXTURE: Final = (
    Path(__file__).resolve().parents[4] / "fixtures" / "ai-prompts" / "eventus-security.json"
)

Name = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Key = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9]*$", max_length=50)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=100)]
Host = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", max_length=253)]
PromptKey = Annotated[str, StringConstraints(pattern=r"^p[0-9]{2}$")]
PromptText = Annotated[str, StringConstraints(min_length=1, max_length=PROMPT_TEXT_MAX)]


class FixtureError(Exception):
    """The fixture could not be read, or is not the shape the seed expects. The message names the
    places that are wrong."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ProjectPart(_Strict):
    name: Name
    slug: Slug
    host: Host
    language_code: Literal["en"]
    default_country: CountryIso
    timezone: Name


class EntityPart(_Strict):
    key: Key
    name: Name
    aliases: list[Name] = Field(min_length=1)
    domains: list[Host] = Field(min_length=1)


class CompetitorPart(EntityPart):
    ambiguous: bool = False
    disambiguation_hints: list[Name] = Field(default_factory=list)

    @model_validator(mode="after")
    def _hinted(self) -> Self:
        if self.ambiguous != bool(self.disambiguation_hints):
            raise ValueError("disambiguation_hints are given exactly when ambiguous is true")
        return self


class EnginePart(_Strict):
    engine_code: EngineCode
    countries: list[CountryIso] = Field(min_length=1)
    # The model the mocks report. Not seeded: a provider reports the model with each answer.
    model: Name


class TopicChild(_Strict):
    slug: Slug
    name: Name


class TopicParent(_Strict):
    slug: Slug
    name: Name
    children: list[TopicChild] = Field(min_length=1)


class PromptPart(_Strict):
    key: PromptKey
    text: PromptText
    country: CountryIso
    intent: Intent
    funnel_stage: FunnelStage
    prompt_type: PromptType
    importance: Importance
    branded: bool
    topics: list[Slug] = Field(min_length=1, max_length=2)
    # Drives the mocks' answers only; never read by the seed.
    profile: dict[str, JsonValue]


def _repeats(what: str, values: Iterable[str]) -> list[str]:
    return [
        f"repeated {what} {value}" for value, count in sorted(Counter(values).items()) if count > 1
    ]


def topic_paths(topics: Sequence[TopicParent]) -> dict[str, str]:
    """Each topic's slug and its path in the vocabulary: `parent` or `parent/child`."""
    paths = {parent.slug: parent.slug for parent in topics}
    paths.update(
        {
            child.slug: f"{parent.slug}/{child.slug}"
            for parent in topics
            for child in parent.children
        }
    )
    return paths


class EventusFixture(_Strict):
    schema_version: Literal[1]
    note: str
    project: ProjectPart
    brand: EntityPart
    competitors: list[CompetitorPart] = Field(min_length=1)
    engines: list[EnginePart] = Field(min_length=1)
    topics: list[TopicParent] = Field(min_length=1)
    prompts: list[PromptPart] = Field(min_length=1)
    # These make the mocks' answers and are never seeded.
    model_change: JsonValue = None
    sources: JsonValue = None
    competitor_pages: JsonValue = None
    phrases: JsonValue = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        entities = [self.brand, *self.competitors]
        slugs = [parent.slug for parent in self.topics] + [
            child.slug for parent in self.topics for child in parent.children
        ]
        problems = [
            *_repeats("entity key", (entity.key for entity in entities)),
            *_repeats("entity name", (entity.name.casefold() for entity in entities)),
            *_repeats("entity domain", (host for entity in entities for host in entity.domains)),
            *_repeats("engine", (engine.engine_code.value for engine in self.engines)),
            *_repeats("topic slug", slugs),
            *_repeats("prompt key", (prompt.key for prompt in self.prompts)),
            *_repeats("prompt text", (normalize(prompt.text) for prompt in self.prompts)),
        ]
        known = set(slugs)
        for prompt in self.prompts:
            unknown = sorted(set(prompt.topics) - known)
            if unknown:
                problems.append(f"prompt {prompt.key} names unknown topics {', '.join(unknown)}")
            for engine in self.engines:
                if prompt.country not in engine.countries:
                    problems.append(
                        f"prompt {prompt.key} is in {prompt.country}, which "
                        f"{engine.engine_code.value} does not run in"
                    )
        if problems:
            raise ValueError("; ".join(problems))
        return self


def load_fixture(path: Path) -> EventusFixture:
    """The fixture at `path`, validated. Raises `FixtureError`."""
    try:
        content = path.read_bytes()
    except OSError as error:
        reason = error.strerror or type(error).__name__
        raise FixtureError(f"The fixture {path} could not be read ({reason}).") from None
    try:
        return EventusFixture.model_validate_json(content)
    except ValidationError as error:
        places = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'fixture'}: {item['msg']}"
            for item in error.errors(include_input=False, include_url=False)
        )
        raise FixtureError(f"The fixture {path} is not valid: {places}") from None
