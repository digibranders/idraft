"""The competitors read (contract C5, route 6 without its `include` blocks): one row per tracked
entity with one entry per engine, read from the prompts summary's entity cells and the sources
lane's citation units. The expected numbers are worked out by hand from the seeded world of
`test_prompts_summary` (see the docstring of its `summary` fixture). ChatGPT, default scope (the
prompts `providers`, `pricing` and `misc`; the branded prompt and the archived one are not in
scope):

    answers 8, valid 7 (the refusal), prompts 3
    own    Mentioned 1.4 of 3 prompts (answers 3 of 7), Share of voice 2.5 of 4 (answers 1, 2, misc;
           answer 1 shares half with the rival)
    rival  Mentioned 0.4 of 3 prompts (answers 2 of 7, answers 1 and 4), Share of voice 1.5 of 4
    Citation units (one page each): own 3, rival 2, third party 2: of 7.
    Gemini: one answer naming both brands and citing the own page."""

from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Any

import httpx
import pytest

from idraft.api.ai.competitors import Contender, top_competitor
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import (
    competitors_body,
    counts,
    entry,
    get_competitors,
    names,
    row_of,
    top_of,
)
from tests.api.ai.metrics_support import engine_tiles, overview_data
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    OWN_PAGE,
    REFUSAL,
    Answer,
    Summary,
    answer_in_another_project,
    ingested,
    new_prompts,
    new_world,
    summary_data,
)
from tests.api.ai.test_prompts_summary import RIVAL_PAGE
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, entities_url, member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import OWN_NAME, RIVAL_NAME
from tests.collectors.rank_support import _entity
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded


def _contender(
    name: str, role: str, sov: float, mentioned: float = 0, *, key: int = 1
) -> Contender:
    return Contender(uuid.UUID(int=key), name, role, sov, mentioned)


# The top competitor rule, alone.


def test_the_top_competitor_has_the_largest_share_of_voice_numerator() -> None:
    rows = [
        _contender("Beta", "competitor", 1.5, key=2),
        _contender("Alpha", "competitor", 2.5, key=3),
        _contender("Gamma", "competitor", 0.5, key=4),
    ]

    assert top_competitor(rows) == uuid.UUID(int=3)


def test_ties_go_to_the_larger_mention_numerator_then_name_then_id() -> None:
    sov = 2.0
    by_mention = [
        _contender("Alpha", "competitor", sov, 1.0, key=2),
        _contender("Zed", "competitor", sov, 1.5, key=3),
    ]
    by_name = [
        _contender("Zed", "competitor", sov, 1.0, key=2),
        _contender("Alpha", "competitor", sov, 1.0, key=3),
    ]
    by_id = [
        _contender("Same", "competitor", sov, 1.0, key=9),
        _contender("Same", "competitor", sov, 1.0, key=4),
    ]

    assert top_competitor(by_mention) == uuid.UUID(int=3)
    assert top_competitor(by_name) == uuid.UUID(int=3)
    assert top_competitor(by_id) == uuid.UUID(int=4)


def test_the_own_entity_is_never_the_top_competitor() -> None:
    rows = [
        _contender("Own", "own", 9.0, 9.0, key=1),
        _contender("Rival", "competitor", 0.5, key=2),
    ]

    assert top_competitor(rows) == uuid.UUID(int=2)
    assert top_competitor(rows[:1]) is None


def test_no_top_competitor_when_no_competitor_has_a_numerator_above_zero() -> None:
    rows = [
        _contender("Own", "own", 3.0, key=1),
        _contender("Rival", "competitor", 0.0, 2.0, key=2),
    ]

    assert top_competitor(rows) is None
    assert top_competitor([]) is None


# The rows.


async def _give(
    api: httpx.AsyncClient, world: Summary, name: str, **body: Any
) -> tuple[str, httpx.Response]:
    """A new entity of the workspace, given a role in the project through the entity routes."""
    created = await api.post(
        entities_url(world.workspace),
        json={"entity_type": "brand", "canonical_name": name},
        headers=world.owner.headers,
    )
    assert created.status_code == 201, created.text
    entity_id: str = created.json()["data"]["entity_id"]
    given = await api.post(
        project_url(world.workspace, world.project.id, "entities"),
        json={"entity_id": entity_id, "role": "competitor", **body},
        headers=world.owner.headers,
    )
    assert given.status_code == 201, given.text
    return entity_id, given


