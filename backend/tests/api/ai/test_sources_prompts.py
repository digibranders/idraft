"""Prompts with no own page (WP-14 T7; BE-SOURCES-20): per prompt and engine of the counted
answers, how many cite an own page, the own citation units, the own pages and the one with the
most units. Keyset pages `(prompt_id, engine_code)`, a cursor bound to its filters. The expected
numbers are worked out by hand from the answers below."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    GUIDE,
    OWN,
    OWN_BLOG,
    Cite,
    World,
    answer,
    forged_cursor,
    full_project,
    make_world,
    page_ids,
    statements,
)
from tests.api.auth.support import execute
from tests.api.entities.support import problem
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

NOT_FOUND = (404, "not_found")
INVALID_CURSOR = (400, "invalid_cursor")
ROW_KEYS = {
    "prompt_id",
    "engine_code",
    "answers",
    "answers_citing_own",
    "own_citation_units",
    "own_pages",
    "top_own_page",
}


@dataclass(frozen=True)
class Scene:
    world: World
    a: Prompt
    b: Prompt
    c: Prompt


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Prompt A: two ChatGPT answers, the first citing the own page twice (one unit) and the own
    blog, the second the own page once, and a Gemini answer citing only the guide. Prompt B: a
    ChatGPT answer citing only the guide. Prompt C: a Gemini answer citing nothing."""
    world = await make_world(resources, migrated)
    a = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    b = await add_prompt(migrated, world.project, "How much does a SOC cost?")
    c = await add_prompt(migrated, world.project, "What is a SOC?")
    own, blog = world.own_cite(), world.own_cite(OWN_BLOG)
    await answer(migrated, world, a, days_ago=1, cites=[own, own, blog])
    await answer(migrated, world, a, days_ago=2, cites=[own, Cite(GUIDE)])
    await answer(migrated, world, a, days_ago=2, engine="gemini_web", cites=[Cite(GUIDE)])
    await answer(migrated, world, b, days_ago=1, cites=[Cite(GUIDE)])
    await answer(migrated, world, c, days_ago=1, engine="gemini_web")
    return Scene(world, a, b, c)


