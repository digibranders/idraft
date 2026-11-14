"""Compare with the period before (contract C2, change log C-1 and C-2): `compare` puts
`previous` beside the cells of every row, over a window of as many days just before the window,
a year before it, or two dates the caller names. Worked by hand from the seeded world of
`test_prompts_summary` (see the docstring of its `summary` fixture): the only answer in the
window before the default one is answer 9, 28 days old, on ChatGPT for `providers`."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    REFUSAL,
    Answer,
    Summary,
    answer_in_another_project,
    cell,
    day,
    entity_cell,
    full_project,
    get_summary,
    ingested,
    mention_every_answer,
    pooled,
    prompt_row,
    statements,
    summary_data,
    topic_row,
)
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import problem
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import at_now, fetched_ai_task
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

seeded = summary_support.seeded

NEITHER_LONG = "Several firms run managed SOC services in India with 24x7 monitoring."
OUTCOME_NAMES = ("mentioned_and_cited", "mentioned_only", "cited_only", "neither")


async def test_compare_puts_the_window_before_beside_each_cell(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, compare="previous_period")

    assert data["compare_window"] == {"from": day(55), "to": day(28), "timezone": "UTC"}
    chatgpt, gemini = prompt_row(data, seeded, "providers")["engines"]
    # The window before holds answer 9 alone, 28 days old: the own brand named and cited.
    before = chatgpt["previous"]
    assert cell(before["mentioned"]) == (1, 1, 1)
    assert cell(before["cited"]) == (1, 1, 1)
    assert [before["outcomes"][name]["numerator"] for name in OUTCOME_NAMES] == [1, 0, 0, 0]
    assert cell(before["share_of_voice"]) == (1, 1, 1)
    # The current cells are those of the summary without compare.
    assert cell(chatgpt["mentioned"]) == (2, 5, 6)
    # No answer in the window before: null, never a rate of 0. The key is there.
    assert "previous" in gemini
    assert gemini["previous"] is None
    for engine in prompt_row(data, seeded, "pricing")["engines"]:
        assert engine["previous"] is None
    soc_chatgpt, soc_gemini = topic_row(data, "Managed SOC")["engines"]
    # Prompt weighted as the window is: `providers` 1 of 1; `pricing` has no answer there.
    assert cell(soc_chatgpt["previous"]["mentioned"]) == (1, 1, 1)
    assert pooled(soc_chatgpt["previous"]["mentioned"]) == (1, 1)
    assert soc_gemini["previous"] is None
    assert topic_row(data, None)["engines"][0]["previous"] is None


async def test_previous_answers_is_the_valid_answers_of_the_window_before(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, compare="previous_period")
    gemini_only = await summary_data(
        seeded, api, compare="previous_period", **{"filter[engine_code_in]": GEMINI}
    )

    assert data["previous_answers"] == 1
    # Counted over the engines shown: Gemini had no answer in the window before.
    assert gemini_only["previous_answers"] == 0
    assert gemini_only["compare_window"] == data["compare_window"]


async def test_previous_answers_leave_out_an_engine_that_is_not_shown(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A valid Gemini answer in the window before, and Gemini turned off with no current answer
    left: the engine is not one of those shown, so its answer is not in `previous_answers`, as
    it is in no cell (C-2)."""
    when = datetime.now(UTC).replace(microsecond=0) - timedelta(days=28)
    await fetched_ai_task(
        worker_db,
        migrated,
        seeded.project,
        seeded.prompts["providers"],
        at_now(FIXTURES / "captured" / "gemini_scraper_answer.json", when),
        import_store,
        engine_code=GEMINI,
        fetched_at=when,
    )
    await ingest(worker_db, import_store)
    shown = await summary_data(seeded, api, compare="previous_period")
    assert shown["engine_codes"] == [CHATGPT, GEMINI]
    assert shown["previous_answers"] == 2
    await execute(
        migrated,
        "UPDATE ai.project_engines SET is_enabled = false "
        "WHERE project_id = $1 AND engine_code = $2",
        seeded.project.id,
        GEMINI,
    )
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET is_current = false "
        "WHERE project_id = $1 AND engine_code = $2 AND observed_at > now() - interval '27 days'",
        seeded.project.id,
        GEMINI,
    )

    data = await summary_data(seeded, api, compare="previous_period")

    assert data["engine_codes"] == [CHATGPT]
    assert data["previous_answers"] == 1


