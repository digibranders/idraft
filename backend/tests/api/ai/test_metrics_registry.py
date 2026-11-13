"""The registry and the mapping of the Overview (contract C8, docs/ai-visibility/contracts/
c8-metrics.md): a summary cell becomes a value with its counts, the tiles of an engine come in the
order of the note, an average of engines is the equal-weight mean of the engines that have a value
and needs two, and `previous` has three states. Pure: nothing here reads a database."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from idraft.api.ai import metrics
from idraft.api.ai.metrics import Frame
from idraft.api.schemas.ai import (
    NOT_ASKED,
    EngineCells,
    EngineDetailCells,
    EngineSummary,
    MetricCell,
    OutcomeCells,
    Pooled,
)
from idraft.api.schemas.ai_metrics import AiFilters, AiMetricValue
from idraft.api.schemas.metrics import MetricWindow

NOTE = Path(__file__).parents[4] / "docs" / "ai-visibility" / "contracts" / "c8-metrics.md"
CHATGPT, GEMINI = "chatgpt_web", "gemini_web"
OUTCOMES = (
    "ai.outcome_mix.mentioned_and_cited",
    "ai.outcome_mix.mentioned_only",
    "ai.outcome_mix.cited_only",
    "ai.outcome_mix.neither",
)
# The tiles of an engine in the order of the note (without the two fan-out tiles).
TILES = [
    "ai.valid_answers",
    "ai.mention_rate",
    "ai.citation_rate",
    "ai.mention_and_citation_rate",
    *OUTCOMES,
    "ai.recommendation_rate",
    "ai.share_of_voice",
    "ai.citation_share",
    "ai.citation_rate_given_citations",
    "ai.first_mention_rate",
]
FANOUT = ["ai.fanout_presence_rate", "ai.fanout_mean_queries"]
FRAME = Frame(
    window=MetricWindow(from_="2026-10-17", to="2026-11-13", timezone="Europe/Berlin"),
    filters=AiFilters(include_branded=False, branded_only=False, country_iso=None, term_id=None),
)


def cell(
    numerator: float, denominator: int, n_observations: int, pooled: tuple[int, int] | None = None
) -> MetricCell:
    return MetricCell(
        value=None if denominator == 0 else numerator / denominator,
        numerator=numerator,
        denominator=denominator,
        n_observations=n_observations,
        pooled=None if pooled is None else Pooled(successes=pooled[0], trials=pooled[1]),
    )


def engine(
    code: str, *, previous: EngineCells | object | None = NOT_ASKED, fanout: bool = False
) -> EngineSummary:
    """The total row of an engine over 8 answers (7 valid) of 3 prompts: Mentioned 1.4 of 3."""
    mentioned = cell(1.4, 3, 8, (3, 7))
    return EngineSummary.model_validate(
        {
            "engine_code": code,
            "mentioned": mentioned,
            "cited": cell(1.4, 3, 8, (3, 7)),
            "outcomes": OutcomeCells(
                mentioned_and_cited=cell(1.2, 3, 8, (2, 7)),
                mentioned_only=cell(0.2, 3, 8, (1, 7)),
                cited_only=cell(0.2, 3, 8, (1, 7)),
                neither=cell(1.4, 3, 8, (3, 7)),
            ),
            "share_of_voice": cell(2.5, 4, 8),
            "previous": previous,
            "detail": EngineDetailCells(
                cited_given_citations=cell(1.4, 3, 8, (3, 7)),
                citation_share=cell(3, 7, 8),
                first_mention=cell(2.0, 2, 8, (3, 3)),
                fanout_presence=cell(1.0, 3, 8, (4, 7)) if fanout else None,
                fanout_mean=cell(9, 4, 8) if fanout else None,
            ),
        }
    )


def earlier() -> EngineCells:
    return EngineCells(
        mentioned=cell(1.0, 1, 1, (1, 1)),
        cited=cell(0.0, 1, 1, (0, 1)),
        outcomes=OutcomeCells(
            mentioned_and_cited=cell(0.5, 1, 1, (1, 1)),
            mentioned_only=cell(0.25, 1, 1, (0, 1)),
            cited_only=cell(0.0, 1, 1, (0, 1)),
            neither=cell(0.0, 1, 1, (0, 1)),
        ),
        share_of_voice=cell(1.0, 1, 1),
    )


def value(key: str, number: float | None, code: str, n: int = 10) -> AiMetricValue:
    """A rate of one engine, as the tiles build it."""
    return AiMetricValue(
        metric=key,
        value=number,
        numerator=number,
        denominator=1,
        unit="ratio",
        n_observations=n,
        aggregation="prompt_weighted",
        window=FRAME.window,
        filters=FRAME.filters,
        engine_code=code,
        is_estimate=False,
        method="m",
        method_version=1,
        pooled=Pooled(successes=1, trials=2),
    )


def test_the_built_keys_are_the_keys_of_the_note() -> None:
    """The first column of the registry matrix is the registry: a key the code has and the note
    lacks, or the other way round, fails here."""
    matrix = (
        NOTE.read_text(encoding="utf-8").split("## Registry matrix")[1].split("## Card read")[0]
    )
    in_note = {
        key
        for row in matrix.splitlines()
        if row.startswith("| `ai.")
        for key in re.findall(r"`(ai\.[a-z_.]+)`", row.split("|")[1])
    }

    assert in_note
    assert in_note == (set(metrics.METRICS) - set(OUTCOMES)) | {"ai.outcome_mix"}


def test_every_key_has_the_unit_and_weighting_of_the_note() -> None:
    counts = {"ai.prompts_in_scope", "ai.valid_answers", "ai.fanout_mean_queries"}
    assert counts <= set(metrics.METRICS)
    for key, spec in metrics.METRICS.items():
        assert spec.unit == ("count" if key in counts else "ratio"), key
    observation = {"ai.share_of_voice", "ai.citation_share", "ai.fanout_mean_queries"}
    for key, spec in metrics.METRICS.items():
        if key in counts - {"ai.fanout_mean_queries"} | metrics.SUPPRESSED:
            assert spec.aggregation is None, key
        else:
            expected = "observation_weighted" if key in observation else "prompt_weighted"
            assert spec.aggregation == expected, key


def test_a_cell_becomes_a_value_with_its_counts_and_value_is_numerator_over_denominator() -> None:
    result = metrics.cell_value("ai.mention_rate", cell(1.4, 3, 8, (3, 7)), FRAME, CHATGPT)

    assert result.value == pytest.approx(1.4 / 3)
    assert (result.numerator, result.denominator, result.n_observations) == (1.4, 3, 8)
    assert result.value == pytest.approx(result.numerator / result.denominator)  # type: ignore[operator]
    # A prompt weighted value: its prompts, its answers, its weighting.
    assert result.n_prompts == 3
    assert result.pooled == Pooled(successes=3, trials=7)
    assert result.aggregation == "prompt_weighted"
    assert (result.engine_code, result.observation_class) == (CHATGPT, "consumer_ui")
    assert (result.unit, result.is_estimate, result.method_version) == ("ratio", False, 1)
    assert result.window == FRAME.window
    assert result.filters == FRAME.filters
    assert result.ci is None
    assert result.suppressed_reason is None


def test_an_observation_weighted_cell_has_no_prompts_and_no_pooled_counts() -> None:
    result = metrics.cell_value("ai.share_of_voice", cell(2.5, 4, 8), FRAME, CHATGPT)

    assert (result.numerator, result.denominator) == (2.5, 4)
    assert result.aggregation == "observation_weighted"
    assert result.n_prompts is None
    assert result.pooled is None
    dumped = result.model_dump_json()
    assert '"n_prompts"' not in dumped
    assert '"pooled"' not in dumped


def test_an_empty_denominator_is_no_value_and_never_a_rate_of_zero() -> None:
    result = metrics.cell_value("ai.mention_rate", cell(0, 0, 0, (0, 0)), FRAME, CHATGPT)

    assert result.value is None
    assert (result.numerator, result.denominator, result.n_observations) == (0, 0, 0)


def test_a_count_has_no_denominator() -> None:
    result = metrics.count_value("ai.valid_answers", 7, 8, FRAME, CHATGPT)

    assert (result.value, result.numerator, result.denominator) == (7, 7, None)
    assert (result.unit, result.n_observations, result.aggregation) == ("count", 8, None)
    assert result.engine_code == CHATGPT


def test_the_prompts_in_scope_are_a_count_of_no_engine() -> None:
    result = metrics.count_value("ai.prompts_in_scope", 3, 9, FRAME, None)

    assert (result.value, result.denominator, result.n_observations) == (3, None, 9)
    assert result.engine_code is None
    assert result.observation_class is None


def test_a_suppressed_value_has_null_value_and_counts_and_a_reason() -> None:
    result = metrics.suppressed_value("ai.recommendation_rate", 7, FRAME, CHATGPT)

    assert (result.value, result.numerator, result.denominator) == (None, None, None)
    assert result.suppressed_reason == "not_classified"
    assert result.n_observations == 7
    assert result.unit == "ratio"


def test_a_citation_share_is_own_units_over_all_units_of_the_valid_answers() -> None:
    result = metrics.citation_share_value(3, 7, 7, FRAME, CHATGPT)

    assert result.value == pytest.approx(3 / 7)
    assert (result.numerator, result.denominator, result.n_observations) == (3, 7, 7)
    assert result.aggregation == "observation_weighted"
    empty = metrics.citation_share_value(0, 0, 4, FRAME, GEMINI)
    assert (empty.value, empty.numerator, empty.denominator, empty.n_observations) == (
        None,
        0,
        0,
        4,
    )


def test_an_engine_average_is_the_equal_weight_mean_and_needs_two_engines() -> None:
    key = "ai.mention_rate"
    two = [value(key, 0.3, CHATGPT, 10), value(key, 0.5, GEMINI, 5)]

    result = metrics.engine_average(key, two, FRAME)

    assert result is not None
    assert result.metric == "ai.mention_rate.engine_average"
    assert result.numerator == pytest.approx(0.8)
    assert result.denominator == 2
    assert result.value == pytest.approx(0.4)
    assert result.engines == [CHATGPT, GEMINI]
    assert result.n_observations == 15
    assert result.aggregation == "prompt_weighted"
    assert (result.engine_code, result.observation_class, result.previous) == (
        None,
        None,
        NOT_ASKED,
    )
    # One engine with a value is no average, and an engine with no value is left out of it.
    assert metrics.engine_average(key, two[:1], FRAME) is None
    assert metrics.engine_average(key, [*two[:1], value(key, None, GEMINI)], FRAME) is None
    third = metrics.engine_average(key, [*two, value(key, None, "google_ai_mode", 99)], FRAME)
    assert third is not None
    assert (third.denominator, third.engines, third.n_observations) == (2, [CHATGPT, GEMINI], 15)
    assert metrics.engine_average(key, [], FRAME) is None


def test_engines_are_never_pooled() -> None:
    key = "ai.mention_rate"
    result = metrics.engine_average(key, [value(key, 0.3, CHATGPT), value(key, 0.5, GEMINI)], FRAME)

    assert result is not None
    assert result.pooled is None
    assert result.n_prompts is None
    assert '"pooled"' not in result.model_dump_json()


def test_the_tiles_of_an_engine_are_in_the_order_of_the_note() -> None:
    chatgpt = metrics.engine_tiles(engine(CHATGPT, fanout=True), FRAME, (3, 7))
    gemini = metrics.engine_tiles(engine(GEMINI), FRAME, (0, 0))

    assert [tile.metric for tile in chatgpt] == [*TILES, *FANOUT]
    # An engine that does not expose fan-out has no such tile: not exposed, never 0.
    assert [tile.metric for tile in gemini] == TILES
    assert {tile.engine_code for tile in chatgpt} == {CHATGPT}
    assert {tile.observation_class for tile in chatgpt} == {"consumer_ui"}


def test_the_tiles_carry_the_counts_of_their_cells() -> None:
    tiles = {t.metric: t for t in metrics.engine_tiles(engine(CHATGPT, fanout=True), FRAME, (3, 7))}

    assert (tiles["ai.valid_answers"].value, tiles["ai.valid_answers"].n_observations) == (7, 8)
    assert tiles["ai.mention_and_citation_rate"].numerator == 1.2
    assert [tiles[key].numerator for key in OUTCOMES] == [1.2, 0.2, 0.2, 1.4]
    assert sum(tiles[key].numerator for key in OUTCOMES) == pytest.approx(3)  # type: ignore[misc]
    assert (tiles["ai.share_of_voice"].numerator, tiles["ai.share_of_voice"].denominator) == (
        2.5,
        4,
    )
    assert tiles["ai.citation_rate_given_citations"].pooled == Pooled(successes=3, trials=7)
    assert tiles["ai.first_mention_rate"].n_prompts == 2
    assert tiles["ai.fanout_presence_rate"].pooled == Pooled(successes=4, trials=7)
    mean = tiles["ai.fanout_mean_queries"]
    assert (mean.unit, mean.aggregation, mean.numerator, mean.denominator) == (
        "count",
        "observation_weighted",
        9,
        4,
    )
    assert mean.value == pytest.approx(2.25)
    assert (tiles["ai.citation_share"].numerator, tiles["ai.citation_share"].denominator) == (3, 7)
    # Citation share and recommendation count the engine's valid answers (C-18).
    assert tiles["ai.citation_share"].n_observations == 7
    assert tiles["ai.recommendation_rate"].n_observations == 7
    assert tiles["ai.recommendation_rate"].suppressed_reason == "not_classified"


def test_previous_is_absent_without_compare() -> None:
    for tile in metrics.engine_tiles(engine(CHATGPT, fanout=True), FRAME, (3, 7)):
        assert tile.previous is NOT_ASKED, tile.metric
        assert '"previous"' not in tile.model_dump_json(), tile.metric


def test_previous_is_null_when_the_engine_had_no_answer_there() -> None:
    comparable = {
        "ai.mention_rate",
        "ai.citation_rate",
        "ai.mention_and_citation_rate",
        *OUTCOMES,
        "ai.share_of_voice",
    }
    for tile in metrics.engine_tiles(engine(GEMINI, previous=None), FRAME, (0, 0)):
        # The key is there, null: asked, and no answer.
        assert ('"previous":null' in tile.model_dump_json()) == (tile.metric in comparable), (
            tile.metric
        )
        if tile.metric in comparable:
            assert tile.previous is None


def test_previous_is_the_cell_of_the_window_before_on_the_keys_that_compare() -> None:
    tiles = {
        t.metric: t
        for t in metrics.engine_tiles(engine(CHATGPT, previous=earlier()), FRAME, (3, 7))
    }

    assert tiles["ai.mention_rate"].previous == earlier().mentioned
    assert tiles["ai.citation_rate"].previous == earlier().cited
    assert tiles["ai.mention_and_citation_rate"].previous == earlier().outcomes.mentioned_and_cited
    assert tiles[OUTCOMES[1]].previous == earlier().outcomes.mentioned_only
    assert tiles[OUTCOMES[2]].previous == earlier().outcomes.cited_only
    assert tiles[OUTCOMES[3]].previous == earlier().outcomes.neither
    assert tiles["ai.share_of_voice"].previous == earlier().share_of_voice
    for key in (
        "ai.valid_answers",
        "ai.recommendation_rate",
        "ai.citation_share",
        "ai.citation_rate_given_citations",
        "ai.first_mention_rate",
        "ai.fanout_presence_rate",
        "ai.fanout_mean_queries",
    ):
        assert key not in tiles or tiles[key].previous is NOT_ASKED, key