async def test_BE_COMPETITORS_01_tracked_entities_with_role_track_ai_and_colour(  # noqa: N802
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The entity routes keep the tracked entities of a project (own, competitor, watch, whether
    each is tracked in AI answers, a colour); the competitors read has a row for those the AI
    answers track, with the colour: the own entity first, then the competitors by name."""
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, ["x"]))
    await _give(api, world, "Aardvark", color_index=3)
    await _give(api, world, "Watched", role="watch", color_index=4)
    untracked, _ = await _give(api, world, "Untracked", track_ai=False, color_index=5)
    gone, _ = await _give(api, world, "Gone")
    removed = await api.delete(
        project_url(world.workspace, world.project.id, "entities", gone),
        headers=world.owner.headers,
    )
    assert removed.status_code == 200
    colour = await api.patch(
        project_url(world.workspace, world.project.id, "entities", world.own),
        json={"color_index": 1},
        headers=world.owner.headers,
    )
    assert colour.status_code == 200

    kept = await api.get(
        project_url(world.workspace, world.project.id, "entities"), headers=world.owner.headers
    )
    body = await competitors_body(world, api)

    held = {
        row["entity"]["canonical_name"]: (
            row["role"],
            row["track_ai"],
            row["entity"]["color_index"],
        )
        for row in kept.json()["data"]
        if row["removed_at"] is None
    }
    assert held == {
        OWN_NAME: ("own", True, 1),
        RIVAL_NAME: ("competitor", True, None),
        "Aardvark": ("competitor", True, 3),
        "Watched": ("watch", True, 4),
        "Untracked": ("competitor", False, 5),
    }
    # Not rows: the watched entity, the one not tracked in AI answers and the removed one.
    assert names(body) == [OWN_NAME, "Aardvark", RIVAL_NAME]
    assert [(row["entity"]["role"], row["entity"]["color_index"]) for row in body["data"]] == [
        ("own", 1),
        ("competitor", 3),
        ("competitor", None),
    ]
    assert {row["entity"]["entity_type"] for row in body["data"]} == {"brand"}
    # The entity set share of voice is over, as the summary lists it: competitors by name, then own.
    assert [item["name"] for item in body["meta"]["entities"]] == ["Aardvark", RIVAL_NAME, OWN_NAME]
    # Tracking the entity in AI answers again brings its row back.
    again = await api.patch(
        project_url(world.workspace, world.project.id, "entities", untracked),
        json={"track_ai": True},
        headers=world.owner.headers,
    )
    assert again.status_code == 200
    assert names(await competitors_body(world, api)) == [
        OWN_NAME,
        "Aardvark",
        RIVAL_NAME,
        "Untracked",
    ]


async def test_the_rows_are_the_tracked_entities_of_the_project_own_first(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api)

    assert names(body) == [OWN_NAME, RIVAL_NAME]
    assert [row["entity"]["role"] for row in body["data"]] == ["own", "competitor"]
    assert body["meta"]["engine_codes"] == [CHATGPT, GEMINI]
    assert body["meta"]["entity_config_versions"] == [1]
    assert body["meta"]["notes"] == []
    for field in ("compare_window", "previous_answers", "entity_config_changes"):
        assert field not in body["meta"], field
    for row in body["data"]:
        # Not asked for: the blocks the next task builds are not there.
        assert "top_sources" not in row


async def test_each_entity_has_a_row_per_engine_with_the_four_metrics(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api)

    for row in body["data"]:
        assert [item["engine_code"] for item in row["by_engine"]] == [CHATGPT, GEMINI]
        entity_id = row["entity"]["entity_id"]
        for item in row["by_engine"]:
            code = item["engine_code"]
            keys = ("mention_rate", "recommendation_rate", "citation_share", "share_of_voice")
            assert [item[key]["metric"] for key in keys] == [f"ai.{key}" for key in keys]
            for key in keys:
                assert (item[key]["entity_id"], item[key]["engine_code"]) == (entity_id, code)
                assert item[key]["window"] == body["meta"]["window"]
                assert item[key]["filters"] == {
                    "include_branded": False,
                    "branded_only": False,
                    "country_iso": None,
                    "term_id": None,
                }
            assert item["mention_rate"]["aggregation"] == "prompt_weighted"
            assert item["share_of_voice"]["aggregation"] == "observation_weighted"
            assert item["citation_share"]["aggregation"] == "observation_weighted"
            assert "lost_prompts" not in item
            assert "lost_prompts_total" not in item


async def test_BE_COMPETITORS_02_per_entity_cells_of_every_prompt_topic_and_engine(  # noqa: N802
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """The summary's `include=entities` gives each tracked entity a Mentioned and a Share of voice
    cell in every prompt row, topic row and engine; the competitors read gives the engine's from
    the same cells."""
    data = await summary_data(seeded, api, include="entities,total")

    providers = next(
        row for row in data["prompts"] if row["prompt_id"] == str(seeded.prompts["providers"].id)
    )
    chatgpt, gemini = providers["engines"]
    topic = next(row for row in data["topics"] if row["name"] == "Managed SOC")["engines"][0]
    cells = {
        (scope, code, entity): {item["entity_id"]: item for item in engine["entities"]}[str(entity)]
        for scope, engines in (("prompt", (chatgpt, gemini)), ("topic", (topic,)))
        for engine in engines
        for code in (engine["engine_code"],)
        for entity in (seeded.own, seeded.rival)
    }
    # Per prompt: of the five valid answers 1 and 2 name the own brand and 1 and 4 the rival.
    for entity in (seeded.own, seeded.rival):
        cell = cells["prompt", CHATGPT, entity]
        assert counts(cell["mentioned"]) == (2, 5, 6)
        assert counts(cell["share_of_voice"]) == (1.5, 3, 6)
        assert counts(cells["prompt", GEMINI, entity]["share_of_voice"]) == (0.5, 1, 1)
    # Per topic, prompt weighted: `providers` 2 of 5, `pricing` 0 of 1.
    assert counts(cells["topic", CHATGPT, seeded.rival]["mentioned"]) == (
        pytest.approx(0.4),
        2,
        7,
    )
    # And for the engine as a whole, as the competitors read has them.
    body = await competitors_body(seeded, api)
    own, rival = row_of(body, seeded.own), row_of(body, seeded.rival)
    assert counts(entry(own, CHATGPT)["mention_rate"]) == (pytest.approx(1.4), 3, 8)
    assert counts(entry(rival, CHATGPT)["mention_rate"]) == (pytest.approx(0.4), 3, 8)
    assert counts(entry(own, CHATGPT)["share_of_voice"]) == (2.5, 4, 8)
    assert counts(entry(rival, CHATGPT)["share_of_voice"]) == (1.5, 4, 8)
    assert counts(entry(own, GEMINI)["mention_rate"]) == (1, 1, 1)
    assert counts(entry(rival, GEMINI)["share_of_voice"]) == (0.5, 1, 1)


async def test_mention_rate_and_share_of_voice_are_the_summary_entity_cells(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, include="entities,total", rows="none")
    body = await competitors_body(seeded, api)

    for engine in data["total"]["engines"]:
        for cell in engine["entities"]:
            row = row_of(body, uuid.UUID(cell["entity_id"]))
            item = entry(row, engine["engine_code"])
            for key, value in (
                ("mentioned", item["mention_rate"]),
                ("share_of_voice", item["share_of_voice"]),
            ):
                same = {name: value[name] for name in ("value", "numerator", "denominator")}
                assert same == {name: cell[key][name] for name in same}, (engine, key)
                assert value["n_observations"] == cell[key]["n_observations"]
                assert value.get("pooled") == cell[key].get("pooled")
    rival = entry(row_of(body, seeded.rival), CHATGPT)["mention_rate"]
    # Prompt weighted: 2/5 + 2/5 + 0 over the three prompts, in 2 of 7 valid answers.
    assert (rival["value"], rival["n_prompts"], rival["pooled"]) == (
        pytest.approx(0.4 / 3),
        3,
        {"successes": 2, "trials": 7},
    )


async def test_the_share_of_voice_of_the_tracked_entities_adds_up_to_the_whole_on_an_engine(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api)

    for code in (CHATGPT, GEMINI):
        shares = [entry(row, code)["share_of_voice"] for row in body["data"]]
        assert len({share["denominator"] for share in shares}) == 1
        assert sum(share["numerator"] for share in shares) == shares[0]["denominator"]
        assert sum(share["value"] for share in shares) == pytest.approx(1)


async def test_the_denominators_count_valid_answers_only(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second refusal that cites the rival's page: it is an answer (`n_observations`) and no
    more: not a valid answer of any rate, not a citation unit."""
    before = await competitors_body(seeded, api)
    await ingested(
        seeded,
        migrated,
        worker_db,
        import_store,
        [Answer("providers", REFUSAL, (RIVAL_PAGE,), 2)],
    )

    after = await competitors_body(seeded, api)

    rival = entry(row_of(after, seeded.rival), CHATGPT)
    assert counts(rival["mention_rate"]) == (pytest.approx(0.4), 3, 9)
    assert rival["mention_rate"]["pooled"] == {"successes": 2, "trials": 7}
    assert counts(rival["share_of_voice"]) == (1.5, 4, 9)
    # Seven valid answers still, and two units of the rival's pages in seven.
    assert counts(rival["citation_share"]) == (2, 7, 7)
    assert rival["recommendation_rate"]["n_observations"] == 7
    for row in before["data"]:
        same = entry(row_of(after, uuid.UUID(row["entity"]["entity_id"])), CHATGPT)
        was = entry(row, CHATGPT)
        assert same["citation_share"]["numerator"] == was["citation_share"]["numerator"]
        assert same["citation_share"]["denominator"] == was["citation_share"]["denominator"]


async def test_citation_share_is_the_entity_units_over_all_units_of_the_engine(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api)

    own = entry(row_of(body, seeded.own), CHATGPT)["citation_share"]
    rival = entry(row_of(body, seeded.rival), CHATGPT)["citation_share"]
    # Own 3, rival 2 and third party 2 units: both over the seven of the engine, not over their own.
    assert (counts(own), own["value"]) == ((3, 7, 7), pytest.approx(3 / 7))
    assert (counts(rival), rival["value"]) == ((2, 7, 7), pytest.approx(2 / 7))
    assert "pooled" not in own
    assert "previous" not in own


async def test_the_own_citation_share_equals_the_overview_tile(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api)
    data = await overview_data(seeded, api)

    for code in (CHATGPT, GEMINI):
        tile = engine_tiles(data, code)["ai.citation_share"]
        own = entry(row_of(body, seeded.own), code)["citation_share"]
        assert counts(own) == counts(tile), code
        assert own["value"] == tile["value"], code


async def test_flagged_citations_are_left_out_of_every_unit(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """As on the Sources page: the third party citations of ChatGPT are flagged
    `unresolved_redirect` and the rival's `engine_internal`, so the own 3 are all of its units."""
    for role, flag in (("third_party", "unresolved_redirect"), ("competitor", "engine_internal")):
        await execute(
            migrated,
            "UPDATE ai.citations SET flags = ARRAY[$3] "
            "WHERE project_id = $1 AND engine_code = 'chatgpt_web' AND domain_role = $2",
            seeded.project.id,
            role,
            flag,
        )

    body = await competitors_body(seeded, api)

    assert counts(entry(row_of(body, seeded.own), CHATGPT)["citation_share"]) == (3, 3, 7)
    assert counts(entry(row_of(body, seeded.rival), CHATGPT)["citation_share"]) == (0, 3, 7)


async def test_recommendation_is_suppressed_for_every_entity(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api)

    for row in body["data"]:
        for item in row["by_engine"]:
            value = item["recommendation_rate"]
            assert value["suppressed_reason"] == "not_classified"
            assert (value["value"], value["numerator"], value["denominator"]) == (None, None, None)
            assert value["entity_id"] == row["entity"]["entity_id"]
            assert "previous" not in value
    # `n_observations` is the engine's valid answers.
    chatgpt = entry(row_of(body, seeded.own), CHATGPT)["recommendation_rate"]
    gemini = entry(row_of(body, seeded.own), GEMINI)["recommendation_rate"]
    assert (chatgpt["n_observations"], gemini["n_observations"]) == (7, 1)


async def test_previous_is_on_mention_rate_and_share_of_voice_only(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    plain = await competitors_body(seeded, api)
    body = await competitors_body(seeded, api, compare="previous_period")

    for row in plain["data"]:
        for item in row["by_engine"]:
            assert all("previous" not in value for value in item.values() if type(value) is dict)
    own = entry(row_of(body, seeded.own), CHATGPT)
    rival = entry(row_of(body, seeded.rival), CHATGPT)
    # The window before holds answer 9 alone: the own brand named, valid.
    assert own["mention_rate"]["previous"] == {
        "value": 1.0,
        "numerator": 1.0,
        "denominator": 1,
        "n_observations": 1,
        "pooled": {"successes": 1, "trials": 1},
    }
    assert counts(own["share_of_voice"]["previous"]) == (1, 1, 1)
    assert counts(rival["mention_rate"]["previous"]) == (0, 1, 1)
    assert counts(rival["share_of_voice"]["previous"]) == (0, 1, 1)
    for item in (own, rival):
        assert "previous" not in item["citation_share"]
        assert "previous" not in item["recommendation_rate"]
    # Gemini had no answer there: the key is there, null.
    for row in body["data"]:
        gemini = entry(row, GEMINI)
        assert gemini["mention_rate"]["previous"] is None
        assert gemini["share_of_voice"]["previous"] is None
    assert body["meta"]["previous_answers"] == 1
    assert body["meta"]["compare_window"]["to"] < body["meta"]["window"]["from"]


async def test_the_top_competitor_flag_is_per_engine(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    named = await competitors_body(seeded, api)
    # The rival is no longer named in the one Gemini answer.
    await execute(
        migrated,
        "DELETE FROM ai.entity_mentions WHERE project_id = $1 AND engine_code = $2 "
        "AND entity_id = $3",
        seeded.project.id,
        GEMINI,
        seeded.rival,
    )

    body = await competitors_body(seeded, api)

    assert (top_of(named, CHATGPT), top_of(named, GEMINI)) == ([RIVAL_NAME], [RIVAL_NAME])
    assert (top_of(body, CHATGPT), top_of(body, GEMINI)) == ([RIVAL_NAME], [])
    # The rival has no share there: a competitor with a numerator of 0 is not the top one.
    assert entry(row_of(body, seeded.rival), GEMINI)["share_of_voice"]["numerator"] == 0
    # The own entity never is, whatever its numbers.
    assert entry(row_of(body, seeded.own), GEMINI)["share_of_voice"]["numerator"] > 0
    assert not any(
        entry(row_of(body, seeded.own), code)["is_top_competitor"] for code in (CHATGPT, GEMINI)
    )


async def test_no_top_competitor_when_no_competitor_was_named(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """The prompts of ChatGPT that name nobody but the own brand: `pricing` and `misc`."""
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = ANY($1::uuid[])",
        [seeded.prompts["pricing"].id, seeded.prompts["misc"].id],
    )

    body = await competitors_body(seeded, api, **{"filter[country_iso]": "IN"})

    assert top_of(body, CHATGPT) == []
    assert entry(row_of(body, seeded.rival), CHATGPT)["share_of_voice"]["numerator"] == 0
    assert entry(row_of(body, seeded.own), CHATGPT)["share_of_voice"]["numerator"] == 1


async def test_entity_ids_narrow_the_rows_and_a_foreign_id_is_left_out_and_is_200(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    other = await make_workspace(migrated)
    other_project = await make_project(migrated, other.id)
    foreign = await _entity(
        migrated,
        replace(seeded.project, workspace_id=other.id, id=other_project),
        "Foreign",
        "foreign.example",
        "competitor",
    )
    elsewhere = await _entity(
        migrated,
        replace(seeded.project, id=await make_project(migrated, seeded.workspace.id)),
        "Elsewhere",
        "elsewhere.example",
        "competitor",
    )
    plain = await competitors_body(seeded, api)

    rival = await competitors_body(seeded, api, entity_ids=str(seeded.rival))
    both = await competitors_body(seeded, api, entity_ids=f"{seeded.rival},{seeded.own}")
    unknown = await get_competitors(
        seeded,
        api,
        entity_ids=",".join(str(i) for i in (foreign, elsewhere, uuid.uuid4())),
    )
    mixed = await competitors_body(seeded, api, entity_ids=f"{foreign},{seeded.rival},{elsewhere}")

    assert names(rival) == names(mixed) == [RIVAL_NAME]
    # Own first, as the tracked set orders them, whatever the order asked for.
    assert names(both) == [OWN_NAME, RIVAL_NAME]
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["data"] == []
    # The entity set share of voice is over is the whole one, and a row's numbers do not change.
    assert rival["meta"]["entities"] == plain["meta"]["entities"]
    assert rival["data"][0] == row_of(plain, seeded.rival)


async def test_at_most_twenty_entities_own_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The own brand, CyberNX and twenty more competitors: 22 tracked; rows for the own brand and
    the first 19 competitors by name, the set share of voice is over listed whole."""
    world = await new_world(resources, migrated)
    extra = [
        await _entity(
            migrated, world.project, f"Rival {n:02d}", f"rival{n:02d}.example", "competitor"
        )
        for n in range(1, 21)
    ]
    world = replace(world, prompts=await new_prompts(migrated, world, ["x"]))

    body = await competitors_body(world, api)

    assert [row["entity"]["entity_id"] for row in body["data"]] == [
        str(entity) for entity in (world.own, world.rival, *extra[:18])
    ]
    assert len(body["meta"]["entities"]) == 22


async def test_branded_prompts_are_left_out_by_default_and_counted_when_asked(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The branded prompt has two answers that name the own brand, one of them citing the own
    page: the default scope must not see them in any member."""
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("brand", OWN_ONLY, (OWN_PAGE,), 1)]
    )

    default = await competitors_body(seeded, api)
    with_branded = await competitors_body(seeded, api, include_branded="true")
    branded = await competitors_body(seeded, api, branded_only="true")

    def at(body: dict[str, Any], entity: uuid.UUID) -> dict[str, Any]:
        return entry(row_of(body, entity), CHATGPT)

    assert counts(at(default, seeded.own)["mention_rate"]) == (pytest.approx(1.4), 3, 8)
    assert counts(at(default, seeded.own)["citation_share"]) == (3, 7, 7)
    assert counts(at(default, seeded.own)["share_of_voice"]) == (2.5, 4, 8)
    assert default["meta"]["include_branded"] is False
    # Two answers more name the own brand alone: 1.4 + 1 over 4 prompts.
    assert counts(at(with_branded, seeded.own)["mention_rate"]) == (pytest.approx(2.4), 4, 10)
    assert counts(at(with_branded, seeded.own)["citation_share"]) == (4, 8, 9)
    assert counts(at(with_branded, seeded.own)["share_of_voice"]) == (4.5, 6, 10)
    assert counts(at(with_branded, seeded.rival)["mention_rate"]) == (pytest.approx(0.4), 4, 10)
    assert counts(at(with_branded, seeded.rival)["citation_share"]) == (2, 8, 9)
    assert at(with_branded, seeded.own)["mention_rate"]["filters"]["include_branded"] is True
    # Branded only: the one prompt, both answers name the own brand, one cites its page.
    assert counts(at(branded, seeded.own)["mention_rate"]) == (1, 1, 2)
    assert counts(at(branded, seeded.rival)["mention_rate"]) == (0, 1, 2)
    assert counts(at(branded, seeded.own)["citation_share"]) == (1, 1, 2)
    assert counts(at(branded, seeded.rival)["citation_share"]) == (0, 1, 2)
    assert branded["meta"]["branded_only"] is True


async def test_the_term_subtree_and_the_country_filter_scope_every_member(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """Managed SOC (the prompts `providers` and `pricing`) is put under a new term Security: a
    filter on Security keeps the prompts given any term below it, `misc` stays out."""
    soc = seeded.topics["soc"]
    parent = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "SELECT workspace_id, vocabulary_id, 'Security', 'security', 'security' "
        "FROM core.taxonomy_terms WHERE id = $1 RETURNING id",
        soc,
    )
    await execute(
        migrated,
        "UPDATE core.taxonomy_terms SET parent_id = $2, path = 'security/managed-soc' "
        "WHERE id = $1",
        soc,
        parent["id"],
    )

    for term in (soc, parent["id"]):
        body = await competitors_body(seeded, api, **{"filter[term]": str(term)})

        for entity in (seeded.own, seeded.rival):
            item = entry(row_of(body, entity), CHATGPT)
            # Providers 2/5 and pricing 0/1 over 2 prompts, 6 valid answers of 7.
            assert counts(item["mention_rate"]) == (pytest.approx(0.4), 2, 7), term
            assert item["mention_rate"]["pooled"] == {"successes": 2, "trials": 6}
            assert counts(item["share_of_voice"]) == (1.5, 3, 7), term
            # Own 2, rival 2 and third party 2 units: the citation of `misc` is not counted.
            assert counts(item["citation_share"])[1:] == (6, 6), term
        assert counts(entry(row_of(body, seeded.own), CHATGPT)["citation_share"])[0] == 2
        assert entry(row_of(body, seeded.own), CHATGPT)["mention_rate"]["filters"][
            "term_id"
        ] == str(term)

    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["providers"].id,
    )

    india = await competitors_body(seeded, api, **{"filter[country_iso]": "IN"})
    france = await competitors_body(seeded, api, **{"filter[country_iso]": "FR"})
    gemini = await competitors_body(seeded, api, **{"filter[engine_code_in]": GEMINI})

    for entity, units in ((seeded.own, 2), (seeded.rival, 1)):
        item = entry(row_of(india, entity), CHATGPT)
        # Providers alone: 2/5 over 1 prompt, 6 answers; units own 2, rival 1, third party 2.
        assert counts(item["mention_rate"]) == (pytest.approx(0.4), 1, 6)
        assert counts(item["citation_share"]) == (units, 5, 5)
        assert item["mention_rate"]["filters"]["country_iso"] == "IN"
    # No prompt in that market: counts of zero and no value, never a rate of 0.
    for row in france["data"]:
        for item in row["by_engine"]:
            assert counts(item["mention_rate"]) == (0, 0, 0)
            assert item["mention_rate"]["value"] is None
            assert counts(item["citation_share"]) == (0, 0, 0)
            assert item["citation_share"]["value"] is None
            assert not item["is_top_competitor"]
    assert [item["engine_code"] for item in gemini["data"][0]["by_engine"]] == [GEMINI]


async def test_another_projects_citations_are_not_counted(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today and cite a
    page whose role is the rival entity: nothing of the rows, units or meta moves."""
    before = await get_competitors(seeded, api, compare="previous_period", include_branded="true")
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)
    await execute(
        migrated,
        "UPDATE ai.citations SET role_entity_id = $2, domain_role = 'competitor' "
        "WHERE project_id <> $1",
        seeded.project.id,
        seeded.rival,
    )
    spoofed = await fetchrow(
        migrated, "SELECT count(*) AS n FROM ai.citations WHERE role_entity_id = $1", seeded.rival
    )
    assert spoofed["n"] >= 4

    after = await get_competitors(seeded, api, compare="previous_period", include_branded="true")

    assert after.json() == before.json()


async def test_a_deleted_project_is_not_found(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    assert problem(await get_competitors(seeded, api)) == (404, "not_found")


async def test_a_member_of_another_workspace_does_not_see_the_rows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    outsider: Caller = await member(resources, migrated, await make_workspace(migrated), "owner")

    response = await api.get(
        project_url(seeded.workspace, seeded.project.id, "ai", "competitors"),
        headers=outsider.headers,
    )

    assert problem(response) == (404, "not_found")
