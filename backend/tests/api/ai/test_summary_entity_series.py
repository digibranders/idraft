"""Entities per week in the series (contract C2, change log C-10 and C-11): with
`include=series,entities` each point holds the cells of every tracked entity over the same weeks
the point holds (its own week, or the weeks it pools), weighted as the point is, at most twenty
entities, and never a `previous`. Answers are written straight into the tables, on Wednesdays of a
UTC project, with the entities each one names in order, so every number is worked by hand."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, fields
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai.summary import sum_named
from idraft.api.ai.summary_repository import EntityCounts
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    answer_in_another_project,
    cell,
    day,
    full_project,
    get_summary,
    mention_every_answer,
    pooled,
    prompt_row,
    statements,
    summary_data,
    topic_row,
)
from tests.api.ai.test_summary_pooling import _base_week, _project, _span, _wednesday
from tests.api.auth.support import execute, fetchrow
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.rank_support import _entity
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded


@dataclass(frozen=True)
class Named:
    """One answer of a prompt: the entities it names, in the order it names them (`names`, which
    make the share of voice set), mentions stored without an order as ingest stores an uncertain
    one (`unordered`), whether it is valid and the engine that gave it."""

    prompt: str
    when: datetime
    names: tuple[uuid.UUID, ...] = ()
    unordered: tuple[uuid.UUID, ...] = ()
    valid: bool = True
    engine: str = CHATGPT


async def _write_named(migrated: PostgresServer, world: Summary, answers: Sequence[Named]) -> None:
    """The answers, their fact rows and their mention rows, as ingest writes them (the tracked
    count and the competitor list of a fact row follow the entities named with an order)."""
    tag = uuid.uuid4().hex
    marks = [f"{tag}-{index}" for index in range(len(answers))]
    raw = await fetchrow(
        migrated,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', now(), "
        "'ai_raw', now() + interval '400 days') RETURNING id",
        f"ai/named/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
    )
    derivation = await fetchrow(
        migrated,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) ON CONFLICT ON CONSTRAINT derivations_identity "
        "DO UPDATE SET extractor_version = 1 RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    await execute(
        migrated,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT a.at, (a.at AT TIME ZONE 'UTC')::date, p.workspace_id, p.project_id, e.code, "
        "e.observation_class, p.id, p.current_version_id, a.mark, 'dataforseo', "
        "'ai_optimization/chat_gpt/llm_scraper', 'complete', false, $5, 1, 1, 1 "
        "FROM unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::text[]) "
        "AS a(prompt_id, at, mark, engine) JOIN ai.prompts p ON p.id = a.prompt_id "
        "JOIN ai.engines e ON e.code = a.engine",
        [world.prompts[answer.prompt].id for answer in answers],
        [answer.when for answer in answers],
        marks,
        [answer.engine for answer in answers],
        raw["id"],
    )
    await execute(
        migrated,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "competitor_mentions, had_structured_list) SELECT o.id, o.observed_at, $2, "
        "o.workspace_id, o.project_id, o.observed_date, o.engine_code, o.observation_class, "
        "o.prompt_id, o.prompt_version_id, 1, a.valid, a.own, false, 0, 0, a.tracked, "
        "string_to_array(a.rivals, ',')::uuid[], false FROM ai.observations o "
        "JOIN unnest($3::text[], $4::boolean[], $5::boolean[], $6::int[], $7::text[]) "
        "AS a(mark, valid, own, tracked, rivals) ON a.mark = o.query_text "
        "WHERE o.project_id = $1",
        world.project.id,
        derivation["id"],
        marks,
        [answer.valid for answer in answers],
        [world.own in answer.names for answer in answers],
        [len(answer.names) for answer in answers],
        [",".join(str(e) for e in answer.names if e != world.own) for answer in answers],
    )
    mentions = [
        (mark, entity, order, status)
        for mark, answer in zip(marks, answers, strict=True)
        for entity, order, status in (
            *((e, position, "accepted") for position, e in enumerate(answer.names, 1)),
            *((e, None, "uncertain") for e in answer.unordered),
        )
    ]
    await execute(
        migrated,
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, mention_status, confidence, evidence_spans) "
        "SELECT f.observation_id, f.observed_at, m.entity_id, f.derivation_id, f.workspace_id, "
        "f.project_id, f.engine_code, CASE WHEN m.entity_id = $2 THEN 'own' ELSE 'competitor' END, "
        "1, 0, m.position, 1, 'alias_word', m.status, 1, ARRAY['[0,8)'::int4range] "
        "FROM unnest($3::text[], $4::uuid[], $5::int[], $6::text[]) "
        "AS m(mark, entity_id, position, status) JOIN ai.observations o "
        "ON o.query_text = m.mark AND o.project_id = $1 JOIN ai.observation_facts f "
        "ON f.observation_id = o.id AND f.observed_at = o.observed_at",
        world.project.id,
        world.own,
        [mark for mark, _, _, _ in mentions],
        [entity for _, entity, _, _ in mentions],
        [order for _, _, order, _ in mentions],
        [status for _, _, _, status in mentions],
    )


def _points(row: dict[str, Any], engine: int = 0) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = row["engines"][engine]["series"]
    return points


def _entity_cells(point: dict[str, Any], entity: uuid.UUID) -> dict[str, Any]:
    found: dict[str, Any] = next(c for c in point["entities"] if c["entity_id"] == str(entity))
    return found


def _mentioned_and_share(
    point: dict[str, Any], entity: uuid.UUID
) -> tuple[tuple[Any, Any, Any], tuple[Any, Any, Any]]:
    found = _entity_cells(point, entity)
    return cell(found["mentioned"]), cell(found["share_of_voice"])


@dataclass(frozen=True)
class Ten:
    """Ten prompts of one topic, answered in the weeks W-1 and W; `own` and `rival` name the
    tracked entities. W-1: all ten answered; p1 names both brands, p2 the own brand, p3 the
    rival, the others nobody. W: p1 to p9 answered (p10 not); p1 and p2 name the own brand, p3
    both, p4 and p5 the own brand, p6 the rival, p7 to p9 nobody."""

    world: Summary
    week: date

    @property
    def own(self) -> uuid.UUID:
        return self.world.own

    @property
    def rival(self) -> uuid.UUID:
        return self.world.rival


@pytest.fixture
async def ten(resources: Resources, migrated: PostgresServer) -> Ten:
    names = [f"p{number}" for number in range(1, 11)]
    world = await _project(resources, migrated, names)
    week = _base_week()
    own, rival = world.own, world.rival
    before = {"p1": (own, rival), "p2": (own,), "p3": (rival,)}
    now = {
        "p1": (own,),
        "p2": (own,),
        "p3": (own, rival),
        "p4": (own,),
        "p5": (own,),
        "p6": (rival,),
    }
    await _write_named(
        migrated,
        world,
        [Named(name, _wednesday(week, -1), before.get(name, ())) for name in names]
        + [Named(name, _wednesday(week, 0), now.get(name, ())) for name in names[:9]],
    )
    return Ten(world, week)


def _two_weeks(ten: Ten) -> dict[str, str]:
    return _span(ten.week - timedelta(weeks=1), ten.week + timedelta(days=6))


async def test_a_week_has_the_cells_of_each_tracked_entity(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """The window of the last three days holds answer 1 of `providers` on ChatGPT (both brands
    named), the Gemini answer (both named) and the answer of `pricing` (nobody named). A point of
    a prompt row pools the trailing four weeks inside the window, so the last point holds all of
    it, whatever day of the week today is, and equals the window's own entity cells."""
    data = await summary_data(
        seeded, api, include="series,entities", **{"from": day(2), "to": day(0)}
    )

    providers = prompt_row(data, seeded, "providers")
    chatgpt, gemini = providers["engines"]
    assert (chatgpt["engine_code"], gemini["engine_code"]) == (CHATGPT, GEMINI)
    for engine in (chatgpt, gemini):
        for point in engine["series"]:
            # The own brand first, then the rival, as the engine's cells are.
            assert [c["entity_id"] for c in point["entities"]] == [
                str(seeded.own),
                str(seeded.rival),
            ]
            for entity in point["entities"]:
                assert "previous" not in entity
        last = engine["series"][-1]
        # Both brands named in the one answer: each has half of it.
        for entity in (seeded.own, seeded.rival):
            assert _mentioned_and_share(last, entity) == ((1, 1, 1), (0.5, 1, 1))
        assert last["entities"] == engine["entities"]
    # `pricing` names nobody: 0 of its one valid answer for each, and no answer to share out.
    pricing = prompt_row(data, seeded, "pricing")["engines"][0]
    assert pricing["engine_code"] == CHATGPT
    for entity in (seeded.own, seeded.rival):
        assert _mentioned_and_share(pricing["series"][-1], entity) == ((0, 1, 1), (0, 0, 1))
    assert pricing["series"][-1]["entities"] == pricing["entities"]


