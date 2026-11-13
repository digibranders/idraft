"""The country breakdown (contract C2, change log C-7 and C-11): `group_by=country` adds
`by_country`, one entry for each market (`country_iso`) of the prompts in scope, sorted by code,
with the engines built as a topic row of those prompts. Worked by hand from the seeded world of
`test_prompts_summary` (see the docstring of its `summary` fixture): the prompts in scope are
`providers`, `pricing` and `misc`, all of the market US until a test moves them. On ChatGPT
`providers` has 2 of 5 valid answers (6 counted) naming the own brand and citing the own domain,
`pricing` 0 of 1 and `misc` 1 of 1; Gemini answered `providers` once (both brands named, own page
cited); the branded prompt `brand` has 1 valid answer naming the own brand with nothing cited."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    Summary,
    answer_in_another_project,
    cell,
    entity_cell,
    full_project,
    get_summary,
    mention_every_answer,
    pooled,
    statements,
    summary_data,
)
from tests.api.ai.test_summary_pooling import (
    _base_week,
    _pool,
    _project,
    _series,
    _span,
    _wednesday,
    _write_answers,
)
from tests.api.auth.support import execute, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import add_prompt
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

GROUP = {"group_by": "country"}
BELOW = 10


async def _market(migrated: PostgresServer, world: Summary, name: str, country: str | None) -> None:
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = $2 WHERE id = $1",
        world.prompts[name].id,
        country,
    )


def _countries(data: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """The engines of each entry of `by_country`, by country and engine code."""
    return {
        entry["country_iso"]: {engine["engine_code"]: engine for engine in entry["engines"]}
        for entry in data["by_country"]
    }


async def test_by_country_has_one_entry_per_market_of_the_prompts(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """`pricing` is Indian, `providers` stays American and `misc` has no market: it is in no
    entry, though it is a prompt in scope. The entries are sorted by code, not by the order the
    prompts were made in (`providers` is the older one)."""
    await _market(migrated, seeded, "pricing", "IN")
    await _market(migrated, seeded, "misc", None)

    data = await summary_data(seeded, api, include="total", **GROUP)

    assert [entry["country_iso"] for entry in data["by_country"]] == ["IN", "US"]
    assert data["total"]["prompt_count"] == 3
    assert len(data["prompts"]) == 3
    engines = _countries(data)
    # Indian prompts: `pricing` alone, nobody named in its one valid answer.
    assert list(engines["IN"]) == [CHATGPT, GEMINI]
    india = engines["IN"][CHATGPT]
    assert cell(india["mentioned"]) == (0, 1, 1)
    assert pooled(india["mentioned"]) == (0, 1)
    assert cell(india["share_of_voice"]) == (0, 0, 1)
    assert cell(engines["IN"][GEMINI]["mentioned"]) == (0, 0, 0)
    # American prompts: `providers` alone (`misc`, whose 1 of 1 would make 1.4 of 2, is nowhere).
    states = engines["US"][CHATGPT]
    assert cell(states["mentioned"]) == (pytest.approx(0.4), 1, 6)
    assert pooled(states["mentioned"]) == (2, 5)
    assert cell(states["cited"]) == (pytest.approx(0.4), 1, 6)
    assert cell(states["share_of_voice"]) == (pytest.approx(1.5), 3, 6)
    assert cell(engines["US"][GEMINI]["mentioned"]) == (1, 1, 1)
    assert cell(engines["US"][GEMINI]["share_of_voice"]) == (0.5, 1, 1)


async def test_a_country_entry_is_aggregated_as_a_topic_row(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """All three prompts are American: the one entry is the total, a topic row of every prompt
    in scope (prompt weighted: 2/5 + 0/1 + 1/1 over 3 prompts, 7 valid answers, 8 counted)."""
    data = await summary_data(seeded, api, include="total", **GROUP)

    [entry] = data["by_country"]
    assert entry["country_iso"] == "US"
    assert set(entry) == {"country_iso", "engines"}
    chatgpt = _countries(data)["US"][CHATGPT]
    assert cell(chatgpt["mentioned"]) == (pytest.approx(1.4), 3, 8)
    assert pooled(chatgpt["mentioned"]) == (3, 7)
    assert cell(chatgpt["share_of_voice"]) == (pytest.approx(2.5), 4, 8)
    assert chatgpt["share_of_voice"]["pooled"] is None
    assert entry["engines"] == data["total"]["engines"]


async def test_the_market_of_the_prompt_decides_not_the_location_of_the_answer(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """The answers were all fetched for the engines' one location, whatever the market of the
    prompt: moving a prompt to another market moves its cells with it."""
    before = await summary_data(seeded, api, **GROUP)
    await _market(migrated, seeded, "providers", "DE")

    after = await summary_data(seeded, api, **GROUP)

    assert list(_countries(before)) == ["US"]
    assert list(_countries(after)) == ["DE", "US"]
    assert cell(_countries(after)["DE"][CHATGPT]["mentioned"]) == (pytest.approx(0.4), 1, 6)
    # `pricing` 0 of 1 and `misc` 1 of 1: two prompts, one of them always named.
    assert cell(_countries(after)["US"][CHATGPT]["mentioned"]) == (1, 2, 2)


async def test_a_country_with_prompts_and_no_answers_has_an_entry_of_zero_cells(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await add_prompt(migrated, seeded.project, "Quels sont les meilleurs SOC geres?", country="FR")

    data = await summary_data(seeded, api, **GROUP)

    assert list(_countries(data)) == ["FR", "US"]
    for engine in _countries(data)["FR"].values():
        assert engine["mentioned"]["value"] is None
        assert cell(engine["mentioned"]) == (0, 0, 0)
        assert pooled(engine["mentioned"]) == (0, 0)
        assert cell(engine["share_of_voice"]) == (0, 0, 0)
    assert list(_countries(data)["FR"]) == [CHATGPT, GEMINI]


async def test_filter_country_leaves_one_entry(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await _market(migrated, seeded, "pricing", "IN")
    everything = await summary_data(seeded, api, **GROUP)

    india = await summary_data(seeded, api, **GROUP, **{"filter[country_iso]": "IN"})
    states = await summary_data(seeded, api, **GROUP, **{"filter[country_iso]": "US"})
    nowhere = await summary_data(seeded, api, **GROUP, **{"filter[country_iso]": "FR"})

    assert [entry["country_iso"] for entry in india["by_country"]] == ["IN"]
    assert [entry["country_iso"] for entry in states["by_country"]] == ["US"]
    # The entry is the one the unfiltered summary has; a market with no prompt has none, and the
    # block is still there (asked for, and empty).
    by_code = {entry["country_iso"]: entry for entry in everything["by_country"]}
    assert india["by_country"] == [by_code["IN"]]
    assert states["by_country"] == [by_code["US"]]
    assert nowhere["by_country"] == []


async def test_by_country_follows_branded_term_and_engine_scope(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    def chatgpt(data: dict[str, Any]) -> dict[str, Any]:
        engine: dict[str, Any] = _countries(data)["US"][CHATGPT]
        return engine

    default = await summary_data(seeded, api, **GROUP)
    branded = await summary_data(seeded, api, include_branded="true", **GROUP)
    alone = await summary_data(seeded, api, branded_only="true", **GROUP)
    managed = await summary_data(
        seeded, api, **GROUP, **{"filter[term]": str(seeded.topics["soc"])}
    )
    compliance = await summary_data(
        seeded, api, **GROUP, **{"filter[term]": str(seeded.topics["compliance"])}
    )
    gemini = await summary_data(seeded, api, **GROUP, **{"filter[engine_code_in]": GEMINI})

    # The branded prompt and the archived one are in the default scope of no entry.
    assert cell(chatgpt(default)["mentioned"]) == (pytest.approx(1.4), 3, 8)
    # With the branded prompt: its 1 of 1 joins, and only its own brand is named.
    assert cell(chatgpt(branded)["mentioned"]) == (pytest.approx(2.4), 4, 9)
    assert pooled(chatgpt(branded)["mentioned"]) == (4, 8)
    assert cell(chatgpt(alone)["mentioned"]) == (1, 1, 1)
    assert cell(chatgpt(alone)["cited"]) == (0, 1, 1)
    # Managed SOC holds `providers` and `pricing` (misc has no topic), Compliance `providers`.
    assert cell(chatgpt(managed)["mentioned"]) == (pytest.approx(0.4), 2, 7)
    assert pooled(chatgpt(managed)["mentioned"]) == (2, 6)
    assert cell(chatgpt(compliance)["mentioned"]) == (pytest.approx(0.4), 1, 6)
    # Only Gemini is shown, in the entry as in every row.
    assert list(_countries(gemini)["US"]) == [GEMINI]
    assert cell(_countries(gemini)["US"][GEMINI]["mentioned"]) == (1, 1, 1)


async def test_by_country_carries_previous_when_compared(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """The window before holds answer 9 alone (`providers`, ChatGPT, American): the Indian entry
    has no answer there, so its `previous` is null (C-2), and so are the entities' of both."""
    await _market(migrated, seeded, "pricing", "IN")

    data = await summary_data(seeded, api, include="entities", compare="previous_period", **GROUP)

    engines = _countries(data)
    states = engines["US"][CHATGPT]
    assert cell(states["previous"]["mentioned"]) == (1, 1, 1)
    assert pooled(states["previous"]["mentioned"]) == (1, 1)
    assert cell(states["previous"]["share_of_voice"]) == (1, 1, 1)
    assert engines["US"][GEMINI]["previous"] is None
    own = entity_cell(states, seeded.own)
    assert cell(own["previous"]["mentioned"]) == (1, 1, 1)
    for engine in engines["IN"].values():
        assert engine["previous"] is None
        assert all(entity["previous"] is None for entity in engine["entities"])