async def test_an_explicit_window_is_compared_with_as_many_days_before_it(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(
        seeded, api, compare="previous_period", **{"from": day(20), "to": day(10)}
    )

    assert data["compare_window"] == {"from": day(31), "to": day(21), "timezone": "UTC"}
    chatgpt = prompt_row(data, seeded, "providers")["engines"][0]
    # Days 20 to 10 ago hold answers 5 (own page cited) and 6 (a refusal); 31 to 21 hold answer 9.
    assert cell(chatgpt["mentioned"]) == (0, 1, 2)
    assert cell(chatgpt["cited"]) == (1, 1, 2)
    assert cell(chatgpt["previous"]["mentioned"]) == (1, 1, 1)


async def test_previous_year_states_its_window_and_has_no_data(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    fixed = await summary_data(
        seeded, api, compare="previous_year", **{"from": "2026-10-17", "to": "2026-11-13"}
    )
    default = await summary_data(seeded, api, compare="previous_year")

    assert fixed["compare_window"] == {"from": "2025-10-17", "to": "2025-11-13", "timezone": "UTC"}
    assert fixed["previous_answers"] == 0
    # The seeded answers are weeks old, none a year: every `previous` is null, and it is a 200.
    assert default["previous_answers"] == 0
    engines = [e for row in (*default["prompts"], *default["topics"]) for e in row["engines"]]
    assert engines
    assert all(engine["previous"] is None for engine in engines)
    assert cell(prompt_row(default, seeded, "providers")["engines"][0]["mentioned"]) == (2, 5, 6)


async def test_a_custom_compare_window_reads_the_day_of_answer_9(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    custom = {"compare_from": day(28), "compare_to": day(28)}

    data = await summary_data(seeded, api, **custom)
    overriding = await summary_data(seeded, api, compare="previous_year", **custom)

    # `compare` is not asked, and the dates alone compare: they override whatever it says.
    for found in (data, overriding):
        assert found["compare_window"] == {"from": day(28), "to": day(28), "timezone": "UTC"}
        assert found["previous_answers"] == 1
        chatgpt = prompt_row(found, seeded, "providers")["engines"][0]
        assert cell(chatgpt["previous"]["mentioned"]) == (1, 1, 1)
        assert cell(chatgpt["previous"]["cited"]) == (1, 1, 1)
    # Any position and length: here a window after the one asked, holding the whole default one,
    # whose 8 valid answers are `providers` 5 and Gemini 1, `pricing` 1 and `misc` 1.
    after = await summary_data(
        seeded,
        api,
        **{"from": day(60), "to": day(40), "compare_from": day(27), "compare_to": day(0)},
    )
    assert after["previous_answers"] == 8


async def test_an_engine_with_answers_but_none_valid_has_zero_cells_not_null(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A refusal of `pricing` in the window before: the engine has a fact row there, so it has
    cells with a denominator of 0 and no value, not null (C-2)."""
    await ingested(seeded, migrated, worker_db, import_store, [Answer("pricing", REFUSAL, (), 28)])

    data = await summary_data(seeded, api, compare="previous_period")

    chatgpt, gemini = prompt_row(data, seeded, "pricing")["engines"]
    previous = chatgpt["previous"]
    assert previous is not None
    assert previous["mentioned"]["value"] is None
    assert cell(previous["mentioned"]) == (0, 0, 1)
    assert [cell(previous["outcomes"][name]) for name in OUTCOME_NAMES] == [(0, 0, 1)] * 4
    assert cell(previous["share_of_voice"]) == (0, 0, 1)
    assert gemini["previous"] is None
    # The topic holds `providers` (1 of 1) and `pricing` (no valid answer: not one of its prompts).
    soc = topic_row(data, "Managed SOC")["engines"][0]["previous"]
    assert cell(soc["mentioned"]) == (1, 1, 2)
    assert pooled(soc["mentioned"]) == (1, 1)
    # A refusal is not a valid answer.
    assert data["previous_answers"] == 1


async def test_entity_previous_cells_follow_the_engine_previous(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, compare="previous_period", include="entities")

    chatgpt, gemini = prompt_row(data, seeded, "providers")["engines"]
    own, rival = (entity_cell(chatgpt, entity) for entity in (seeded.own, seeded.rival))
    # Answer 9 names the own brand alone: 1 of 1 for it, and the rival is 0 of 1, a real rate.
    assert cell(own["previous"]["mentioned"]) == (1, 1, 1)
    assert cell(own["previous"]["share_of_voice"]) == (1, 1, 1)
    assert cell(rival["previous"]["mentioned"]) == (0, 1, 1)
    assert cell(rival["previous"]["share_of_voice"]) == (0, 1, 1)
    assert rival["previous"]["mentioned"]["value"] == 0
    # Where the engine's `previous` is null the entities' are null, and present.
    assert gemini["previous"] is None
    for entity in (seeded.own, seeded.rival):
        found = entity_cell(gemini, entity)
        assert "previous" in found
        assert found["previous"] is None
    for engine in prompt_row(data, seeded, "pricing")["engines"]:
        assert all(entity["previous"] is None for entity in engine["entities"])
    # A topic row weights as the window does: `providers` alone has an answer there.
    soc = topic_row(data, "Managed SOC")["engines"][0]
    assert cell(entity_cell(soc, seeded.own)["previous"]["mentioned"]) == (1, 1, 1)
    assert cell(entity_cell(soc, seeded.rival)["previous"]["mentioned"]) == (0, 1, 1)
    # Entity cells without include=entities are not there, with or without compare.
    plain = await summary_data(seeded, api, compare="previous_period")
    assert "entities" not in prompt_row(plain, seeded, "providers")["engines"][0]


async def test_without_compare_nothing_is_added(api: httpx.AsyncClient, seeded: Summary) -> None:
    for params in ({}, {"compare": "none"}):
        data = await summary_data(seeded, api, include="entities", **params)
        assert "compare_window" not in data
        assert "previous_answers" not in data
        for row in [*data["prompts"], *data["topics"]]:
            for engine in row["engines"]:
                assert "previous" not in engine
                assert engine["entities"]
                assert all("previous" not in entity for entity in engine["entities"])


async def test_previous_excludes_branded_prompts_by_default(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A branded prompt answered in the window before: out of it, as out of the window."""
    await ingested(seeded, migrated, worker_db, import_store, [Answer("brand", OWN_ONLY, (), 28)])

    default = await summary_data(seeded, api, compare="previous_period")
    branded = await summary_data(seeded, api, compare="previous_period", include_branded="true")

    assert default["previous_answers"] == 1
    assert branded["previous_answers"] == 2
    assert cell(prompt_row(branded, seeded, "brand")["engines"][0]["previous"]["mentioned"]) == (
        1,
        1,
        1,
    )
    untopiced = topic_row(default, None)["engines"][0]
    assert untopiced["previous"] is None
    assert cell(topic_row(branded, None)["engines"][0]["previous"]["mentioned"]) == (1, 1, 1)


async def test_previous_follows_the_term_subtree(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """`pricing` (Managed SOC only) and `misc` (no topic) answered in the window before: they are
    in the scope of Managed SOC and of no filter respectively, never in that of Compliance."""
    await ingested(
        seeded,
        migrated,
        worker_db,
        import_store,
        [Answer("pricing", NEITHER_LONG, (), 28), Answer("misc", OWN_ONLY, (), 28)],
    )

    everything = await summary_data(seeded, api, compare="previous_period")
    compliance = await summary_data(
        seeded, api, compare="previous_period", **{"filter[term]": str(seeded.topics["compliance"])}
    )
    soc = await summary_data(
        seeded, api, compare="previous_period", **{"filter[term]": str(seeded.topics["soc"])}
    )

    assert everything["previous_answers"] == 3
    assert compliance["previous_answers"] == 1
    assert soc["previous_answers"] == 2
    assert [row["prompt_id"] for row in compliance["prompts"]] == [
        str(seeded.prompts["providers"].id)
    ]
    assert cell(topic_row(compliance, "Compliance")["engines"][0]["previous"]["mentioned"]) == (
        1,
        1,
        1,
    )


async def test_another_projects_answers_are_not_in_the_previous_window(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace, each answered in the window
    before: neither shows in the first project's compared summary."""
    before = await summary_data(seeded, api, compare="previous_period", include="entities")
    assert before["previous_answers"] == 1
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 28
        )
    await ingest(worker_db, import_store)

    after = await summary_data(seeded, api, compare="previous_period", include="entities")

    assert after == before


async def test_a_deleted_project_is_not_found_with_compare(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    previous = await get_summary(seeded, api, compare="previous_period")
    custom = await get_summary(seeded, api, compare_from=day(30), compare_to=day(28))

    assert problem(previous) == (404, "not_found")
    assert problem(custom) == (404, "not_found")


async def test_compare_adds_one_statement_and_one_more_with_the_entity_cells(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Every window and option is one grouped query: the window before is one more, and with
    the entity cells its entity counts are one more again, not one per prompt (C-2). A first read
    warms the session cache so each counted read starts alike."""
    world = await full_project(resources, migrated)
    await mention_every_answer(migrated, world)
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    plain = await counted()
    entities = await counted(include="entities")

    assert entities - plain == 1
    assert await counted(compare="previous_period") - plain == 1
    assert await counted(compare="previous_year") - plain == 1
    assert await counted(compare_from=day(40), compare_to=day(30)) - plain == 1
    assert await counted(compare="previous_period", include="entities") - entities == 2
    # The 8 answers of each prompt are 0 to 21 days old: none is in the window before.
    data = await summary_data(world, api, compare="previous_period")
    assert data["previous_answers"] == 0
    assert data["prompts"][0]["engines"][0]["previous"] is None
    assert all(engine["previous"] is None for engine in data["topics"][0]["engines"])
