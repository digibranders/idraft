"""Source diversity per engine (WP-14 T5; CF-05, BE-SOURCES-07; docs/16 C3 and rule 2): the
registrable domains an engine cites and the effective number of sources, (sum of units)^2 over
the sum of squared units per domain, with both visible. Engines are never pooled: the meta holds a
count and the equal-weight mean of the engines that cite. The expected numbers are worked out by
hand from the answers below."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai.summary import summary_weeks
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    FULL_ANSWERS,
    GUIDE,
    GUIDE_TOP,
    OWN,
    OWN_BLOG,
    WIKI,
    Cite,
    World,
    answer,
    derivation_of,
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute
from tests.api.entities.support import problem
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

NOT_FOUND = (404, "not_found")
ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]
PLAIN_ENGINE_KEYS = {
    "engine_code",
    "answers",
    "answers_citing",
    "citation_units",
    "distinct_domains",
    "effective_sources",
}
PLAIN_META_KEYS = {
    "window",
    "include_branded",
    "engine_codes",
    "distinct_domains",
    "effective_sources_engine_average",
}


@dataclass(frozen=True)
class Scene:
    world: World
    prompt: Prompt


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    world = await make_world(resources, migrated)
    return Scene(world, await add_prompt(migrated, world.project, "Best managed SOC providers?"))


async def _answer(
    pg: PostgresServer,
    scene: Scene,
    days: float,
    *cites: Cite,
    engine: str = "chatgpt_web",
    prompt: Prompt | None = None,
    **extra: Any,
) -> int:
    return await answer(
        pg,
        scene.world,
        prompt or scene.prompt,
        days_ago=days,
        engine=engine,
        cites=list(cites),
        **extra,
    )


@pytest.fixture
async def busy(migrated: PostgresServer, scene: Scene) -> Scene:
    """ChatGPT: three answers citing the guide and its top page (one domain, two pages), the wiki
    and, in the third, the own page; a fourth cites nothing. So `example.org` has 6 units,
    `wikipedia.org` 3 and the own domain 1: 10 units, 46 squared. Gemini: one answer citing the
    guide and its top page, so 1 domain with 2 units. AI Mode: one answer, no citation."""
    guide, top, wiki = Cite(GUIDE), Cite(GUIDE_TOP), Cite(WIKI)
    await _answer(migrated, scene, 1, guide, top, wiki)
    await _answer(migrated, scene, 2, guide, top, wiki)
    await _answer(migrated, scene, 3, guide, top, wiki, scene.world.own_cite())
    await _answer(migrated, scene, 5)
    await _answer(migrated, scene, 2, guide, top, engine="gemini_web")
    await _answer(migrated, scene, 4, engine="google_ai_mode")
    return scene


async def _diversity(world: World, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    return await api.get(
        world.url("ai", "sources", "diversity"), params=params, headers=world.owner.headers
    )


def _engines(response: httpx.Response) -> dict[str, dict[str, Any]]:
    assert response.status_code == 200, response.text
    return {entry["engine_code"]: entry for entry in response.json()["data"]}


async def test_effective_sources_is_the_inverse_herfindahl(
    api: httpx.AsyncClient, busy: Scene
) -> None:
    """ChatGPT: units 6, 3 and 1 over three domains: (6 + 3 + 1)^2 / (36 + 9 + 1) = 100 / 46."""
    response = await _diversity(busy.world, api)

    chatgpt = _engines(response)["chatgpt_web"]
    assert [entry["engine_code"] for entry in response.json()["data"]] == ENGINES
    assert (
        chatgpt["answers"],
        chatgpt["answers_citing"],
        chatgpt["citation_units"],
        chatgpt["distinct_domains"],
    ) == (4, 3, 10, 3)
    cell = chatgpt["effective_sources"]
    assert cell["value"] == pytest.approx(100 / 46)
    assert (cell["numerator"], cell["denominator"], cell["n_observations"]) == (100.0, 46, 4)


async def test_one_domain_is_one_effective_source(api: httpx.AsyncClient, busy: Scene) -> None:
    gemini = _engines(await _diversity(busy.world, api))["gemini_web"]

    assert (gemini["citation_units"], gemini["distinct_domains"]) == (2, 1)
    assert gemini["effective_sources"]["value"] == 1.0
    assert (
        gemini["effective_sources"]["numerator"],
        gemini["effective_sources"]["denominator"],
    ) == (
        4.0,
        4,
    )


async def test_an_engine_without_citations_has_no_value(
    api: httpx.AsyncClient, busy: Scene
) -> None:
    mode = _engines(await _diversity(busy.world, api))["google_ai_mode"]

    assert (mode["answers"], mode["answers_citing"]) == (1, 0)
    assert (mode["citation_units"], mode["distinct_domains"]) == (0, 0)
    cell = mode["effective_sources"]
    assert cell["value"] is None
    assert (cell["numerator"], cell["denominator"], cell["n_observations"]) == (0, 0, 1)


async def test_an_engine_without_answers_is_listed_with_zeros(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    await _answer(migrated, scene, 1, Cite(GUIDE))

    engines = _engines(await _diversity(scene.world, api))

    assert list(engines) == ENGINES
    assert (engines["gemini_web"]["answers"], engines["gemini_web"]["citation_units"]) == (0, 0)
    assert engines["gemini_web"]["effective_sources"]["value"] is None


async def test_a_domain_in_two_roles_is_one_domain(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The own domain cited as the own brand (the page) and as a third party (a `www.` page) in
    one answer: 2 units on one domain, with the wiki's 1: (2 + 1)^2 / (4 + 1) = 1.8. Split by
    role it would be 3 domains and (3)^2 / 3."""
    await _answer(migrated, scene, 1, scene.world.own_cite(OWN), Cite(OWN_BLOG))
    await _answer(migrated, scene, 2, Cite(WIKI))

    chatgpt = _engines(await _diversity(scene.world, api))["chatgpt_web"]

    assert (chatgpt["citation_units"], chatgpt["distinct_domains"]) == (3, 2)
    cell = chatgpt["effective_sources"]
    assert (cell["value"], cell["numerator"], cell["denominator"]) == (pytest.approx(1.8), 9, 5)


