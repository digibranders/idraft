"""The registry and the mapping of the Overview (contract C8, docs/ai-visibility/contracts/
c8-metrics.md): a summary cell becomes a value with its counts, the tiles of an engine come in the
order of the note, an average of engines is the equal-weight mean of the engines that have a value
and needs two, and `previous` has three states. Pure: nothing here reads a database."""

from __future__ import annotations

import re
import uuid
from datetime import date
from pathlib import Path

import pytest
from fastapi.exceptions import RequestValidationError

from idraft.api.ai import metrics
from idraft.api.ai.metrics import Frame
from idraft.api.problems import NotImplementedProblemError
from idraft.api.schemas.ai import (
    NOT_ASKED,
    EngineCells,
    EngineDetailCells,
    EngineSummary,
    EntityCells,
    EntityPreviousCells,
    MetricCell,
    OutcomeCells,
    PointPool,
    Pooled,
    WeekCells,
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


# The key resolution and the value and series builders of routes 3 and 4.

SENTIMENT = tuple(f"ai.sentiment.{name}" for name in ("positive", "neutral", "negative", "mixed"))


def _note_keys(paragraph_start: str, paragraph_end: str) -> set[str]:
    text = NOTE.read_text(encoding="utf-8").split("## Registry matrix")[1]
    paragraph = text.split(paragraph_start)[1].split(paragraph_end)[0]
    return set(re.findall(r"`(ai\.[a-z0-9_.]+)`", paragraph))


def test_the_unbuilt_keys_are_the_known_keys_of_the_note_and_none_is_built() -> None:
    """The note names the known keys that are not built (and says `ai.sentiment` has four `.x`
    keys: doc 19 names them); the code has exactly those, and none is also a built key."""
    named = _note_keys("Known registry keys that are not built", "Any other\nkey")

    assert "ai.sentiment" in named
    assert named | set(SENTIMENT) == metrics.UNBUILT
    assert not metrics.UNBUILT & (set(metrics.METRICS) | {"ai.outcome_mix"})
    assert len(metrics.UNBUILT) == len(named) + 4


def test_a_built_key_resolves_to_its_registry_keys() -> None:
    assert metrics.resolve("ai.mention_rate", "value") == ("ai.mention_rate",)
    assert metrics.resolve("ai.prompts_in_scope", "value") == ("ai.prompts_in_scope",)
    # The outcome mix is four keys, in the order of the note; a sub key is its own.
    assert metrics.resolve("ai.outcome_mix", "value") == OUTCOMES
    assert metrics.resolve(OUTCOMES[3], "value") == (OUTCOMES[3],)
    assert metrics.resolve("ai.recommendation_rate", "value") == ("ai.recommendation_rate",)


def test_an_unknown_key_is_not_found_and_names_the_key() -> None:
    for key in ("ai.nope", "seo.top3_count", "fp.sessions", "ai.outcome_mix.x", "ai.sentiment.x"):
        for route in ("value", "series"):
            with pytest.raises(metrics.UnknownMetricError) as raised:
                metrics.resolve(key, route)

            assert (raised.value.status, raised.value.problem_code) == (404, "unknown_metric")
            assert key in str(raised.value.detail)


def test_a_known_key_that_is_not_built_is_not_implemented_and_names_the_key() -> None:
    for key in (*metrics.UNBUILT, *SENTIMENT):
        for route in ("value", "series"):
            with pytest.raises(NotImplementedProblemError) as raised:
                metrics.resolve(key, route)

            assert raised.value.detail == f"Not built yet: {key}."


def test_an_unknown_key_and_an_unbuilt_one_are_told_apart() -> None:
    with pytest.raises(metrics.UnknownMetricError):
        metrics.resolve("ai.sentimental", "value")
    with pytest.raises(NotImplementedProblemError):
        metrics.resolve("ai.sentiment", "value")


def test_a_key_without_weekly_data_is_not_built_on_the_series_route() -> None:
    for key in metrics.SERIES_KEYS:
        assert metrics.resolve(key, "series") == (key,)
    for key in (*metrics.METRICS, "ai.outcome_mix"):
        if key in metrics.SERIES_KEYS:
            continue
        with pytest.raises(NotImplementedProblemError) as raised:
            metrics.resolve(key, "series")

        assert raised.value.detail == f"Not built yet: {key} on series."
        # The same key is built for a value.
        assert metrics.resolve(key, "value")


def test_entity_ids_are_for_mention_rate_and_share_of_voice_only() -> None:
    for key in metrics.ENTITY_KEYS:
        assert metrics.resolve(key, "value", entities=True) == (key,)
        assert metrics.resolve(key, "series", entities=True) == (key,)
    assert set(metrics.ENTITY_KEYS) == {"ai.mention_rate", "ai.share_of_voice"}
    for key in (*metrics.METRICS, "ai.outcome_mix"):
        if key in metrics.ENTITY_KEYS:
            continue
        with pytest.raises(RequestValidationError) as raised:
            metrics.resolve(key, "value", entities=True)

        assert [(error["loc"], error["type"]) for error in raised.value.errors()] == [
            (("query", "entity_ids"), "not_supported")
        ]
    # The key is checked first: a key that is not built is not told it cannot have entities.
    with pytest.raises(metrics.UnknownMetricError):
        metrics.resolve("ai.nope", "value", entities=True)
    with pytest.raises(NotImplementedProblemError):
        metrics.resolve("ai.sentiment", "value", entities=True)


def test_an_engine_value_is_a_cell_a_count_a_suppressed_value_or_nothing() -> None:
    chatgpt = engine(CHATGPT, fanout=True)
    gemini = engine(GEMINI)

    mention = metrics.engine_value("ai.mention_rate", chatgpt, FRAME, (3, 7))
    valid = metrics.engine_value("ai.valid_answers", chatgpt, FRAME, (3, 7))
    recommended = metrics.engine_value("ai.recommended_given_mentioned", chatgpt, FRAME, (3, 7))
    share = metrics.engine_value("ai.citation_share", chatgpt, FRAME, (3, 7))

    assert mention is not None
    assert mention.numerator == 1.4
    assert valid is not None
    assert (valid.value, valid.n_observations) == (7, 8)
    assert recommended is not None
    assert recommended.suppressed_reason == "not_classified"
    assert share is not None
    assert (share.numerator, share.denominator) == (3, 7)
    # Not exposed by the engine: no value, which is not a value of 0.
    assert metrics.engine_value("ai.fanout_mean_queries", gemini, FRAME, (0, 0)) is None
    assert metrics.engine_value("ai.fanout_presence_rate", gemini, FRAME, (0, 0)) is None
    assert metrics.engine_value("ai.fanout_presence_rate", chatgpt, FRAME, (3, 7)) is not None


def test_engine_values_are_by_engine_then_by_key_with_an_average_of_the_averaged_keys() -> None:
    engines = [engine(CHATGPT, fanout=True), engine(GEMINI)]

    mix = metrics.engine_values(OUTCOMES, engines, FRAME, {})
    mention = metrics.engine_values(("ai.mention_rate",), engines, FRAME, {})
    fanout = metrics.engine_values(("ai.fanout_mean_queries",), engines, FRAME, {})

    # Four values per engine, no average: the outcome keys are not averaged.
    assert [(v.metric, v.engine_code) for v in mix] == [
        (key, code) for code in (CHATGPT, GEMINI) for key in OUTCOMES
    ]
    assert [(v.metric, v.engine_code) for v in mention] == [
        ("ai.mention_rate", CHATGPT),
        ("ai.mention_rate", GEMINI),
        ("ai.mention_rate.engine_average", None),
    ]
    assert [v.engine_code for v in fanout] == [CHATGPT]


def _entity(number: int, mentioned: MetricCell, share: MetricCell, previous: object) -> EntityCells:
    return EntityCells.model_validate(
        {
            "entity_id": uuid.UUID(int=number),
            "mentioned": mentioned,
            "share_of_voice": share,
            "previous": previous,
        }
    )


def test_an_entity_value_is_its_cell_for_the_engine_with_its_id_and_previous() -> None:
    cells = _entity(
        1,
        cell(0.4, 3, 8, (2, 7)),
        cell(1.5, 4, 8),
        EntityPreviousCells(mentioned=cell(0, 1, 1, (0, 1)), share_of_voice=cell(0, 1, 1)),
    )

    mention = metrics.entity_value("ai.mention_rate", CHATGPT, cells, FRAME)
    share = metrics.entity_value("ai.share_of_voice", CHATGPT, cells, FRAME)

    assert (mention.entity_id, mention.engine_code) == (uuid.UUID(int=1), CHATGPT)
    assert (mention.numerator, mention.denominator, mention.pooled) == (
        0.4,
        3,
        Pooled(successes=2, trials=7),
    )
    assert mention.aggregation == "prompt_weighted"
    assert mention.previous == cell(0, 1, 1, (0, 1))
    assert (share.numerator, share.denominator, share.pooled) == (1.5, 4, None)
    assert share.previous == cell(0, 1, 1)
    assert share.aggregation == "observation_weighted"
    # The words are the entity's, not the own brand's.
    assert "entity" in mention.method
    assert "entity" in share.method


def test_an_entity_previous_has_the_three_states() -> None:
    plain = _entity(1, cell(0.4, 3, 8, (2, 7)), cell(1.5, 4, 8), NOT_ASKED)
    none = _entity(1, cell(0.4, 3, 8, (2, 7)), cell(1.5, 4, 8), None)

    assert metrics.entity_value("ai.mention_rate", CHATGPT, plain, FRAME).previous is NOT_ASKED
    assert metrics.entity_value("ai.share_of_voice", CHATGPT, none, FRAME).previous is None
    assert (
        '"previous"'
        not in metrics.entity_value("ai.mention_rate", CHATGPT, plain, FRAME).model_dump_json()
    )


def test_entity_values_follow_the_cell_order_of_each_engine_and_have_one_average_each() -> None:
    def with_entities(code: str) -> EngineSummary:
        cells = [
            _entity(n, cell(0.1 * n, 1, 1, (1, 1)), cell(0.5, 1, 1), NOT_ASKED) for n in (3, 1, 2)
        ]
        return engine(code).model_copy(update={"entities": cells})

    engines = [with_entities(CHATGPT), with_entities(GEMINI)]

    values = metrics.entity_values(
        "ai.mention_rate", engines, {uuid.UUID(int=2), uuid.UUID(int=3)}, FRAME
    )

    # The engine's own order (the summary's: own first), not the order asked, one average each.
    assert [(v.metric, v.engine_code, v.entity_id.int) for v in values if v.entity_id] == [
        ("ai.mention_rate", CHATGPT, 3),
        ("ai.mention_rate", CHATGPT, 2),
        ("ai.mention_rate", GEMINI, 3),
        ("ai.mention_rate", GEMINI, 2),
        ("ai.mention_rate.engine_average", None, 3),
        ("ai.mention_rate.engine_average", None, 2),
    ]
    assert metrics.entity_values("ai.mention_rate", engines, set(), FRAME) == []
    only = metrics.entity_values("ai.mention_rate", engines[:1], {uuid.UUID(int=1)}, FRAME)
    # One engine is no average.
    assert [v.metric for v in only] == ["ai.mention_rate"]


def test_an_engine_average_of_an_entity_carries_its_id() -> None:
    key = "ai.share_of_voice"
    values = [value(key, 0.3, CHATGPT), value(key, 0.5, GEMINI)]

    average = metrics.engine_average(key, values, FRAME, entity_id=uuid.UUID(int=7))

    assert average is not None
    assert average.entity_id == uuid.UUID(int=7)
    plain = metrics.engine_average(key, values, FRAME)
    assert plain is not None
    assert plain.entity_id is None


def test_a_week_is_partial_when_a_window_bound_cuts_it_or_it_holds_today() -> None:
    first, last, today = date(2026, 10, 14), date(2026, 11, 3), date(2026, 12, 25)  # Wed, Tue

    def partial(week_start: date, *, now: date = today) -> bool:
        return metrics.is_partial(week_start, first, last, now)

    assert partial(date(2026, 10, 12))  # starts before `from`
    assert not partial(date(2026, 10, 19))
    assert not partial(date(2026, 10, 26))  # its Sunday, 1 November, is inside
    assert partial(date(2026, 11, 2))  # its Sunday, 8 November, is after `to`
    # The Sunday of a week on the last day of the window cuts nothing.
    assert not metrics.is_partial(date(2026, 10, 26), first, date(2026, 11, 1), today)
    assert metrics.is_partial(date(2026, 10, 26), first, date(2026, 10, 31), today)
    # Holding today makes a whole week partial: Monday, Wednesday and Sunday of it.
    for now in (date(2026, 10, 19), date(2026, 10, 21), date(2026, 10, 25)):
        assert partial(date(2026, 10, 19), now=now)
    for now in (date(2026, 10, 18), date(2026, 10, 26)):
        assert not partial(date(2026, 10, 19), now=now)


def _week(
    start: date,
    prompts: int,
    mentioned: MetricCell,
    pooled: bool,
    entities: list[EntityCells] | None,
) -> WeekCells:
    pool = (
        PointPool(
            weeks=2,
            window=MetricWindow(from_="2026-10-17", to="2026-10-25", timezone="Europe/Berlin"),
            reason="few_prompts",
            below_prompts=10,
        )
        if pooled
        else None
    )
    return WeekCells(
        week_start=start,
        prompts=prompts,
        is_pooled=pooled,
        pool=pool,
        mentioned=mentioned,
        cited=cell(0.5, 2, 3, (1, 3)),
        share_of_voice=cell(1, 2, 3),
        entities=entities,
    )


def test_a_series_is_its_weeks_mapped_with_the_pooling_the_summary_gave() -> None:
    weeks = [
        _week(date(2026, 10, 12), 2, cell(1.0, 2, 3, (2, 3)), True, None),
        _week(date(2026, 10, 19), 12, cell(6.0, 12, 12, (6, 12)), False, None),
    ]
    row = engine(CHATGPT).model_copy(update={"series": weeks})

    series = metrics.series_of("ai.mention_rate", row, FRAME, date(2026, 12, 25))

    assert (series.metric, series.engine_code, series.entity_id) == (
        "ai.mention_rate",
        CHATGPT,
        None,
    )
    assert (series.unit, series.aggregation, series.granularity) == (
        "ratio",
        "prompt_weighted",
        "week",
    )
    assert (series.window, series.filters) == (FRAME.window, FRAME.filters)
    assert (series.is_estimate, series.method_version) == (False, 1)
    first, second = series.points
    assert (first.t, first.value, first.numerator, first.denominator) == (
        date(2026, 10, 12),
        0.5,
        1.0,
        2,
    )
    assert (first.n_observations, first.n_prompts, first.is_pooled) == (3, 2, True)
    assert first.pool == weeks[0].pool
    assert first.pooled == Pooled(successes=2, trials=3)
    # An unpooled point has no pool, and its prompts are its own.
    assert (second.is_pooled, second.pool, second.n_prompts) == (False, None, 12)
    assert second.is_partial is False
    assert first.is_partial is True  # before the window opens on the 17th
    # The same weeks for the other keys, each its own cell.
    cited = metrics.series_of("ai.citation_rate", row, FRAME, date(2026, 12, 25))
    share = metrics.series_of("ai.share_of_voice", row, FRAME, date(2026, 12, 25))
    assert cited.points[0].numerator == 0.5
    assert (share.points[0].numerator, share.points[0].pooled, share.aggregation) == (
        1,
        None,
        "observation_weighted",
    )


def test_an_entity_series_is_the_weeks_of_its_cells() -> None:
    ours = _entity(1, cell(0.5, 2, 3, (1, 3)), cell(1.0, 2, 3), NOT_ASKED)
    theirs = _entity(2, cell(0.25, 2, 3, (1, 3)), cell(0.5, 2, 3), NOT_ASKED)
    weeks = [_week(date(2026, 10, 19), 2, cell(1.0, 2, 3, (2, 3)), True, [ours, theirs])]
    row = engine(CHATGPT).model_copy(update={"series": weeks, "entities": [ours, theirs]})

    series = metrics.series_of(
        "ai.mention_rate", row, FRAME, date(2026, 12, 25), entity_id=theirs.entity_id
    )

    assert series.entity_id == theirs.entity_id
    assert series.points[0].numerator == 0.25
    assert series.points[0].pooled == Pooled(successes=1, trials=3)
    assert series.points[0].n_prompts == 2
    assert "entity" in series.method
    share = metrics.series_of(
        "ai.share_of_voice", row, FRAME, date(2026, 12, 25), entity_id=theirs.entity_id
    )
    assert share.points[0].numerator == 0.5
