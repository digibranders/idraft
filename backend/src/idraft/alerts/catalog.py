"""The rule types of version 1, their parameters and the scope a rule may carry.

Shared by the API (validation on write) and by evaluation (reading what was stored).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Final, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError

type RuleType = Literal[
    "ai_mention_gained", "ai_mention_lost", "ai_competitor_appeared", "rank_drop"
]
type Severity = Literal["info", "warning", "critical"]
type Channel = Literal["ai", "seo"]

POSITIONS_MIN: Final = 1
POSITIONS_MAX: Final = 50
POSITIONS_DEFAULT: Final = 5
# A fall this large is `critical`, a smaller one `warning`.
CRITICAL_DROP: Final = 10
MAX_SCOPE_ITEMS: Final = 50

EngineCode = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")]


class RuleScope(BaseModel):
    """Who a rule watches; empty means everything in the project.

    `group_ids` are the groups of prompts (taxonomy terms) for the AI rule types and the keyword
    groups for `rank_drop`; `engine_codes` are platforms and only narrow the AI rule types.
    """

    model_config = ConfigDict(extra="forbid")

    group_ids: list[UUID] = Field(default_factory=list, max_length=MAX_SCOPE_ITEMS)
    engine_codes: list[EngineCode] = Field(default_factory=list, max_length=MAX_SCOPE_ITEMS)


class RankDropParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: int = Field(default=POSITIONS_DEFAULT, ge=POSITIONS_MIN, le=POSITIONS_MAX)


class NoParams(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class RuleTypeInfo:
    rule_type: RuleType
    channel: Channel
    default_severity: Severity
    params: type[BaseModel]


RULE_TYPES: Final[dict[RuleType, RuleTypeInfo]] = {
    "ai_mention_gained": RuleTypeInfo("ai_mention_gained", "ai", "info", NoParams),
    "ai_mention_lost": RuleTypeInfo("ai_mention_lost", "ai", "warning", NoParams),
    "ai_competitor_appeared": RuleTypeInfo("ai_competitor_appeared", "ai", "warning", NoParams),
    "rank_drop": RuleTypeInfo("rank_drop", "seo", "warning", RankDropParams),
}


def params_schema(rule_type: RuleType) -> dict[str, Any]:
    return RULE_TYPES[rule_type].params.model_json_schema()


def normalized_params(rule_type: RuleType, params: dict[str, Any]) -> dict[str, Any]:
    """The parameters of the rule type with defaults filled in. Raises `ValidationError` for an
    unknown key or a value out of range."""
    return RULE_TYPES[rule_type].params.model_validate(params).model_dump()


def params_problem(error: ValidationError) -> str:
    """One line for the `invalid_params` answer."""
    first = error.errors()[0]
    where = ".".join(str(part) for part in first["loc"]) or "params"
    return f"{where}: {first['msg']}"