@pytest.mark.parametrize(
    "asked",
    [
        {},
        {"include": "entities"},
        {"include": "series"},
        {"include": "series,entities", "compare": "previous_period"},
    ],
    ids=str,
)
async def test_each_country_equals_a_filtered_total(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary, asked: dict[str, str]
) -> None:
    """`by_country[X]` is the total of the prompts of market X, block for block (`previous`,
    `series`, `entities`): the same engines under `filter[country_iso]=X` with `include=total`."""
    await _market(migrated, seeded, "pricing", "IN")
    include = ",".join([*asked.get("include", "").split(","), "total"]).lstrip(",")
    data = await summary_data(seeded, api, **{**asked, **GROUP})

    for iso in ("IN", "US"):
        filtered = await summary_data(
            seeded, api, **{**asked, "include": include}, **{"filter[country_iso]": iso}
        )
        [entry] = [entry for entry in data["by_country"] if entry["country_iso"] == iso]
        assert entry["engines"] == filtered["total"]["engines"], iso
    if "include" in asked:
        # The blocks are in the entries: the engines hold them as a topic row's do.
        engine = data["by_country"][0]["engines"][0]
        assert asked["include"].split(",")[0] in engine


@pytest.fixture
async def markets(resources: Resources, migrated: PostgresServer) -> tuple[Summary, date]:
    """Twenty prompts of one topic: `p1` to `p10` American and `q1` to `q10` Indian. Every prompt
    was answered in the week W-1 (`p1`, `p2`, `q1` and `q2` name the own brand). In the week W
    `p1` to `p9` were (`p1` to `p5` name it) and `p10` was not; `q1` to `q10` all were (`q1` to
    `q5` name it): the American numbers are the ten prompts of the pooling tests, and the Indian
    market is the one that has ten prompts answering."""
    us = [f"p{number}" for number in range(1, 11)]
    india = [f"q{number}" for number in range(1, 11)]
    world = await _project(resources, migrated, [*us, *india])
    for name in india:
        await _market(migrated, world, name, "IN")
    week = _base_week()
    await _write_answers(
        migrated,
        world,
        [(name, _wednesday(week, -1), name in ("p1", "p2", "q1", "q2")) for name in [*us, *india]]
        + [(name, _wednesday(week, 0), int(name[1:]) <= 5) for name in [*us[:9], *india]],
    )
    return world, week


