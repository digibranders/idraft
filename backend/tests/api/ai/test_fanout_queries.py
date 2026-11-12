"""The queries ChatGPT issued while answering (plan D2 Task 4; docs/16 F1 and F4), read from
the lists ingest stored in `ai.observations.provider_extras`: grouped by normalized text, with
the answers and prompts that issued each and the domains those answers cite. A list the 16 KB
bound cut is counted as cut. The expected numbers are worked out by hand from the answers."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.providers.dataforseo.ai_parse import EXTRAS_MAX_BYTES, parse_ai_answer
from tests.api.ai.sources_support import (
    GUIDE,
    OWN,
    WIKI,
    Cite,
    World,
    answer,
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute, fetch
from tests.api.entities.support import member, problem
from tests.collectors.ai_support import OWN_HOST, RIVAL_HOST, Prompt, add_prompt, chatgpt_answer
from tests.conftest import PostgresServer

BEST = "best soc providers india"
PRICING = "soc pricing"


@dataclass(frozen=True)
class Scene:
    world: World
    prompts: dict[str, Prompt]


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """ChatGPT answers, days before now in brackets:

      f1 a (1)  "Best SOC providers India", "soc pricing"          cites own, guide
      f2 a (2)  "best  soc providers india " (two spaces, trailing), "MSSP list"   cites rival
      f3 b (3)  "Best SOC providers India"                         cites own, wiki
      f4 b (4)  no query                                           cites own
      f5 a (5)  "soc pricing" stored of 4 issued (cut)             cites rival
      f6 a (6)  extras cut to {"truncated": true}, 3 issued        cites nothing
    Left out: a refusal of `a` (2) and the branded prompt's answer (2), each issuing
    "soc pricing"; a Gemini answer of `a` (1)."""
    world = await make_world(resources, migrated)
    project = world.project
    prompts = {
        "a": await add_prompt(migrated, project, "Best managed SOC providers?"),
        "b": await add_prompt(migrated, project, "How much does a managed SOC cost?"),
        "brand": await add_prompt(migrated, project, "Is Eventus Security any good?", branded=True),
    }
    own, rival = world.own_cite(), world.rival_cite()

    async def add(prompt: str, days: float, **kw: Any) -> None:
        await answer(migrated, world, prompts[prompt], days_ago=days, **kw)

    await add("a", 1, fan_out=["Best SOC providers India", "soc pricing"], cites=[own, Cite(GUIDE)])
    await add("a", 2, fan_out=["best  soc providers india ", "MSSP list"], cites=[rival])
    await add("b", 3, fan_out=["Best SOC providers India"], cites=[own, Cite(WIKI)])
    await add("b", 4, fan_out=[], cites=[own])
    await add(
        "a",
        5,
        extras={"fan_out_queries": ["soc pricing"], "truncated": True},
        fanout_count=4,
        cites=[rival],
    )
    await add("a", 6, extras={"truncated": True}, fanout_count=3)
    await add("a", 2, fan_out=["soc pricing"], valid=False)
    await add("brand", 2, fan_out=["soc pricing"])
    await add("a", 1, engine="gemini_web", cites=[own])
    return Scene(world, prompts)


async def _get(world: World, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    return await api.get(
        world.url("ai", "fanout-queries"), params=params, headers=world.owner.headers
    )


def _rows(response: httpx.Response) -> list[tuple[Any, ...]]:
    assert response.status_code == 200, response.text
    return [
        (row["normalized_text"], row["query_text"], row["observations"], row["prompts"])
        for row in response.json()["data"]
    ]


def _cited(row: dict[str, Any]) -> list[tuple[Any, ...]]:
    return [
        (cited["registrable_domain"], cited["domain_role"], cited["citation_units"])
        for cited in row["cited_domains"]
    ]


def _counts(meta: dict[str, Any]) -> tuple[Any, ...]:
    return meta["answers"], meta["answers_with_fanout"], meta["answers_truncated"]


async def test_queries_are_grouped_by_their_normalized_text(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(scene.world, api)

    assert _rows(response) == [
        (BEST, "Best SOC providers India", 3, 2),
        (PRICING, "soc pricing", 2, 1),
    ]
    best = response.json()["data"][0]
    assert best["engine_code"] == "chatgpt_web"
    assert best["prompt_ids"] == sorted(str(scene.prompts[name].id) for name in ("a", "b"))
    assert best["first_seen_at"] < best["last_seen_at"]
    assert response.json()["page"]["total"] == 2


async def test_each_query_names_the_domains_its_answers_cite(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    best, pricing = (await _get(scene.world, api)).json()["data"]

    assert _cited(best) == [
        (OWN_HOST, "own", 2),
        (RIVAL_HOST, "competitor", 1),
        ("example.org", "third_party", 1),
        ("wikipedia.org", "third_party", 1),
    ]
    assert best["cited_domains"][0]["role_entity_id"] == str(scene.world.own)
    assert _cited(pricing) == [
        (RIVAL_HOST, "competitor", 1),
        (OWN_HOST, "own", 1),
        ("example.org", "third_party", 1),
    ]


async def test_the_meta_counts_the_answers_and_the_cut_lists(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    meta = (await _get(scene.world, api)).json()["meta"]

    assert _counts(meta) == (6, 5, 2)
    assert meta["engine_codes"] == ["chatgpt_web"]
    assert meta["engines_without_fanout"] == ["gemini_web", "google_ai_mode"]
    assert (meta["min_support"], meta["include_branded"]) == (2, False)


async def test_min_support_keeps_rarer_queries(api: httpx.AsyncClient, scene: Scene) -> None:
    every = await _get(scene.world, api, min_support=1)
    zero = await _get(scene.world, api, min_support=0)

    assert _rows(every)[-1] == ("mssp list", "MSSP list", 1, 1)
    assert len(_rows(every)) == 3
    assert problem(zero) == (422, "validation_failed")


async def test_branded_prompts_and_one_prompt(api: httpx.AsyncClient, scene: Scene) -> None:
    branded = await _get(scene.world, api, include_branded="true")
    only_b = await _get(
        scene.world, api, min_support=1, **{"filter[prompt_id]": str(scene.prompts["b"].id)}
    )

    assert _rows(branded)[1] == (PRICING, "soc pricing", 3, 2)
    assert _rows(only_b) == [(BEST, "Best SOC providers India", 1, 1)]


async def test_an_engine_that_shows_no_fanout_is_refused(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    gemini = await _get(scene.world, api, **{"filter[engine_code_in]": "gemini_web"})
    mixed = await _get(scene.world, api, **{"filter[engine_code_in]": "chatgpt_web,google_ai_mode"})

    assert problem(gemini) == problem(mixed) == (422, "engine_has_no_fanout")
    assert gemini.json()["engine_codes"] == ["gemini_web"]
    assert mixed.json()["engine_codes"] == ["google_ai_mode"]


async def test_the_page_follows_the_offset_and_the_total_stays(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    second = await _get(scene.world, api, limit=1, offset=1)
    past_the_end = await _get(scene.world, api, limit=1, offset=5)

    assert _rows(second) == [(PRICING, "soc pricing", 2, 1)]
    assert second.json()["page"] == {"offset": 1, "limit": 1, "total": 2}
    assert past_the_end.json()["data"] == []
    assert past_the_end.json()["page"]["total"] == 2


async def test_an_unknown_project_is_not_found_and_a_viewer_may_read(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    viewer = await member(resources, migrated, world.workspace, "viewer")
    other = world.url("ai", "fanout-queries").replace(str(world.project.id), str(uuid.uuid4()))

    missing = await api.get(other, headers=world.owner.headers)
    read = await api.get(world.url("ai", "fanout-queries"), headers=viewer.headers)

    assert problem(missing) == (404, "not_found")
    assert read.status_code == 200, read.text


async def test_at_most_five_domains_are_named(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    pages = [Cite(f"https://www.site{n}.net/page") for n in range(6)]
    await answer(migrated, world, prompt, days_ago=1, fan_out=["one query"], cites=pages)

    (row,) = (await _get(world, api, min_support=1)).json()["data"]

    assert [cited["registrable_domain"] for cited in row["cited_domains"]] == [
        f"site{n}.net" for n in range(5)
    ]


async def test_a_list_is_cut_when_it_is_shorter_than_the_queries_issued(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The `truncated` flag is also set when only the ads were cut: the list is complete when
    its length is `fanout_count`, whatever the flag says."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    ads_cut = {"fan_out_queries": ["one query"], "truncated": True}
    await answer(migrated, world, prompt, days_ago=1, extras=ads_cut, fanout_count=1)
    await answer(migrated, world, prompt, days_ago=2, extras=ads_cut, fanout_count=2)

    body = (await _get(world, api, min_support=1)).json()

    assert _counts(body["meta"]) == (2, 2, 1)
    assert [row["observations"] for row in body["data"]] == [2]


async def test_provider_text_is_cut_to_a_bound(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    long_query = "q" * 5000
    await answer(migrated, world, prompt, days_ago=1, fan_out=[long_query])

    (row,) = (await _get(world, api, min_support=1)).json()["data"]

    assert len(row["query_text"]) == len(row["normalized_text"]) == 300
    assert row["query_text"].endswith("...")
    assert row["normalized_text"].endswith("...")


@pytest.mark.parametrize(
    "lead",
    [
        chr(0xE9),  # an e with acute: two bytes
        chr(0x4E2D),  # a CJK character: three bytes
        chr(0x1F600),  # an emoji: four bytes
        chr(34) + chr(92) + chr(1),  # a quote, a backslash and a control character (escaped)
    ],
    ids=["two_bytes", "three_bytes", "four_bytes", "escapes"],
)
async def test_a_list_cut_by_the_16_kb_bound_is_counted_as_cut(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, lead: str
) -> None:
    """1,000 queries of about 45 bytes through the real parser: the list is halved, Python's
    byte count of what the parser kept is PostgreSQL's `octet_length` (so the database's check
    accepts it), and the route counts the stored queries and says the answer's list was cut."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    issued = [f"{lead}tude {n:04d} of managed SOC providers in India" for n in range(1000)]
    document = json.loads(
        chatgpt_answer("Several firms run managed SOC services in India today.", [OWN])
    )
    document["tasks"][0]["result"][0]["fan_out_queries"] = issued
    parsed = parse_ai_answer("chatgpt_web", document)
    extras = dict(parsed.provider_extras or {})
    kept = extras["fan_out_queries"]
    assert extras["truncated"] is True
    assert parsed.fan_out_count == 1000
    assert 0 < len(kept) < 1000
    assert kept == issued[: len(kept)]

    observation_id = await answer(
        migrated, world, prompt, days_ago=1, extras=extras, fanout_count=parsed.fan_out_count
    )
    (stored,) = await fetch(
        migrated,
        "SELECT octet_length(provider_extras::text) AS n FROM ai.observations WHERE id = $1",
        observation_id,
    )
    # A difference here is a finding: the parser's bound then needs a margin.
    assert stored["n"] == len(json.dumps(extras, ensure_ascii=False).encode()) <= EXTRAS_MAX_BYTES

    response = await _get(world, api, min_support=1, limit=200)

    body = response.json()
    assert body["page"]["total"] == len(kept)
    assert _counts(body["meta"]) == (1, 1, 1)


