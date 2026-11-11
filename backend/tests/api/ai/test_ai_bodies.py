"""The request rules of the prompt and engine bodies (docs/19 sections 3.7.1 and 3.7.4), which
hold before any route reads them."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from idraft.api.schemas.ai import (
    EngineUpdate,
    PromptBulkCreate,
    PromptCreate,
    PromptLintRequest,
    PromptPatch,
)
from idraft.domain.ai_engines import PROMPT_TEXT_MAX

ONE = {"text": "Which CRM suits a startup?", "language_code": "en", "country_iso": "US"}


def _codes(model: type[BaseModel], body: dict[str, Any]) -> list[str]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(body)
    return [error["type"] for error in caught.value.errors()]


@pytest.mark.parametrize(
    ("model", "body", "code"),
    [
        (PromptCreate, {**ONE, "text": "x" * (PROMPT_TEXT_MAX + 1)}, "prompt_too_long"),
        (PromptCreate, {**ONE, "text": "x" * (4 * PROMPT_TEXT_MAX + 1)}, "prompt_too_long"),
        (PromptCreate, {**ONE, "text": "   "}, "string_too_short"),
        (PromptCreate, {**ONE, "text": "one\ntwo"}, "value_error"),
        (PromptCreate, {**ONE, "language_code": "eng"}, "string_pattern_mismatch"),
        (PromptCreate, {**ONE, "country_iso": "us"}, "string_pattern_mismatch"),
        (PromptCreate, {"text": "x?", "language_code": "en"}, "missing"),
        (PromptCreate, {**ONE, "importance": 6}, "less_than_equal"),
        (PromptCreate, {**ONE, "panel_ids": []}, "extra_forbidden"),
        (PromptCreate, {**ONE, "term_ids": ["not-a-uuid"]}, "uuid_parsing"),
        (PromptBulkCreate, {"items": []}, "too_short"),
        (PromptBulkCreate, {"items": [ONE], "on_duplicate": "merge"}, "literal_error"),
        (PromptPatch, {"text": "Another?"}, "immutable_field"),
        (PromptPatch, {"country_iso": "DE"}, "immutable_field"),
        (PromptPatch, {"language_code": "de"}, "immutable_field"),
        (PromptPatch, {"importance": None}, "null_not_allowed"),
        (PromptPatch, {}, "value_error"),
        (PromptLintRequest, {"texts": []}, "too_short"),
        (PromptLintRequest, {"texts": ["x?"], "engine_codes": ["perplexity_web"]}, "enum"),
        (EngineUpdate, {"location_ids": []}, "too_short"),
        (EngineUpdate, {"location_ids": [0]}, "greater_than_equal"),
        (EngineUpdate, {"location_ids": [2840], "replicates": 3}, "extra_forbidden"),
        (EngineUpdate, {"location_ids": [2840], "provider_code": "x"}, "extra_forbidden"),
    ],
)
def test_a_body_breaking_a_rule_is_refused_with_its_code(
    model: type[BaseModel], body: dict[str, Any], code: str
) -> None:
    assert code in _codes(model, body)


def test_a_prompt_is_stored_trimmed_and_composed() -> None:
    # Written as escapes: an editor would otherwise compose the decomposed input again
    body = PromptCreate.model_validate({**ONE, "text": "  Café near me?  "})
    assert body.text == "Café near me?"
    assert (body.intent, body.funnel_stage, body.prompt_type, body.importance) == (
        "unknown",
        "unknown",
        "question",
        3,
    )


def test_a_text_that_composes_under_the_limit_fits() -> None:
    # Decomposed (letter plus combining accent): twice the limit raw, exactly the limit composed
    body = PromptCreate.model_validate({**ONE, "text": "é" * PROMPT_TEXT_MAX})
    assert len(body.text) == PROMPT_TEXT_MAX


def test_the_lint_takes_a_text_too_long_to_save() -> None:
    body = PromptLintRequest.model_validate({"texts": ["x" * 2500]})
    assert body.texts == ["x" * 2500]
    assert body.engine_codes is None


def test_an_engine_is_turned_on_unless_the_body_says_off() -> None:
    assert EngineUpdate.model_validate({"location_ids": [2840]}).is_enabled