async def test_an_entity_point_uses_the_weeks_its_point_pooled(
    api: httpx.AsyncClient, migrated: PostgresServer, ten: Ten
) -> None:
    """The point of W pools W-1 and W because nine prompts answered in W, so each entity's cells
    pool them too (the 3a numbers for the own brand: 3.5 of 10 prompts, 7 of 19 answers); the
    point of W-1, with ten prompts, is its own week."""
    data = await summary_data(ten.world, api, include="series,entities", **_two_weeks(ten))

    before, now = _points(topic_row(data, "Managed SOC"))
    assert (before["is_pooled"], now["is_pooled"]) == (False, True)
    own, rival = _entity_cells(before, ten.own), _entity_cells(before, ten.rival)
    # W-1 alone. Prompt weighted Mentioned: p1 and p2 name the own brand, p1 and p3 the rival.
    assert cell(own["mentioned"]) == (2, 10, 10)
    assert pooled(own["mentioned"]) == (2, 10)
    assert cell(rival["mentioned"]) == (2, 10, 10)
    assert pooled(rival["mentioned"]) == (2, 10)
    # Three answers name a tracked entity: p1 shares itself out, p2 is the own brand's, p3 the
    # rival's.
    assert cell(own["share_of_voice"]) == (1.5, 3, 10)
    assert cell(rival["share_of_voice"]) == (1.5, 3, 10)

    own, rival = _entity_cells(now, ten.own), _entity_cells(now, ten.rival)
    # W-1 and W. Own: p1 and p2 2 of 2, p3 to p5 1 of 2, the rest none: 3.5 over ten prompts and
    # 7 of 19 answers. Rival: p1 1 of 2, p3 2 of 2, p6 1 of 2.
    assert cell(own["mentioned"]) == (3.5, 10, 19)
    assert pooled(own["mentioned"]) == (7, 19)
    assert cell(rival["mentioned"]) == (2, 10, 19)
    assert pooled(rival["mentioned"]) == (4, 19)
    # Nine answers name an entity over the two weeks; the own brand's shares are 6 of them, the
    # rival's 3, and the own cell is the engine's own share of voice.
    assert cell(own["share_of_voice"]) == (6, 9, 19)
    assert cell(rival["share_of_voice"]) == (3, 9, 19)
    assert now["share_of_voice"] == own["share_of_voice"]

    # A prompt row always pools: p1 over W-1 and W, 2 of 2 for the own brand, 1 of 2 the rival.
    [p1] = [row for row in data["prompts"] if row["prompt_id"] == str(ten.world.prompts["p1"].id)]
    last = _points(p1)[-1]
    assert _mentioned_and_share(last, ten.own) == ((2, 2, 2), (1.5, 2, 2))
    assert _mentioned_and_share(last, ten.rival) == ((1, 2, 2), (0.5, 2, 2))

    # The tenth prompt answers in W naming nobody: ten prompts, so W is its own week again.
    await _write_named(migrated, ten.world, [Named("p10", _wednesday(ten.week, 0))])
    data = await summary_data(ten.world, api, include="series,entities", **_two_weeks(ten))

    before_again, now = _points(topic_row(data, "Managed SOC"))
    assert now["is_pooled"] is False
    assert _entity_cells(before_again, ten.own) == _entity_cells(before, ten.own)
    own, rival = _entity_cells(now, ten.own), _entity_cells(now, ten.rival)
    assert cell(own["mentioned"]) == (5, 10, 10)
    assert pooled(own["mentioned"]) == (5, 10)
    assert cell(rival["mentioned"]) == (2, 10, 10)
    assert cell(own["share_of_voice"]) == (4.5, 6, 10)
    assert cell(rival["share_of_voice"]) == (1.5, 6, 10)