async def test_a_full_project_reads_as_many_statements_as_a_small_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The ChatGPT answers of a full project, three queries each, 300 answers of all engines
    replaced by a newer one and so not counted. The first read of the freshly loaded project
    (no ANALYZE: no statistics) is timed: 15 s is the hard limit."""
    full = await full_project(resources, migrated, fan_out=True)
    (counted,) = await fetch(
        migrated,
        "SELECT count(*) AS n FROM ai.observations "
        "WHERE project_id = $1 AND engine_code = 'chatgpt_web' AND superseded_by IS NULL",
        full.project.id,
    )
    started = time.perf_counter()
    cold = await _get(full, api)
    assert time.perf_counter() - started < 15
    assert cold.status_code == 200, cold.text
    await _get(scene.world, api)
    with statements(resources) as small:
        await _get(scene.world, api)
    with statements(resources) as large:
        response = await _get(full, api)

    assert [row[0] for row in _rows(response)] == ["mssp list", "soc pricing", "soc providers"]
    assert {row[2:] for row in _rows(response)} == {(counted["n"], 150)}
    assert 900 < counted["n"] < 1200
    assert _counts(response.json()["meta"]) == (counted["n"], counted["n"], 0)
    assert len(large) == len(small), large


async def test_the_longest_stored_lists_of_a_full_project_read_within_the_limit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Every ChatGPT answer of a full project stores 250 queries (about what the 16 KB bound
    keeps of a list of 1,000), and a page asks for 200 rows with their cited domains. The
    statement that names the domains must normalize each stored query once, not once per row
    of the page (it did, and ran past the 15 s limit)."""
    full = await full_project(resources, migrated, fan_out=True)
    await execute(
        migrated,
        "UPDATE ai.observations SET provider_extras = jsonb_build_object('fan_out_queries', "
        "(SELECT jsonb_agg('query number ' || g || ' of managed soc providers') "
        "FROM generate_series(1, 250) g)), fanout_count = 250 "
        "WHERE engine_code = 'chatgpt_web' AND project_id = $1",
        full.project.id,
    )

    started = time.perf_counter()
    response = await _get(full, api, min_support=1, limit=200)
    elapsed = time.perf_counter() - started

    assert response.status_code == 200, response.text
    body = response.json()
    assert (len(body["data"]), body["page"]["total"]) == (200, 250)
    assert all(len(row["cited_domains"]) == 5 for row in body["data"])
    assert elapsed < 15, elapsed
