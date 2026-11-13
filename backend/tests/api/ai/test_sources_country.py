"""Country scope of the source and fan-out reads (WP-14 T3; CF-08): `filter[country_iso]` keeps the
answers of the prompts of one market, as the prompts summary does, on the domain and page rows,
the citation list and the fan-out queries. A citation cursor is bound to the filter only when it is
set, so a cursor made without it still works. The numbers are worked out by hand."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.pagination import encode_cursor
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    GUIDE,
    WIKI,
    Cite,
    World,
    answer,
    cursor_key,
    make_world,
    statements,
)
from tests.api.auth.support import execute
from tests.api.entities.support import problem
from tests.collectors.ai_support import OWN_HOST, Prompt, add_prompt
from tests.conftest import PostgresServer

EXAMPLE, WIKIPEDIA, EXAMPLE_COM = "example.org", "wikipedia.org", "example.com"
NO_MARKET = "https://news.example.com/no-market"
ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]
COUNTRY = "filter[country_iso]"
INVALID = (422, "validation_failed")
INVALID_CURSOR = (400, "invalid_cursor")
READS = [
    ("sources", "domains"),
    ("sources", "pages"),
    ("citations",),
    ("fanout-queries",),
]


def _day(days: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


@dataclass(frozen=True)
class Scene:
    world: World
    prompts: dict[str, Prompt]


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Three prompts, ChatGPT answers (days before now in brackets), each with one stored
    fan-out query:

      us1 `us` (1)    guide                "us soc providers"
      us2 `us` (2)    guide                "us soc providers"
      de1 `de` (1)    wiki                 "de soc anbieter"
      br1 `branded_us` (3)   the own page  "us brand query"   (a branded prompt of the US)

    The branded prompt is left out of every read unless it is asked for."""
    world = await make_world(resources, migrated)
    prompts = {
        "us": await add_prompt(migrated, world.project, "Best managed SOC providers?"),
        "de": await add_prompt(
            migrated, world.project, "Bester SOC Anbieter?", country="DE", language="de"
        ),
        "branded_us": await add_prompt(
            migrated, world.project, "Is Eventus Security any good?", branded=True
        ),
    }
    for name, days, cites, query in (
        ("us", 1, [Cite(GUIDE)], "us soc providers"),
        ("us", 2, [Cite(GUIDE)], "us soc providers"),
        ("de", 1, [Cite(WIKI)], "de soc anbieter"),
        ("branded_us", 3, [world.own_cite()], "us brand query"),
    ):
        await answer(migrated, world, prompts[name], days_ago=days, cites=cites, fan_out=[query])
    return Scene(world, prompts)


async def _get(scene: Scene, api: httpx.AsyncClient, *path: str, **params: Any) -> httpx.Response:
    return await api.get(
        scene.world.url("ai", *path), params=params, headers=scene.world.owner.headers
    )