async def test_the_meta_pools_counts_only(api: httpx.AsyncClient, busy: Scene) -> None:
    """The domains cited over every engine are 3 (Gemini's is one of ChatGPT's, not a fourth).
    The mean is of ChatGPT's and Gemini's values: AI Mode cites nothing and is left out."""
    body = (await _diversity(busy.world, api)).json()

    meta = body["meta"]
    assert meta["distinct_domains"] == 3
    assert meta["effective_sources_engine_average"] == pytest.approx((100 / 46 + 1.0) / 2)
    assert meta["engine_codes"] == ENGINES
    assert meta["include_branded"] is False


async def test_the_average_of_one_engine_is_its_value_and_of_none_is_null(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    empty = (await _diversity(scene.world, api)).json()["meta"]
    await _answer(migrated, scene, 1, Cite(GUIDE), Cite(WIKI))
    one = (await _diversity(scene.world, api)).json()["meta"]

    assert (empty["distinct_domains"], empty["effective_sources_engine_average"]) == (0, None)
    assert (one["distinct_domains"], one["effective_sources_engine_average"]) == (2, 2.0)


def _cites(*urls: str) -> list[Cite]:
    return [Cite(url) for url in urls]


def _noon(day: date) -> float:
    """How long before now noon UTC of `day` was."""
    instant = datetime(day.year, day.month, day.day, 12, tzinfo=UTC)
    return (datetime.now(UTC) - instant).total_seconds() / 86400


async def test_diversity_series_per_week(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """Three whole weeks m0, m1, m2 (Monday to Sunday, UTC) ending on the last Sunday.
    ChatGPT m0: guide, top page, wiki and own page in one answer: 4 units, 3 domains,
    (4)^2 / (4 + 1 + 1) = 16 / 6. ChatGPT m1: two answers, the guide in both and the wiki in one:
    3 units, 2 domains, 9 / 5. Gemini m0: the guide, 1 unit, 1.0. Nothing else."""
    today = datetime.now(UTC).date()
    last = today - timedelta(days=today.weekday() + 1)
    first = last - timedelta(days=20)
    weeks = summary_weeks(first, last)
    assert len(weeks) == 3
    own = scene.world.own_cite()
    await _answer(
        migrated, scene, _noon(first + timedelta(days=1)), *_cites(GUIDE, GUIDE_TOP, WIKI), own
    )
    await _answer(migrated, scene, _noon(first + timedelta(days=8)), Cite(GUIDE))
    await _answer(migrated, scene, _noon(first + timedelta(days=9)), Cite(GUIDE), Cite(WIKI))
    await _answer(migrated, scene, _noon(first + timedelta(days=15)))
    await _answer(
        migrated, scene, _noon(first + timedelta(days=2)), Cite(GUIDE), engine="gemini_web"
    )

    response = await _diversity(
        scene.world, api, **{"from": first.isoformat(), "to": last.isoformat()}, include="series"
    )

    engines = _engines(response)
    points = {
        code: [
            (
                point["week_start"],
                point["citation_units"],
                point["distinct_domains"],
                point["effective_sources"],
            )
            for point in engines[code]["series"]
        ]
        for code in ENGINES
    }
    m0, m1, m2 = (week.isoformat() for week in weeks)
    assert points["chatgpt_web"] == [
        (m0, 4, 3, pytest.approx(16 / 6)),
        (m1, 3, 2, pytest.approx(1.8)),
        (m2, 0, 0, None),
    ]
    assert points["gemini_web"] == [(m0, 1, 1, 1.0), (m1, 0, 0, None), (m2, 0, 0, None)]
    assert points["google_ai_mode"] == [(m0, 0, 0, None), (m1, 0, 0, None), (m2, 0, 0, None)]
    assert set(engines["chatgpt_web"]["series"][0]) == {
        "week_start",
        "citation_units",
        "distinct_domains",
        "effective_sources",
    }
    assert "ads" not in engines["chatgpt_web"]


async def test_ads_presence_per_engine(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """Four ChatGPT answers: one stored two ads, one an empty list, one extras the 16 KB bound
    emptied and one no extras at all. Gemini has no answer."""
    ads = [
        {"type": "chat_gpt_ad", "domain": "ads.example", "url": "https://ads.example/a"},
        {"type": "chat_gpt_ad", "domain": "ads.example", "url": "https://ads.example/b"},
    ]
    await _answer(migrated, scene, 1, Cite(GUIDE), extras={"ads": ads, "fan_out_queries": []})
    await _answer(migrated, scene, 2, extras={"ads": []})
    await _answer(migrated, scene, 3, extras={"truncated": True})
    await _answer(migrated, scene, 4)
    await _answer(migrated, scene, 5, extras={"fan_out_queries": ["a", "b", "c"]})

    engines = _engines(await _diversity(scene.world, api, include="ads"))

    chatgpt = engines["chatgpt_web"]["ads"]
    assert chatgpt["ads"] == 2
    cell = chatgpt["answers_with_ads"]
    assert (cell["value"], cell["numerator"], cell["denominator"], cell["n_observations"]) == (
        0.2,
        1.0,
        5,
        5,
    )
    gemini = engines["gemini_web"]["ads"]
    assert gemini["ads"] == 0
    assert gemini["answers_with_ads"]["value"] is None
    assert gemini["answers_with_ads"]["denominator"] == 0
    assert "series" not in engines["chatgpt_web"]


async def test_series_and_ads_can_be_asked_together(api: httpx.AsyncClient, busy: Scene) -> None:
    engines = _engines(await _diversity(busy.world, api, include="series,ads"))

    assert all({"series", "ads"} <= entry.keys() for entry in engines.values())
    assert all(len(entry["series"]) >= 4 for entry in engines.values())


async def test_without_include_there_is_no_series_or_ads(
    api: httpx.AsyncClient, busy: Scene
) -> None:
    body = (await _diversity(busy.world, api)).json()

    for entry in body["data"]:
        assert set(entry) == PLAIN_ENGINE_KEYS
    assert set(body["meta"]) == PLAIN_META_KEYS


async def test_diversity_follows_the_scope(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A branded prompt cites the rival: left out unless asked for. A refused, a superseded and
    a not current answer cite the wiki and never count. Another project of the workspace cites
    the own page and is never counted. The engine filter keeps one engine."""
    world = scene.world
    branded = await add_prompt(migrated, world.project, "Is Eventus any good?", branded=True)
    await _answer(migrated, scene, 2, Cite(GUIDE))
    await _answer(migrated, scene, 2, world.rival_cite(), prompt=branded)
    await _answer(migrated, scene, 3, Cite(WIKI), engine="gemini_web")
    await _answer(migrated, scene, 4, Cite(WIKI), valid=False)
    await _answer(migrated, scene, 4, Cite(WIKI), superseded=True)
    await _answer(migrated, scene, 4, Cite(WIKI), current=False)
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    elsewhere = replace(world, project=other, derivation_id=await derivation_of(migrated, other))
    theirs = await add_prompt(migrated, other, "Best managed SOC providers?")
    await answer(migrated, elsewhere, theirs, days_ago=1, cites=[Cite(OWN), Cite(WIKI)])

    plain = _engines(await _diversity(world, api))
    branded_too = await _diversity(world, api, include_branded="true")
    asked = _engines(branded_too)
    gemini = await _diversity(world, api, **{"filter[engine_code_in]": "gemini_web"})

    assert (plain["chatgpt_web"]["answers"], plain["chatgpt_web"]["distinct_domains"]) == (1, 1)
    assert (asked["chatgpt_web"]["answers"], asked["chatgpt_web"]["distinct_domains"]) == (2, 2)
    assert branded_too.json()["meta"]["include_branded"] is True
    assert list(_engines(gemini)) == ["gemini_web"]
    assert _engines(gemini)["gemini_web"]["citation_units"] == 1
    assert gemini.json()["meta"]["engine_codes"] == ["gemini_web"]


async def test_diversity_follows_the_country(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    german = await add_prompt(
        migrated, scene.world.project, "Bester SOC Anbieter?", country="DE", language="de"
    )
    await _answer(migrated, scene, 2, Cite(GUIDE))
    await _answer(migrated, scene, 2, Cite(WIKI), Cite(OWN), prompt=german)

    de = _engines(await _diversity(scene.world, api, **{"filter[country_iso]": "DE"}))
    us = _engines(await _diversity(scene.world, api, **{"filter[country_iso]": "US"}))

    assert (de["chatgpt_web"]["answers"], de["chatgpt_web"]["citation_units"]) == (1, 2)
    assert (us["chatgpt_web"]["answers"], us["chatgpt_web"]["citation_units"]) == (1, 1)


async def test_diversity_is_one_statement_and_each_include_one_more(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The base plan's 3,600 answers: the first read of the freshly loaded project (no
    statistics) is timed, 15 s being the hard limit; each read sends as many statements as for
    a small project, `include=series` one more and `include=ads` one more."""
    await _answer(migrated, scene, 2, Cite(GUIDE), Cite(OWN))
    full = await full_project(resources, migrated)

    started = time.perf_counter()
    cold = await _diversity(full, api)
    assert time.perf_counter() - started < 15
    body = cold.json()
    engines = _engines(cold)
    assert sum(entry["answers"] for entry in engines.values()) == FULL_ANSWERS
    assert sum(entry["citation_units"] for entry in engines.values()) == FULL_ANSWERS * 10
    assert body["meta"]["distinct_domains"] == 20
    for entry in engines.values():
        assert 1 <= entry["effective_sources"]["value"] <= 20
    counts: dict[str, tuple[int, int]] = {}
    for include in ({}, {"include": "series"}, {"include": "ads"}):
        await _diversity(scene.world, api, **include)
        with statements(resources) as small:
            await _diversity(scene.world, api, **include)
        with statements(resources) as large:
            await _diversity(full, api, **include)
        assert len(large) == len(small), large
        counts[str(include)] = (len(small), len(large))
    plain = counts["{}"][0]
    assert counts["{'include': 'series'}"][0] - plain == 1
    assert counts["{'include': 'ads'}"][0] - plain == 1


async def test_diversity_of_a_deleted_or_unknown_project_is_not_found(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    unknown = await api.get(
        world.url("ai", "sources", "diversity").replace(str(world.project.id), str(uuid.uuid4())),
        headers=world.owner.headers,
    )
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )
    deleted = await _diversity(world, api)

    assert problem(deleted) == problem(unknown) == NOT_FOUND