def _flat(entity: dict[str, Any]) -> list[float]:
    """The numbers of an entity's cells in one list, for `pytest.approx` (-1 where there is no
    value or no `pooled`)."""
    numbers: list[float] = []
    for c in (entity["mentioned"], entity["share_of_voice"]):
        numbers += [c["numerator"], c["denominator"], c["n_observations"]]
        numbers.append(-1 if c["value"] is None else c["value"])
        numbers += (
            [-1, -1] if c["pooled"] is None else [c["pooled"]["successes"], c["pooled"]["trials"]]
        )
    return numbers


async def test_the_window_entity_cell_equals_the_sum_of_the_raw_weeks(
    api: httpx.AsyncClient, ten: Ten
) -> None:
    """With the series the window's entity counts are the sum of the weekly ones (one statement
    serves both): every cell of every row equals what `include=entities` alone reads."""
    both = await summary_data(ten.world, api, include="series,entities", **_two_weeks(ten))
    alone = await summary_data(ten.world, api, include="entities", **_two_weeks(ten))

    rows = [*both["prompts"], *both["topics"]], [*alone["prompts"], *alone["topics"]]
    assert len(rows[0]) == len(rows[1]) == 11
    for with_series, without in zip(*rows, strict=True):
        for engine, plain in zip(with_series["engines"], without["engines"], strict=True):
            assert [c["entity_id"] for c in engine["entities"]] == [
                c["entity_id"] for c in plain["entities"]
            ]
            for entity, expected in zip(engine["entities"], plain["entities"], strict=True):
                assert _flat(entity) == pytest.approx(_flat(expected))
    topic = topic_row(both, "Managed SOC")["engines"][0]
    assert cell(_entity_cells({"entities": topic["entities"]}, ten.own)["mentioned"]) == (
        3.5,
        10,
        19,
    )