@pytest.mark.parametrize(
    ("country", "domain", "answers"), [("US", EXAMPLE, 2), ("DE", WIKIPEDIA, 1)]
)
async def test_a_country_keeps_the_answers_of_its_prompts_on_domains(
    country: str, domain: str, answers: int, api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(scene, api, "sources", "domains", **{COUNTRY: country})

    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["data"]
    assert row["registrable_domain"] == domain
    assert row["citation_units"] == answers
    assert row["source_share"]["numerator"] == answers
    assert row["source_share"]["denominator"] == answers
    assert body["meta"]["answers"] == answers
    assert body["meta"]["citation_units"] == answers
    assert body["page"]["total"] == 1


@pytest.mark.parametrize(("country", "url", "answers"), [("US", GUIDE, 2), ("DE", WIKI, 1)])
async def test_a_country_keeps_the_answers_of_its_prompts_on_pages(
    country: str, url: str, answers: int, api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(scene, api, "sources", "pages", **{COUNTRY: country})

    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["data"]
    assert row["url"] == url
    assert row["citation_units"] == answers
    assert row["source_share"]["denominator"] == answers
    assert body["meta"]["answers"] == answers


async def test_without_a_country_every_prompt_counts(api: httpx.AsyncClient, scene: Scene) -> None:
    body = (await _get(scene, api, "sources", "domains")).json()

    assert {row["registrable_domain"] for row in body["data"]} == {EXAMPLE, WIKIPEDIA}
    assert body["meta"]["answers"] == 3


async def test_the_citation_list_keeps_the_countrys_answers(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    german = (await _get(scene, api, "citations", **{COUNTRY: "DE"})).json()["data"]
    american = (await _get(scene, api, "citations", **{COUNTRY: "US"})).json()["data"]
    everyone = (await _get(scene, api, "citations")).json()["data"]

    assert [row["prompt_id"] for row in german] == [str(scene.prompts["de"].id)]
    assert [row["prompt_id"] for row in american] == [str(scene.prompts["us"].id)] * 2
    assert len(everyone) == 3


async def test_fanout_queries_keep_the_countrys_answers(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    american = (await _get(scene, api, "fanout-queries", min_support=1, **{COUNTRY: "US"})).json()
    german = (await _get(scene, api, "fanout-queries", min_support=1, **{COUNTRY: "DE"})).json()
    everyone = (await _get(scene, api, "fanout-queries", min_support=1)).json()

    assert [(row["query_text"], row["observations"]) for row in american["data"]] == [
        ("us soc providers", 2)
    ]
    assert (american["meta"]["answers"], american["meta"]["answers_with_fanout"]) == (2, 2)
    assert [row["query_text"] for row in german["data"]] == ["de soc anbieter"]
    assert german["meta"]["answers"] == 1
    assert [row["query_text"] for row in everyone["data"]] == [
        "us soc providers",
        "de soc anbieter",
    ]
    assert everyone["meta"]["answers"] == 3


@pytest.mark.parametrize("path", READS)
async def test_a_country_with_no_prompt_answers_empty(
    path: tuple[str, ...], api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(scene, api, *path, **{COUNTRY: "FR"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data"] == []
    if "meta" in body:
        assert body["meta"]["answers"] == 0


async def test_a_citation_cursor_is_bound_to_its_country(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    first = (await _get(scene, api, "citations", limit=1, **{COUNTRY: "US"})).json()
    cursor = first["page"]["next_cursor"]
    assert cursor is not None

    other = await _get(scene, api, "citations", limit=1, cursor=cursor, **{COUNTRY: "DE"})
    without = await _get(scene, api, "citations", limit=1, cursor=cursor)
    same = await _get(scene, api, "citations", limit=1, cursor=cursor, **{COUNTRY: "US"})

    assert problem(other) == INVALID_CURSOR
    assert problem(without) == INVALID_CURSOR
    assert same.status_code == 200, same.text
    assert same.json()["data"][0]["observation_id"] != first["data"][0]["observation_id"]


async def test_a_country_cursor_does_not_open_a_list_without_a_country(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    first = (await _get(scene, api, "citations", limit=1)).json()
    cursor = first["page"]["next_cursor"]

    response = await _get(scene, api, "citations", limit=1, cursor=cursor, **{COUNTRY: "US"})

    assert problem(response) == INVALID_CURSOR


async def test_a_cursor_without_a_country_keeps_its_hash(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The scope a cursor is hashed from before the country existed. A cursor made without the
    filter must still be that one, so a client that holds one keeps paging."""
    first = (await _get(scene, api, "citations", limit=1)).json()
    cursor = first["page"]["next_cursor"]
    before_country = {
        "project_id": str(scene.world.project.id),
        "from": None,
        "to": None,
        "engines": ENGINES,
        "prompt": None,
        "term": None,
        "branded": False,
        "roles": [],
        "domain": None,
        "url": None,
    }

    assert cursor == encode_cursor(cursor_key(cursor), scope=before_country)
    page = await _get(scene, api, "citations", limit=1, cursor=cursor)
    assert page.status_code == 200, page.text
    assert page.json()["data"][0]["observation_id"] != first["data"][0]["observation_id"]


@pytest.mark.parametrize("path", [("sources", "domains"), ("sources", "pages"), ("citations",)])
async def test_a_country_and_one_prompt_of_another_country_answer_empty(
    path: tuple[str, ...], api: httpx.AsyncClient, scene: Scene
) -> None:
    german = str(scene.prompts["de"].id)

    mismatch = await _get(scene, api, *path, **{"filter[prompt_id]": german, COUNTRY: "US"})
    match = await _get(scene, api, *path, **{"filter[prompt_id]": german, COUNTRY: "DE"})

    assert mismatch.status_code == 200, mismatch.text
    assert mismatch.json()["data"] == []
    assert len(match.json()["data"]) == 1


async def test_a_country_keeps_branded_prompts_out_unless_asked(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    plain = (await _get(scene, api, "sources", "domains", **{COUNTRY: "US"})).json()
    asked = (
        await _get(scene, api, "sources", "domains", include_branded="true", **{COUNTRY: "US"})
    ).json()

    assert [row["registrable_domain"] for row in plain["data"]] == [EXAMPLE]
    assert plain["meta"]["answers"] == 2
    assert {row["registrable_domain"] for row in asked["data"]} == {EXAMPLE, OWN_HOST}
    assert asked["meta"]["answers"] == 3


async def test_a_prompt_without_a_country_answers_in_no_country(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """`ai.prompts.country_iso` may be NULL: such a prompt belongs to no market, so a country
    filter leaves it out, and the read without a filter still counts it."""
    prompt = await add_prompt(migrated, scene.world.project, "Which SOC fits a small firm?")
    await execute(migrated, "UPDATE ai.prompts SET country_iso = NULL WHERE id = $1", prompt.id)
    await answer(migrated, scene.world, prompt, days_ago=1, cites=[Cite(NO_MARKET)])

    for country, answers in (("US", 2), ("DE", 1)):
        domains = (await _get(scene, api, "sources", "domains", **{COUNTRY: country})).json()
        pages = (await _get(scene, api, "sources", "pages", **{COUNTRY: country})).json()
        citations = (await _get(scene, api, "citations", **{COUNTRY: country})).json()

        assert EXAMPLE_COM not in {row["registrable_domain"] for row in domains["data"]}, country
        assert domains["meta"]["answers"] == pages["meta"]["answers"] == answers, country
        assert NO_MARKET not in {row["url"] for row in pages["data"]}, country
        assert str(prompt.id) not in {row["prompt_id"] for row in citations["data"]}, country
    everyone = (await _get(scene, api, "sources", "domains")).json()
    assert EXAMPLE_COM in {row["registrable_domain"] for row in everyone["data"]}
    assert everyone["meta"]["answers"] == 4


@pytest.fixture
async def earlier(scene: Scene, migrated: PostgresServer) -> Scene:
    """The scene with answers in the window before the last 5 days (9 to 5 days ago), citing the
    guide and the wiki for both markets:

      us (6)  guide, wiki      us (7)  guide
      de (6)  wiki             de (8)  guide, wiki

    So the guide was cited in 3 earlier answers (2 of the US) and the wiki in 3 (2 of Germany);
    each market's earlier answers number 2 and all of them 4."""
    for name, days, cites in (
        ("us", 6, [Cite(GUIDE), Cite(WIKI)]),
        ("us", 7, [Cite(GUIDE)]),
        ("de", 6, [Cite(WIKI)]),
        ("de", 8, [Cite(GUIDE), Cite(WIKI)]),
    ):
        await answer(migrated, scene.world, scene.prompts[name], days_ago=days, cites=cites)
    return scene


@pytest.mark.parametrize(
    ("path", "key", "country", "row_key"),
    [
        ("domains", "registrable_domain", "US", EXAMPLE),
        ("domains", "registrable_domain", "DE", WIKIPEDIA),
        ("pages", "url", "US", GUIDE),
        ("pages", "url", "DE", WIKI),
    ],
)
async def test_the_previous_period_counts_the_countrys_answers_only(
    path: str, key: str, country: str, row_key: str, api: httpx.AsyncClient, earlier: Scene
) -> None:
    """`compare=previous_period` is read over the same prompts: a row's `previous` and
    `meta.previous_answers` hold the market's earlier answers (2 each), not all four."""
    window = {"from": _day(4), "to": _day(0)}

    response = await _get(
        earlier, api, "sources", path, compare="previous_period", **window, **{COUNTRY: country}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["data"]
    assert row[key] == row_key
    assert row["previous"] == {"citation_units": 2, "observations": 2}
    assert body["meta"]["previous_answers"] == 2
    assert body["meta"]["answers"] == (2 if country == "US" else 1)
    unfiltered = (
        await _get(earlier, api, "sources", path, compare="previous_period", **window)
    ).json()
    assert unfiltered["meta"]["previous_answers"] == 4
    assert {r[key]: r["previous"]["citation_units"] for r in unfiltered["data"]}[row_key] == 3


@pytest.mark.parametrize("path", READS)
async def test_a_lower_case_country_is_refused(
    path: tuple[str, ...], api: httpx.AsyncClient, scene: Scene
) -> None:
    for value in ("us", "USA", "U", "U1", ""):
        response = await _get(scene, api, *path, **{COUNTRY: value})

        assert problem(response) == INVALID, value


@pytest.mark.parametrize("path", READS)
async def test_country_adds_no_statement(
    path: tuple[str, ...], api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    await _get(scene, api, *path)
    with statements(resources) as plain:
        await _get(scene, api, *path)
    with statements(resources) as filtered:
        await _get(scene, api, *path, **{COUNTRY: "US"})

    assert len(filtered) == len(plain), filtered