async def test_country_weekly_points_pool_below_ten_prompts(
    api: httpx.AsyncClient, markets: tuple[Summary, date]
) -> None:
    world, week = markets
    window = _span(week - timedelta(weeks=1), week + timedelta(days=6))

    data = await summary_data(world, api, include="series", **GROUP, **window)

    engines = _countries(data)
    states_before, states_now = engines["US"][CHATGPT]["series"]
    india_before, india_now = engines["IN"][CHATGPT]["series"]
    # Ten American prompts answered in W-1: the week's own cells.
    assert (states_before["prompts"], states_before["is_pooled"]) == (10, False)
    assert cell(states_before["mentioned"]) == (2, 10, 10)
    # Nine answered in W: the point pools W-1 and W as the pooling tests of a topic work out:
    # p1 and p2 2 of 2, p3 to p5 1 of 2, p6 to p9 0 of 2, p10 0 of 1: 3.5 over 10 prompts.
    assert (states_now["prompts"], states_now["is_pooled"]) == (9, True)
    assert _pool(states_now) == (
        2,
        (week - timedelta(weeks=1)).isoformat(),
        (week + timedelta(days=6)).isoformat(),
        "few_prompts",
        BELOW,
    )
    assert cell(states_now["mentioned"]) == (3.5, 10, 19)
    assert pooled(states_now["mentioned"]) == (7, 19)
    # Ten Indian prompts answered in W: the week's own cells, as in W-1.
    assert (india_before["prompts"], india_before["is_pooled"]) == (10, False)
    assert (india_now["prompts"], india_now["is_pooled"]) == (10, False)
    assert "pool" not in india_now
    assert cell(india_now["mentioned"]) == (5, 10, 10)
    assert pooled(india_now["mentioned"]) == (5, 10)
    # Both equal the series of the same market asked for alone.
    filtered = await summary_data(
        world, api, include="series,total", **window, **{"filter[country_iso]": "US"}
    )
    assert _series(filtered["total"]) == [states_before, states_now]


