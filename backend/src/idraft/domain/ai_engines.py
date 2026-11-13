"""The AI engines of prompt tracking, slice 1, and the base plan (docs/07-dataforseo-ai-
integration.md sections 1, 3 and 7; spec 2026-11-11 sections 2 to 5).

Pure values. The API checks prompts against them, migration 0018 seeded `ai.engines` and the
price book with the same values (tests/db/test_ai_schema.py keeps the two equal), and the AI
workload reads the endpoints, the length limits and the plan.

Billing does not exist yet, so the base plan is configuration (owner, 2026-11-11). It is enforced
where such limits already live: the prompt limit through
`core.workspace_quotas.max_active_prompts` (default 150 since migration 0018), the runs per week
through the project's schedules (`idraft.ai.schedule`), and the answers per engine through
`ai.project_engines.replicates`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from types import MappingProxyType
from typing import Final, Literal

# Every slice 1 engine is collected through DataForSEO.
PROVIDER_CODE: Final = "dataforseo"
# `core.locations.location_type` of a country.
COUNTRY: Final = "Country"


class EngineCode(StrEnum):
    CHATGPT_WEB = "chatgpt_web"
    GEMINI_WEB = "gemini_web"
    GOOGLE_AI_MODE = "google_ai_mode"


class ObservationClass(StrEnum):
    """`ai.engines.observation_class` and `ai.observations.observation_class` (doc 04 8.1)."""

    CONSUMER_UI = "consumer_ui"
    OFFICIAL_API = "official_api"
    SERP_AI = "serp_ai"


@dataclass(frozen=True, slots=True)
class Engine:
    code: EngineCode
    label: str
    observation_class: ObservationClass
    vendor: str
    exposes_citations: bool
    exposes_fanout: bool
    # The `provider_endpoint` of a task in the ledger and the `endpoint` of its price.
    endpoint: str
    # The longest prompt the endpoint takes (doc 07 sections 3.1 to 3.3). A longer prompt is
    # saved and skipped for this engine.
    max_prompt_chars: int
    # Where the engine runs. Countries only in slice 1: the ChatGPT scraper takes no city (doc 07
    # section 3.1), and the other two follow so that a prompt stands for one market everywhere.
    location_types: frozenset[str]
    # The engine asks from a desktop or a mobile device, a project setting (WP-31). AI Mode only.
    supports_device: bool = False

    def fits(self, text: str) -> bool:
        return len(text) <= self.max_prompt_chars

    def runs_at(self, location_type: str) -> bool:
        return location_type in self.location_types


_COUNTRIES_ONLY: Final = frozenset({COUNTRY})

ENGINES: Final[Mapping[EngineCode, Engine]] = MappingProxyType(
    {
        EngineCode.CHATGPT_WEB: Engine(
            code=EngineCode.CHATGPT_WEB,
            label="ChatGPT",
            observation_class=ObservationClass.CONSUMER_UI,
            vendor="openai",
            exposes_citations=True,
            exposes_fanout=True,
            endpoint="ai_optimization/chat_gpt/llm_scraper",
            max_prompt_chars=2000,
            location_types=_COUNTRIES_ONLY,
        ),
        EngineCode.GEMINI_WEB: Engine(
            code=EngineCode.GEMINI_WEB,
            label="Gemini",
            observation_class=ObservationClass.CONSUMER_UI,
            vendor="google",
            exposes_citations=True,
            exposes_fanout=False,
            endpoint="ai_optimization/gemini/llm_scraper",
            # Doc 07 section 3.2: the same request shape as the ChatGPT scraper.
            max_prompt_chars=2000,
            location_types=_COUNTRIES_ONLY,
        ),
        EngineCode.GOOGLE_AI_MODE: Engine(
            code=EngineCode.GOOGLE_AI_MODE,
            label="Google AI Mode",
            observation_class=ObservationClass.SERP_AI,
            vendor="google",
            exposes_citations=True,
            exposes_fanout=False,
            endpoint="serp/google/ai_mode",
            max_prompt_chars=700,
            location_types=_COUNTRIES_ONLY,
            supports_device=True,
        ),
    }
)

# The longest prompt that can be saved: the longest any engine takes.
PROMPT_TEXT_MAX: Final = max(engine.max_prompt_chars for engine in ENGINES.values())

EngineDevice = Literal["desktop", "mobile"]
DEFAULT_DEVICE: Final[EngineDevice] = "desktop"


def device_of(params: object) -> EngineDevice:
    """The device saved in a project engine's `provider_params`; the default when the params hold
    none, hold anything but `desktop` or `mobile`, or are not an object."""
    device = params.get("device") if isinstance(params, Mapping) else None
    return "mobile" if device == "mobile" else DEFAULT_DEVICE


type Queue = Literal["standard", "priority"]


@dataclass(frozen=True, slots=True)
class BasePlan:
    """What a workspace gets until billing exists."""

    max_prompts: int
    runs_per_week: int
    queue: Queue
    answers_per_engine: int

    @property
    def provider_mode(self) -> str:
        """The plan's queue as `ops.schedules.provider_mode` names it."""
        return f"{self.queue}_queue"


BASE_PLAN: Final = BasePlan(
    max_prompts=150, runs_per_week=2, queue="standard", answers_per_engine=1
)

_WEEKS_PER_YEAR: Final = 52
_CENT: Final = Decimal("0.01")


def monthly_cost(prompts: int, unit_price: Decimal, plan: BasePlan = BASE_PLAN) -> Decimal:
    """What one engine costs for this many prompts in an average month (52 weeks over 12), to
    the cent: doc 07 section 7.2 with the plan's runs and answers."""
    weekly = Decimal(prompts * plan.runs_per_week * plan.answers_per_engine) * unit_price
    return (weekly * _WEEKS_PER_YEAR / 12).quantize(_CENT, rounding=ROUND_HALF_UP)