async def test_an_entity_week_follows_the_scope_and_engine_filter(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The last three days (from the day of `misc`'s answer on): the total row's last point holds
    `providers`, `pricing` and `misc` and, by default, not the branded prompt, the archived one
    nor another project's answer; the engine filter and a term narrow it further."""
    window = {"from": day(3), "to": day(0)}
    blocks = {"include": "total,series,entities", **window}

    def last(data: dict[str, Any], engine: int = 0) -> dict[str, Any]:
        point: dict[str, Any] = data["total"]["engines"][engine]["series"][-1]
        return point

    default = await summary_data(seeded, api, **blocks)

    # Prompt weighted over three prompts: own named in `providers` and `misc`, rival in
    # `providers` only; 3 answers in all.
    assert _mentioned_and_share(last(default), seeded.own)[0] == (2, 3, 3)
    assert pooled(_entity_cells(last(default), seeded.own)["mentioned"]) == (2, 3)
    assert _mentioned_and_share(last(default), seeded.rival)[0] == (1, 3, 3)
    assert last(default)["entities"] == default["total"]["engines"][0]["entities"]

    # The branded prompt `brand` names the own brand: a fourth prompt, only when asked.
    branded = await summary_data(seeded, api, include_branded="true", **blocks)
    assert _mentioned_and_share(last(branded), seeded.own)[0] == (3, 4, 4)
    assert _mentioned_and_share(last(branded), seeded.rival)[0] == (1, 4, 4)

    # Gemini answered `providers` once, naming both brands.
    gemini = await summary_data(seeded, api, **{"filter[engine_code_in]": GEMINI}, **blocks)
    assert [e["engine_code"] for e in gemini["total"]["engines"]] == [GEMINI]
    for entity in (seeded.own, seeded.rival):
        assert _mentioned_and_share(last(gemini), entity) == ((1, 1, 1), (0.5, 1, 1))

    # Under Compliance only `providers` is in scope: one prompt, answered once on ChatGPT.
    term = await summary_data(
        seeded, api, **{"filter[term]": str(seeded.topics["compliance"])}, **blocks
    )
    assert term["total"]["prompt_count"] == 1
    assert _mentioned_and_share(last(term), seeded.own) == ((1, 1, 1), (0.5, 1, 1))

    # Another project of the workspace named its own brand yesterday: nothing here moves.
    await answer_in_another_project(
        migrated, worker_db, import_store, seeded.workspace.id, "Otherco", 1
    )
    await ingest(worker_db, import_store)
    assert await summary_data(seeded, api, **blocks) == default


async def test_a_mention_without_an_order_is_not_in_a_week(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """An uncertain mention of the rival, stored without an order, is outside the share of voice
    set: the answer stays the own brand's alone (as for the window's entity cells)."""
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    await _write_named(
        migrated,
        world,
        [Named("a", _wednesday(week, 0), names=(world.own,), unordered=(world.rival,))],
    )

    data = await summary_data(
        world, api, include="series,entities", **_span(week, week + timedelta(days=6))
    )

    [point] = _points(prompt_row(data, world, "a"))
    assert _mentioned_and_share(point, world.rival) == ((0, 1, 1), (0, 1, 1))
    assert _mentioned_and_share(point, world.own) == ((1, 1, 1), (1, 1, 1))
    [topic] = _points(topic_row(data, "Managed SOC"))
    assert _mentioned_and_share(topic, world.rival) == ((0, 1, 1), (0, 1, 1))


async def test_a_week_of_an_invalid_answer_names_no_entity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A refusal that names both brands has mention rows with an order and counts them in its
    fact row; the weekly cells read valid answers only, as the window's do."""
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    both = (world.own, world.rival)
    await _write_named(
        migrated,
        world,
        [
            Named("a", _wednesday(week, 0), names=(world.own,)),
            Named("a", _wednesday(week, 0) + timedelta(hours=1), names=both, valid=False),
        ],
    )

    data = await summary_data(
        world, api, include="series,entities", **_span(week, week + timedelta(days=6))
    )

    [point] = _points(prompt_row(data, world, "a"))
    # Two answers counted, one valid: it names the own brand alone.
    assert _mentioned_and_share(point, world.own) == ((1, 1, 2), (1, 1, 2))
    assert _mentioned_and_share(point, world.rival) == ((0, 1, 2), (0, 1, 2))


async def test_an_empty_week_has_zero_cells_for_every_entity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Prompt `a` answers in W only; the two weeks before it are empty: every entity still has
    cells there, with counts of 0 and no value, and no week is missing."""
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    await _write_named(migrated, world, [Named("a", _wednesday(week, 0), names=(world.own,))])

    data = await summary_data(
        world,
        api,
        include="series,entities",
        **_span(week - timedelta(weeks=2), week + timedelta(days=6)),
    )

    for row in (prompt_row(data, world, "a"), topic_row(data, "Managed SOC")):
        empty, also, now = _points(row)
        for point in (empty, also):
            assert [c["entity_id"] for c in point["entities"]] == [
                str(world.own),
                str(world.rival),
            ]
            for entity in point["entities"]:
                for name in ("mentioned", "share_of_voice"):
                    assert cell(entity[name]) == (0, 0, 0)
                    assert entity[name]["value"] is None
        assert _mentioned_and_share(now, world.own)[0] == (1, 1, 1)
    # The empty week of a topic row pools (no prompt answered), and a topic cell has its `pooled`.
    topic_empty = _points(topic_row(data, "Managed SOC"))[0]
    assert pooled(_entity_cells(topic_empty, world.own)["mentioned"]) == (0, 0)


async def test_week_entities_stop_at_twenty_own_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The own brand, the rival and twenty more competitors: 22 tracked, cells for the own brand
    and the first 19 competitors by name, in every point; an answer that names the last of them
    adds a cell to none."""
    world = await _project(resources, migrated, ["a"])
    extra = [
        await _entity(
            migrated, world.project, f"Rival {n:02d}", f"rival{n:02d}.example", "competitor"
        )
        for n in range(1, 21)
    ]
    week = _base_week()
    await _write_named(
        migrated, world, [Named("a", _wednesday(week, 0), names=(world.own, extra[19]))]
    )

    data = await summary_data(
        world, api, include="series,entities", **_span(week, week + timedelta(days=6))
    )

    assert len(data["entities"]) == 22
    expected = [str(entity) for entity in (world.own, world.rival, *extra[:18])]
    for row in (prompt_row(data, world, "a"), topic_row(data, "Managed SOC")):
        [point] = _points(row)
        assert [c["entity_id"] for c in point["entities"]] == expected
        assert len(point["entities"]) == 20
    # The own brand's share: its answer names two tracked entities, one of them out of the cells.
    assert _mentioned_and_share(_points(prompt_row(data, world, "a"))[0], world.own) == (
        (1, 1, 1),
        (0.5, 1, 1),
    )


async def test_week_entities_are_absent_unless_asked(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for include in ("series", "entities", "series,total", None):
        params = {} if include is None else {"include": include}
        data = await summary_data(seeded, api, **params)
        engines = [
            engine
            for row in (
                *data["prompts"],
                *data["topics"],
                *([data["total"]] if "total" in data else []),
            )
            for engine in row["engines"]
        ]
        assert engines
        for engine in engines:
            assert ("series" in engine) == bool(include and "series" in include)
            assert ("entities" in engine) == (include == "entities")
            for point in engine.get("series", []):
                assert "entities" not in point

    # Both asked: the engine and every point of every row have them.
    data = await summary_data(seeded, api, include="series,entities,total")
    for row in (*data["prompts"], *data["topics"], data["total"]):
        for engine in row["engines"]:
            assert engine["entities"]
            assert engine["series"]
            assert all(
                len(point["entities"]) == len(engine["entities"]) for point in engine["series"]
            )


async def test_a_week_entity_never_carries_previous(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """With a compare window the engine's entity cells have `previous` (null or cells) and the
    points' do not."""
    data = await summary_data(
        seeded, api, include="series,entities", compare="previous_period", **{"from": day(2)}
    )

    for row in (*data["prompts"], *data["topics"]):
        for engine in row["engines"]:
            assert all("previous" in entity for entity in engine["entities"])
            for point in engine["series"]:
                assert point["entities"]
                assert all("previous" not in entity for entity in point["entities"])


def test_sum_named_adds_mentions_and_shares() -> None:
    first, second = EntityCounts(2, 0.5), EntityCounts(3, 1.25)
    # A count a later task adds to `EntityCounts` must be given a value here and be summed.
    assert all(getattr(first, f.name) and getattr(second, f.name) for f in fields(EntityCounts))

    assert sum_named([first, second]) == EntityCounts(5, 1.75)
    assert sum_named([first]) == first
    assert sum_named([]) == EntityCounts()


async def test_series_with_entities_is_two_statements_more_than_plain(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Weekly counts and ONE weekly entity statement, which also gives the window's entity
    counts: `series,entities` costs what `series` and `entities` alone cost together."""
    world = await full_project(resources, migrated)
    await mention_every_answer(migrated, world)
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    plain = await counted()

    assert await counted(include="series") - plain == 1
    assert await counted(include="entities") - plain == 1
    assert await counted(include="series,entities") - plain == 2
    assert await counted(include="series,entities,total", rows="none") - plain == 2 - 2
    compared = await counted(include="series,entities", compare="previous_period")
    assert compared - plain == 4


async def test_a_full_project_series_and_entities_stay_bounded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """150 prompts, three engines and 3,600 answers naming the own brand: every point of every
    row has the one tracked entity's cells, in the statements counted above."""
    world = await full_project(resources, migrated)
    await mention_every_answer(migrated, world)

    data = await summary_data(world, api, include="series,entities,total")

    rows = [*data["prompts"], *data["topics"], data["total"]]
    assert len(rows) == 152
    points = 0
    for row in rows:
        for engine in row["engines"]:
            assert [c["entity_id"] for c in engine["entities"]] == [str(world.own)]
            for point in engine["series"]:
                points += 1
                assert [c["entity_id"] for c in point["entities"]] == [str(world.own)]
                # Every answer names the own brand: wherever there are answers the own cells are
                # the point's own cells.
                assert point["entities"][0]["mentioned"] == point["mentioned"]
                assert point["entities"][0]["share_of_voice"] == point["share_of_voice"]
    assert points == 152 * 3 * len(data["topics"][0]["engines"][0]["series"])