async def test_a_country_with_few_prompts_pools_every_week(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """Two Dutch prompts answered in W-1 and W: each point holds the prompts that answered that
    week, under ten, so it pools: the first over the one week it can reach, the second over two."""
    world = await _project(resources, migrated, ["n1", "n2"])
    for name in ("n1", "n2"):
        await _market(migrated, world, name, "NL")
    week = _base_week()
    await _write_answers(
        migrated,
        world,
        [
            (name, _wednesday(week, offset), name == "n1")
            for name in ("n1", "n2")
            for offset in (-1, 0)
        ],
    )

    window = _span(week - timedelta(weeks=1), week + timedelta(days=6))

    data = await summary_data(world, api, include="series", **GROUP, **window)

    before, now = _countries(data)["NL"][CHATGPT]["series"]
    assert [point["prompts"] for point in (before, now)] == [2, 2]
    assert [point["pool"]["weeks"] for point in (before, now)] == [1, 2]
    assert [point["pool"]["reason"] for point in (before, now)] == ["few_prompts"] * 2
    assert cell(before["mentioned"]) == (1, 2, 2)
    assert cell(now["mentioned"]) == (1, 2, 4)
    assert pooled(now["mentioned"]) == (2, 4)


async def test_by_country_is_absent_unless_asked(api: httpx.AsyncClient, seeded: Summary) -> None:
    for params in (
        {},
        {"include": "series,entities,total,co_mentions"},
        {"compare": "previous_period", "rows": "none"},
    ):
        data = await summary_data(seeded, api, **params)

        assert "by_country" not in data, params
    assert "by_country" in await summary_data(seeded, api, **GROUP)


async def test_by_country_changes_nothing_else_in_the_response(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await _market(migrated, seeded, "pricing", "IN")
    every = {"include": "series,entities,total,co_mentions", "compare": "previous_period"}

    plain = await summary_data(seeded, api, **every)
    grouped = await summary_data(seeded, api, **every, **GROUP)

    assert {key: value for key, value in grouped.items() if key != "by_country"} == plain


async def test_rows_do_not_change_by_country(api: httpx.AsyncClient, seeded: Summary) -> None:
    every = await summary_data(seeded, api, **GROUP)

    for rows in ("topics", "none"):
        data = await summary_data(seeded, api, rows=rows, **GROUP)

        assert data["by_country"] == every["by_country"], rows
    assert (await summary_data(seeded, api, rows="none", **GROUP))["topics"] == []


@pytest.mark.parametrize(
    "value", ["language", "country,language", "Country", "region", ""], ids=repr
)
async def test_group_by_other_than_country_is_422(
    api: httpx.AsyncClient, seeded: Summary, value: str
) -> None:
    response = await get_summary(seeded, api, group_by=value)

    assert problem(response) == (422, "validation_failed")


async def test_group_by_language_is_422_and_says_it_is_not_built(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    response = await get_summary(seeded, api, group_by="language")

    assert problem(response) == (422, "validation_failed")
    [error] = response.json()["errors"]
    assert (error["location"], error["path"], error["code"]) == ("query", "group_by", "not_built")
    assert "language" in error["message"]
    assert "not built" in error["message"]
    assert "country" in error["message"]


async def test_another_projects_answers_are_not_in_a_country(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace, each with an American prompt
    answered inside the window: neither shows in the first project's entry."""
    before = await summary_data(seeded, api, include="entities", **GROUP)
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    after = await summary_data(seeded, api, include="entities", **GROUP)

    assert after == before


async def test_a_deleted_or_foreign_project_is_not_found_with_group_by(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    seeded: Summary,
) -> None:
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    url = project_url(seeded.workspace, seeded.project.id, "ai", "prompts-summary")

    foreign = await api.get(url, params=GROUP, headers=outsider.headers)
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )
    deleted = await get_summary(seeded, api, **GROUP)

    assert problem(foreign) == (404, "not_found")
    assert problem(deleted) == (404, "not_found")
    assert problem(await api.get(url, params=GROUP)) == (401, "unauthenticated")
    unknown = project_url(seeded.workspace, uuid.uuid4(), "ai", "prompts-summary")
    assert problem(await api.get(unknown, params=GROUP, headers=seeded.owner.headers)) == (
        404,
        "not_found",
    )


async def test_by_country_adds_no_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The entries are Python over the counts the rows read: `group_by=country` costs no
    statement, alone or beside every other block. A first read warms the session cache so each
    counted read starts alike."""
    world = await full_project(resources, migrated)
    await mention_every_answer(migrated, world)
    await get_summary(world, api)

    async def counted(**params: Any) -> int:
        with statements(resources) as seen:
            response = await get_summary(world, api, **params)
        assert response.status_code == 200, response.text
        return len(seen)

    every = {"include": "series,entities,total,co_mentions", "compare": "previous_period"}
    plain = await counted()

    assert await counted(**GROUP) - plain == 0
    assert await counted(**every, **GROUP) == await counted(**every)
    assert await counted(rows="none", **GROUP) - plain == -2
    data = await summary_data(world, api, **GROUP)
    [entry] = data["by_country"]
    assert entry["country_iso"] == "US"
    for engine in entry["engines"]:
        # Every answer names the own brand: 150 prompts, 8 answers each.
        assert cell(engine["mentioned"]) == (150, 150, 1200)
