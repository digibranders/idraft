"""AI answer tasks: the ChatGPT scraper, the Gemini scraper and Google AI Mode
(docs/07-dataforseo-ai-integration.md sections 2 to 4; spike S-04, docs/spikes/S-04.md).

The workload says what to ask; this module turns that into a `task_post` task. The three are all
`task_post` then `task_get/advanced`, so they differ in their paths and in two fields AI Mode
takes: the device and its operating system, a Windows desktop as the spike sent them. ChatGPT is
asked as it answers: `force_web_search` is never sent (doc 07 section 4.2, settled by S-04).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import timedelta
from types import MappingProxyType
from typing import Final, Literal

from pydantic import Field, field_validator

from idraft.domain.ai_engines import ENGINES, PROMPT_TEXT_MAX
from idraft.providers.contract import CanonicalRequest, Contract
from idraft.providers.dataforseo.endpoint import TaskBuilder, TaskEndpoint

# The ledger's names for the endpoints, and the price book's.
CHATGPT_SCRAPER: Final = "ai_optimization/chat_gpt/llm_scraper"
GEMINI_SCRAPER: Final = "ai_optimization/gemini/llm_scraper"
AI_MODE: Final = "serp/google/ai_mode"
# Kept on every observation (`adapter_version`): a change to what is asked is a new version.
ADAPTER_VERSION: Final = 1
# The endpoint each engine (`ai.engines.code`) is asked through, and the longest prompt each
# endpoint takes in characters (spec section 5): the engine facts of `domain.ai_engines`, so the
# prompt lint of the API and the planner read the same numbers.
ENGINE_ENDPOINTS: Final[Mapping[str, str]] = MappingProxyType(
    {code.value: engine.endpoint for code, engine in ENGINES.items()}
)
PROMPT_MAX: Final[Mapping[str, int]] = MappingProxyType(
    {engine.endpoint: engine.max_prompt_chars for engine in ENGINES.values()}
)


class AiAnswerParams(Contract):
    prompt: str = Field(min_length=1, max_length=PROMPT_TEXT_MAX)
    location_code: int = Field(ge=1)
    # ISO 639-1, with a region or script where DataForSEO has one, as for SERP tasks.
    language_code: str = Field(pattern=r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")
    # The priority queue costs twice as much; only a schedule that chose it uses it.
    queue: Literal["standard", "priority"] = "standard"

    @field_validator("prompt")
    @classmethod
    def _as_saved(cls, prompt: str) -> str:
        if prompt != prompt.strip() or "\x00" in prompt:
            raise ValueError("a prompt is trimmed text")
        return prompt


def _params(request: CanonicalRequest) -> AiAnswerParams:
    params = request.params
    if not isinstance(params, AiAnswerParams):
        raise TypeError(f"not an AI answer request: {type(params).__name__}")
    return params


def scraper_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    """A ChatGPT or Gemini scraper task: the prompt as saved, sent as `keyword`."""
    params = _params(request)
    return {
        "keyword": params.prompt,
        "location_code": params.location_code,
        "language_code": params.language_code,
        "priority": 2 if params.queue == "priority" else 1,
        "tag": tag,
    }


def ai_mode_body(request: CanonicalRequest, tag: str) -> dict[str, object]:
    """An AI Mode task: a scraper task on a Windows desktop, at most 700 characters."""
    prompt = _params(request).prompt
    if len(prompt) > PROMPT_MAX[AI_MODE]:
        raise ValueError(f"AI Mode takes at most {PROMPT_MAX[AI_MODE]} characters")
    return {**scraper_body(request, tag), "device": "desktop", "os": "windows"}


def _endpoint(base: str, build: TaskBuilder, slug: str, id_list: str) -> TaskEndpoint:
    return TaskEndpoint(
        base=base,
        result="task_get/advanced",
        build=build,
        # Standard tasks answered within minutes in S-04; one with no result after 72 hours is
        # given up, as for SERP tasks.
        result_lifetime=timedelta(hours=72),
        payload_slug=slug,
        id_list=id_list,
    )


ENDPOINTS: Final[Mapping[str, TaskEndpoint]] = MappingProxyType(
    {
        CHATGPT_SCRAPER: _endpoint(
            "/v3/ai_optimization/chat_gpt/llm_scraper",
            scraper_body,
            "ai_chat_gpt_llm_scraper_advanced",
            "/v3/ai_optimization/id_list",
        ),
        GEMINI_SCRAPER: _endpoint(
            "/v3/ai_optimization/gemini/llm_scraper",
            scraper_body,
            "ai_gemini_llm_scraper_advanced",
            "/v3/ai_optimization/id_list",
        ),
        AI_MODE: _endpoint(
            "/v3/serp/google/ai_mode",
            ai_mode_body,
            "serp_google_ai_mode_advanced",
            "/v3/serp/id_list",
        ),
    }
)
