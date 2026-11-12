"""The AI engines and the base plan (docs/07 sections 1, 3 and 7; owner, 2026-11-11)."""

from decimal import Decimal

import pytest

from idraft.domain.ai_engines import (
    BASE_PLAN,
    ENGINES,
    PROMPT_TEXT_MAX,
    BasePlan,
    EngineCode,
    ObservationClass,
    monthly_cost,
)


def test_slice_one_collects_three_engines_through_their_own_endpoints() -> None:
    assert {code: engine.endpoint for code, engine in ENGINES.items()} == {
        EngineCode.CHATGPT_WEB: "ai_optimization/chat_gpt/llm_scraper",
        EngineCode.GEMINI_WEB: "ai_optimization/gemini/llm_scraper",
        EngineCode.GOOGLE_AI_MODE: "serp/google/ai_mode",
    }
    assert all(engine.code is code for code, engine in ENGINES.items())
    assert {code: engine.observation_class for code, engine in ENGINES.items()} == {
        EngineCode.CHATGPT_WEB: ObservationClass.CONSUMER_UI,
        EngineCode.GEMINI_WEB: ObservationClass.CONSUMER_UI,
        EngineCode.GOOGLE_AI_MODE: ObservationClass.SERP_AI,
    }


@pytest.mark.parametrize(
    ("code", "limit"),
    [
        (EngineCode.CHATGPT_WEB, 2000),
        (EngineCode.GEMINI_WEB, 2000),
        (EngineCode.GOOGLE_AI_MODE, 700),
    ],
)
def test_a_prompt_fits_an_engine_up_to_its_limit(code: EngineCode, limit: int) -> None:
    engine = ENGINES[code]
    assert engine.fits("x" * limit)
    assert not engine.fits("x" * (limit + 1))


def test_the_longest_prompt_any_engine_takes_is_the_text_limit() -> None:
    assert PROMPT_TEXT_MAX == 2000


def test_every_engine_runs_in_countries_only() -> None:
    for engine in ENGINES.values():
        assert engine.runs_at("Country")
        assert not engine.runs_at("City")


def test_the_base_plan_is_150_prompts_twice_a_week_on_the_standard_queue() -> None:
    assert (
        BasePlan(max_prompts=150, runs_per_week=2, queue="standard", answers_per_engine=1)
        == BASE_PLAN
    )
    assert BASE_PLAN.provider_mode == "standard_queue"


def test_a_full_base_plan_costs_about_4_68_a_month_on_three_engines() -> None:
    per_engine = monthly_cost(BASE_PLAN.max_prompts, Decimal("0.0012"))
    # 150 prompts x 2 runs a week x 52 / 12 weeks x $0.0012 a task.
    assert per_engine == Decimal("1.56")
    assert per_engine * len(ENGINES) == Decimal("4.68")


def test_the_cost_grows_with_runs_and_answers() -> None:
    plan = BasePlan(max_prompts=10, runs_per_week=1, queue="priority", answers_per_engine=3)
    # 10 x 1 x 3 x 52 / 12 x $0.0024 = $0.312.
    assert monthly_cost(10, Decimal("0.0024"), plan) == Decimal("0.31")
    assert monthly_cost(0, Decimal("0.0012")) == Decimal("0.00")