async def _prompts(world: World, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    return await api.get(
        world.url("ai", "sources", "prompts"), params=params, headers=world.owner.headers
    )


def _rows(response: httpx.Response) -> dict[tuple[str, str], dict[str, Any]]:
    assert response.status_code == 200, response.text
    return {(row["prompt_id"], row["engine_code"]): row for row in response.json()["data"]}


def _pairs(response: httpx.Response) -> list[tuple[str, str]]:
    assert response.status_code == 200, response.text
    return [(row["prompt_id"], row["engine_code"]) for row in response.json()["data"]]


def _key(prompt: Prompt, engine: str) -> tuple[str, str]:
    return str(prompt.id), engine


async def test_each_prompt_and_engine_says_which_own_pages_it_cites(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    response = await _prompts(scene.world, api)

    row = _rows(response)[_key(scene.a, "chatgpt_web")]
    own_id, _ = await page_ids(migrated, OWN)
    assert row["answers"] == 2
    assert row["answers_citing_own"] == 2
    assert row["own_citation_units"] == 3
    assert row["own_pages"] == 2
    assert row["top_own_page"] == {"url_id": own_id, "url": OWN}
    assert set(row) == ROW_KEYS


async def test_a_prompt_citing_no_own_page_is_listed_with_zeros(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    rows = _rows(await _prompts(scene.world, api))

    for prompt, engine, answers in (
        (scene.b, "chatgpt_web", 1),
        (scene.c, "gemini_web", 1),
        (scene.a, "gemini_web", 1),
    ):
        row = rows[_key(prompt, engine)]
        assert (row["answers"], row["answers_citing_own"]) == (answers, 0), row
        assert (row["own_citation_units"], row["own_pages"]) == (0, 0), row
        assert row["top_own_page"] is None, row


async def test_an_engine_with_no_counted_answer_has_no_row(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """Four rows: prompt A on two engines, B and C on one: the engines nobody answered on are
    not listed as zero."""
    rows = _rows(await _prompts(scene.world, api))

    assert set(rows) == {
        _key(scene.a, "chatgpt_web"),
        _key(scene.a, "gemini_web"),
        _key(scene.b, "chatgpt_web"),
        _key(scene.c, "gemini_web"),
    }


async def test_filter_own_cited_false_keeps_the_prompts_with_no_own_page(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    without = _rows(await _prompts(scene.world, api, **{"filter[own_cited]": "false"}))
    cited = _rows(await _prompts(scene.world, api, **{"filter[own_cited]": "true"}))

    assert set(without) == {
        _key(scene.a, "gemini_web"),
        _key(scene.b, "chatgpt_web"),
        _key(scene.c, "gemini_web"),
    }
    assert set(cited) == {_key(scene.a, "chatgpt_web")}


async def test_rows_come_in_prompt_then_engine_order(api: httpx.AsyncClient, scene: Scene) -> None:
    pairs = _pairs(await _prompts(scene.world, api))

    assert len(pairs) == 4
    assert pairs == sorted(pairs)


async def test_prompt_pages_hold_every_row_once(api: httpx.AsyncClient, scene: Scene) -> None:
    every = _pairs(await _prompts(scene.world, api))
    walked: list[tuple[str, str]] = []
    cursor: str | None = None
    for _ in range(10):  # four rows at one a page is the most; a cursor that never ends fails
        params: dict[str, Any] = {"limit": 1} if cursor is None else {"limit": 1, "cursor": cursor}
        body = (await _prompts(scene.world, api, **params)).json()
        walked.extend((row["prompt_id"], row["engine_code"]) for row in body["data"])
        cursor = body["page"]["next_cursor"]
        assert body["page"]["has_more"] is (cursor is not None)
        if cursor is None:
            break

    assert cursor is None
    assert walked == every


async def test_a_prompts_cursor_is_bound_to_its_filters(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    first = await _prompts(scene.world, api, limit=1, **{"filter[own_cited]": "false"})
    cursor = first.json()["page"]["next_cursor"]
    assert cursor is not None
    recent = (datetime.now(UTC).date() - timedelta(days=10)).isoformat()

    for other in (
        {"filter[own_cited]": "true"},
        {"filter[own_cited]": "false", "from": recent},
        {"filter[own_cited]": "false", "filter[country_iso]": "US"},
        {"filter[own_cited]": "false", "include_branded": "true"},
        {"filter[own_cited]": "false", "filter[engine_code_in]": "chatgpt_web"},
        {},
    ):
        response = await _prompts(scene.world, api, limit=1, cursor=cursor, **other)
        assert problem(response) == INVALID_CURSOR, other
    same = await _prompts(
        scene.world, api, limit=1, cursor=cursor, **{"filter[own_cited]": "false"}
    )
    assert same.status_code == 200, same.text


async def test_a_prompts_cursor_of_another_project_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    other = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, other.project, "Another question?")
    await answer(migrated, other, prompt, days_ago=1, cites=[other.own_cite()])
    await answer(migrated, other, prompt, days_ago=1, engine="gemini_web")
    cursor = (await _prompts(other, api, limit=1)).json()["page"]["next_cursor"]
    assert cursor is not None

    response = await _prompts(scene.world, api, limit=1, cursor=cursor)

    assert problem(response) == INVALID_CURSOR


FORGED_KEYS = {
    "not a uuid": ["not-a-uuid", "chatgpt_web"],
    "engine as a number": [str(uuid.uuid4()), 5],
    "uuid as a number": [7, "chatgpt_web"],
    "an engine that does not exist": [str(uuid.uuid4()), "no_such_engine"],
    "one value": [str(uuid.uuid4())],
    "three values": [str(uuid.uuid4()), "chatgpt_web", 1],
    "no values": [],
}


@pytest.mark.parametrize("name", FORGED_KEYS)
async def test_a_forged_prompts_cursor_is_refused(
    name: str, api: httpx.AsyncClient, scene: Scene
) -> None:
    """The cursor hash is not a signature: a key with the right hash must still be one the
    database takes, or the answer is `400`, never `500`."""
    real = (await _prompts(scene.world, api, limit=1)).json()["page"]["next_cursor"]

    forged = await _prompts(
        scene.world, api, limit=1, cursor=forged_cursor(real, FORGED_KEYS[name])
    )

    assert problem(forged) == INVALID_CURSOR


async def test_a_cursor_with_the_right_hash_and_a_good_key_is_taken(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The forged cases above fail on their key, not on the way they are made."""
    page = (await _prompts(scene.world, api, limit=1)).json()
    after = forged_cursor(
        page["page"]["next_cursor"], [page["data"][0]["prompt_id"], "chatgpt_web"]
    )

    response = await _prompts(scene.world, api, limit=1, cursor=after)

    assert response.status_code == 200, response.text


async def test_branded_prompts_are_left_out_by_default(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    branded = await add_prompt(
        migrated, scene.world.project, "Eventus Security reviews", branded=True
    )
    await answer(migrated, scene.world, branded, days_ago=1, cites=[scene.world.own_cite()])

    default = _rows(await _prompts(scene.world, api))
    wanted = _rows(await _prompts(scene.world, api, include_branded="true"))

    assert _key(branded, "chatgpt_web") not in default
    assert wanted[_key(branded, "chatgpt_web")]["answers_citing_own"] == 1
    assert wanted.keys() - default.keys() == {_key(branded, "chatgpt_web")}


async def test_prompts_of_another_project_are_not_listed(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A second project of the same workspace has its own prompt with an own page: neither the
    prompt nor its page is in the first project's rows."""
    world = scene.world
    second = Project(world.project.workspace_id, await make_project(migrated, world.workspace.id))
    elsewhere = await add_prompt(migrated, second, "Another project's question?")
    await answer(
        migrated, replace(world, project=second), elsewhere, days_ago=1, cites=[world.own_cite()]
    )

    rows = _rows(await _prompts(world, api))

    assert _key(elsewhere, "chatgpt_web") not in rows
    assert {prompt for prompt, _ in rows} == {str(p.id) for p in (scene.a, scene.b, scene.c)}


async def test_prompts_of_another_workspace_are_not_listed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    other = await make_world(resources, migrated)
    elsewhere = await add_prompt(migrated, other.project, "Another workspace's question?")
    await answer(migrated, other, elsewhere, days_ago=1, cites=[other.own_cite()])

    mine = _rows(await _prompts(scene.world, api))
    theirs = _rows(await _prompts(other, api))

    assert _key(elsewhere, "chatgpt_web") not in mine
    assert set(theirs) == {_key(elsewhere, "chatgpt_web")}
    assert theirs[_key(elsewhere, "chatgpt_web")]["own_citation_units"] == 1


async def test_only_counted_answers_are_read(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """An invalid, a not current and a superseded answer, and one outside the window, cite an own
    page of prompt B and change nothing; prompt B stays one answer with no own page."""
    world, own = scene.world, scene.world.own_cite()
    await answer(migrated, world, scene.b, days_ago=1, cites=[own], valid=False)
    await answer(migrated, world, scene.b, days_ago=1, cites=[own], current=False)
    await answer(migrated, world, scene.b, days_ago=1, cites=[own], superseded=True)
    await answer(migrated, world, scene.b, days_ago=35, cites=[own])

    row = _rows(await _prompts(world, api))[_key(scene.b, "chatgpt_web")]

    assert (row["answers"], row["answers_citing_own"]) == (1, 0)


async def test_the_window_and_the_engines_narrow_the_rows(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    await answer(migrated, scene.world, scene.a, days_ago=10, cites=[scene.world.own_cite()])
    recent = await _prompts(
        scene.world, api, **{"from": (datetime.now(UTC).date() - timedelta(days=5)).isoformat()}
    )
    whole = await _prompts(scene.world, api)
    gemini = await _prompts(scene.world, api, **{"filter[engine_code_in]": "gemini_web"})

    assert _rows(whole)[_key(scene.a, "chatgpt_web")]["answers"] == 3
    assert _rows(recent)[_key(scene.a, "chatgpt_web")]["answers"] == 2
    assert {engine for _, engine in _rows(gemini)} == {"gemini_web"}
    assert gemini.json()["meta"]["engine_codes"] == ["gemini_web"]


async def test_the_country_filter_keeps_the_prompts_of_one_market(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    german = await add_prompt(migrated, scene.world.project, "Was ist ein SOC?", country="DE")
    await answer(migrated, scene.world, german, days_ago=1, cites=[scene.world.own_cite()])

    de = _rows(await _prompts(scene.world, api, **{"filter[country_iso]": "DE"}))
    us = _rows(await _prompts(scene.world, api, **{"filter[country_iso]": "US"}))

    assert set(de) == {_key(german, "chatgpt_web")}
    assert _key(german, "chatgpt_web") not in us
    assert _key(scene.a, "chatgpt_web") in us


async def test_the_meta_names_the_window_and_the_engines(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    body = (await _prompts(scene.world, api)).json()

    assert set(body["meta"]) == {"window", "include_branded", "engine_codes"}
    assert body["meta"]["include_branded"] is False
    assert body["meta"]["engine_codes"] == ["chatgpt_web", "gemini_web", "google_ai_mode"]
    assert body["page"]["limit"] == 50


async def test_the_prompts_read_is_one_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The base plan's 3,600 answers: the first read of the freshly loaded project (no
    statistics) is timed, 15 s being the hard limit; it sends as many statements as a small
    project's."""
    full = await full_project(resources, migrated)

    started = time.perf_counter()
    cold = await _prompts(full, api, limit=200)
    assert time.perf_counter() - started < 15
    await _prompts(scene.world, api, limit=200)
    with statements(resources) as small:
        await _prompts(scene.world, api, limit=200)
    with statements(resources) as large:
        await _prompts(full, api, limit=200)

    assert len(large) == len(small), large
    body = cold.json()
    assert len(body["data"]) == 200
    assert body["page"]["has_more"] is True
    assert all(row["answers_citing_own"] == 0 for row in body["data"])


async def test_prompts_of_a_deleted_or_unknown_project_are_not_found(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    unknown = await api.get(
        world.url("ai", "sources", "prompts").replace(str(world.project.id), str(uuid.uuid4())),
        headers=world.owner.headers,
    )
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )
    deleted = await _prompts(world, api)

    assert problem(unknown) == problem(deleted) == NOT_FOUND
