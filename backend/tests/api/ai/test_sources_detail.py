"""The detail of one cited domain (WP-14 T5; BE-SOURCES-11; plan O12): its rows, its 10 most cited
pages, the 20 prompts whose answers cite it most, its units per engine and week with the weekly
total of every domain (the share's denominator) and the 5 tracked entities named most in the
answers that cite it. A domain not cited in scope is `200` with empty lists. The expected numbers
are worked out by hand from the answers below."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai.summary import summary_weeks
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    FULL_ANSWERS,
    GUIDE,
    GUIDE_TOP,
    WIKI,
    Cite,
    World,
    answer,
    derivation_of,
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.conftest import PostgresServer

EXAMPLE = "example.org"
NOT_FOUND = (404, "not_found")
ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]


@dataclass(frozen=True)
class Scene:
    world: World
    prompts: dict[str, Prompt]
    answers: dict[str, int]


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Prompts `a` and `b`; days before now in brackets. `example.org` is cited by three of the
    four answers: as a third party on two pages and as the rival on the guide.

      a1 ChatGPT (1)  guide, top page (www.example.org), wiki   2 units of example.org
      a2 Gemini  (2)  guide                                     1 unit
      a3 ChatGPT (3)  guide, as the rival's page                1 unit (competitor)
      b1 ChatGPT (2)  top page, wiki                            1 unit
    """
    world = await make_world(resources, migrated)
    prompts = {
        "a": await add_prompt(migrated, world.project, "Best managed SOC providers?"),
        "b": await add_prompt(migrated, world.project, "How much does a managed SOC cost?"),
    }
    answers: dict[str, int] = {}

    async def add(name: str, prompt: str, days: float, cites: list[Cite], **kw: Any) -> None:
        answers[name] = await answer(
            migrated, world, prompts[prompt], days_ago=days, cites=cites, **kw
        )

    await add("a1", "a", 1, [Cite(GUIDE), Cite(GUIDE_TOP), Cite(WIKI)])
    await add("a2", "a", 2, [Cite(GUIDE)], engine="gemini_web")
    await add("a3", "a", 3, [world.rival_cite(GUIDE)])
    await add("b1", "b", 2, [Cite(GUIDE_TOP), Cite(WIKI)])
    return Scene(world, prompts, answers)


async def _detail(
    world: World, api: httpx.AsyncClient, domain: str = EXAMPLE, **params: Any
) -> httpx.Response:
    return await api.get(
        world.url("ai", "sources", "domains", domain), params=params, headers=world.owner.headers
    )


async def _list(world: World, api: httpx.AsyncClient, *path: str, **params: Any) -> dict[str, Any]:
    response = await api.get(world.url("ai", *path), params=params, headers=world.owner.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _data(response: httpx.Response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def _mention(
    pg: PostgresServer,
    world: World,
    observation_id: int,
    entity_id: uuid.UUID,
    *,
    current: bool = True,
    status: str = "accepted",
    derivation_id: int | None = None,
) -> None:
    """The mention of a tracked entity in an answer, as `seed_extraction` writes one."""
    observation = await fetchrow(
        pg,
        "SELECT observed_at, engine_code FROM ai.observations WHERE id = $1",
        observation_id,
    )
    await execute(
        pg,
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, confidence, evidence_spans, mention_status, "
        "is_current) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 0, 1, 1, 'alias_word', 1, "
        "ARRAY['[0,8)'::int4range], $9, $10)",
        observation_id,
        observation["observed_at"],
        entity_id,
        world.derivation_id if derivation_id is None else derivation_id,
        world.project.workspace_id,
        world.project.id,
        observation["engine_code"],
        "own" if entity_id == world.own else "competitor",
        status,
        current,
    )


async def test_a_domain_detail_has_its_rows_pages_prompts_and_engines(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The rows and pages are the domain and page lists' own, kept to this domain: the role
    split stays, and the wiki's page is not among them. Prompt `a` has 4 units in 3 answers."""
    world = scene.world
    detail = await api.get(
        world.url("ai", "sources", "domains", EXAMPLE), headers=world.owner.headers
    )
    domains = await _list(world, api, "sources", "domains")
    pages = await _list(world, api, "sources", "pages", **{"filter[registrable_domain]": EXAMPLE})

    body = detail.json()
    data = _data(detail)
    assert data["registrable_domain"] == EXAMPLE
    assert [
        (r["domain_role"], r["citation_units"], r["observations"], r["prompts"])
        for r in data["rows"]
    ] == [
        ("third_party", 4, 3, 2),
        ("competitor", 1, 1, 1),
    ]
    assert data["rows"] == [r for r in domains["data"] if r["registrable_domain"] == EXAMPLE]
    assert [(r["url"], r["domain_role"], r["citation_units"]) for r in data["top_pages"]] == [
        (GUIDE, "third_party", 2),
        (GUIDE_TOP, "third_party", 2),
        (GUIDE, "competitor", 1),
    ]
    assert data["top_pages"] == pages["data"]
    assert [(p["prompt_id"], p["citation_units"], p["observations"]) for p in data["prompts"]] == [
        (str(scene.prompts["a"].id), 4, 3),
        (str(scene.prompts["b"].id), 1, 1),
    ]
    assert [e["engine_code"] for e in data["engines"]] == ENGINES
    units = {
        e["engine_code"]: sum(point["citation_units"] for point in e["series"])
        for e in data["engines"]
    }
    assert units == {"chatgpt_web": 4, "gemini_web": 1, "google_ai_mode": 0}
    assert data["cited_with"] == []
    assert body["meta"] == domains["meta"]


async def test_the_engine_series_holds_the_share_denominator(
    api: httpx.AsyncClient, migrated: PostgresServer, resources: Resources
) -> None:
    """Three whole weeks m0, m1, m2 (Monday to Sunday, UTC) ending on the last Sunday. ChatGPT
    m0: one answer, the guide, its top page and the wiki: 2 of 3 units are the domain's. m1: two
    answers, the wiki, and the guide: 1 of 2 units. m2: an answer that cites nothing. Gemini m0:
    an answer citing the wiki only. AI Mode: no answer."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    today = datetime.now(UTC).date()
    last = today - timedelta(days=today.weekday() + 1)
    first = last - timedelta(days=20)

    def noon(day: int) -> float:
        at = datetime.combine(first + timedelta(days=day), datetime.min.time(), tzinfo=UTC)
        return (datetime.now(UTC) - at - timedelta(hours=12)).total_seconds() / 86400

    async def add(day: int, *cites: Cite, engine: str = "chatgpt_web") -> None:
        await answer(migrated, world, prompt, days_ago=noon(day), engine=engine, cites=cites)

    await add(1, Cite(GUIDE), Cite(GUIDE_TOP), Cite(WIKI))
    await add(8, Cite(WIKI))
    await add(9, Cite(GUIDE))
    await add(15)
    await add(2, Cite(WIKI), engine="gemini_web")

    response = await _detail(world, api, **{"from": first.isoformat(), "to": last.isoformat()})

    series = {
        e["engine_code"]: [
            (
                point["week_start"],
                point["citation_units"],
                point["observations"],
                point["all_citation_units"],
                point["answers"],
            )
            for point in e["series"]
        ]
        for e in _data(response)["engines"]
    }
    m0, m1, m2 = (week.isoformat() for week in summary_weeks(first, last))
    assert series == {
        "chatgpt_web": [(m0, 2, 1, 3, 1), (m1, 1, 1, 2, 2), (m2, 0, 0, 0, 1)],
        "gemini_web": [(m0, 0, 0, 1, 1), (m1, 0, 0, 0, 0), (m2, 0, 0, 0, 0)],
        "google_ai_mode": [(m0, 0, 0, 0, 0), (m1, 0, 0, 0, 0), (m2, 0, 0, 0, 0)],
    }


async def test_the_engine_series_follow_the_engine_filter(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _detail(scene.world, api, **{"filter[engine_code_in]": "gemini_web"})

    data = _data(response)
    assert [e["engine_code"] for e in data["engines"]] == ["gemini_web"]
    assert [(r["domain_role"], r["citation_units"]) for r in data["rows"]] == [("third_party", 1)]
    assert response.json()["meta"]["engine_codes"] == ["gemini_web"]


async def test_the_detail_cites_with_entities(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The rival is named in two answers citing the domain (a1 cites it on two pages: one
    answer, counted once), the own brand in one. An answer that names the rival and does not cite
    the domain does not count."""
    world, ids = scene.world, scene.answers
    wiki_only = await answer(migrated, world, scene.prompts["a"], days_ago=4, cites=[Cite(WIKI)])
    await _mention(migrated, world, ids["a1"], world.rival)
    await _mention(migrated, world, ids["a2"], world.rival)
    await _mention(migrated, world, ids["a1"], world.own)
    await _mention(migrated, world, wiki_only, world.rival)

    response = await _detail(world, api)

    assert _data(response)["cited_with"] == [
        {"entity_id": str(world.rival), "observations": 2},
        {"entity_id": str(world.own), "observations": 1},
    ]


async def test_a_mention_of_an_old_extraction_does_not_count(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world, ids = scene.world, scene.answers
    await _mention(migrated, world, ids["a1"], world.rival, current=False)
    await _mention(migrated, world, ids["a1"], world.own)

    assert _data(await _detail(world, api))["cited_with"] == [
        {"entity_id": str(world.own), "observations": 1}
    ]


async def test_a_mention_the_extraction_is_unsure_of_does_not_count(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world, ids = scene.world, scene.answers
    await _mention(migrated, world, ids["a1"], world.rival, status="uncertain")

    assert _data(await _detail(world, api))["cited_with"] == []


async def test_a_mention_of_another_derivation_does_not_count(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The answer's facts are of one derivation: a mention another derivation wrote, current in
    its own, is not what the counted answer says."""
    world, ids = scene.world, scene.answers
    second = await fetchrow(
        migrated,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 2, 1, 1, 1) RETURNING id",
        world.project.workspace_id,
        world.project.id,
    )
    await _mention(migrated, world, ids["a1"], world.rival, derivation_id=second["id"])
    await _mention(migrated, world, ids["a1"], world.own)

    assert _data(await _detail(world, api))["cited_with"] == [
        {"entity_id": str(world.own), "observations": 1}
    ]


async def test_a_domain_not_cited_answers_empty_lists(api: httpx.AsyncClient, scene: Scene) -> None:
    response = await _detail(scene.world, api, "nowhere.example")

    data = _data(response)
    assert data["registrable_domain"] == "nowhere.example"
    for name in ("rows", "engines", "top_pages", "prompts", "cited_with"):
        assert data[name] == [], name
    assert response.json()["meta"]["answers"] == 4
    assert response.json()["meta"]["citation_units"] == 7


async def test_a_domain_is_read_in_lower_case(api: httpx.AsyncClient, scene: Scene) -> None:
    data = _data(await _detail(scene.world, api, "Example.ORG"))

    assert data["registrable_domain"] == EXAMPLE
    assert len(data["rows"]) == 2


async def test_the_detail_of_www_and_bare_host_is_one_domain(
    api: httpx.AsyncClient, migrated: PostgresServer, resources: Resources
) -> None:
    """`www.example.org` and `guide.example.org` are one registrable domain: one row of 2 units."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE), Cite(GUIDE_TOP)])

    data = _data(await _detail(world, api))

    assert [(r["registrable_domain"], r["citation_units"]) for r in data["rows"]] == [(EXAMPLE, 2)]
    assert sorted(r["url"] for r in data["top_pages"]) == [GUIDE, GUIDE_TOP]


async def test_the_detail_follows_the_scope(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A branded prompt cites the domain: left out unless asked for. A refused, a superseded and
    a not current answer cite it and never count. Another project of the workspace cites it and
    is never counted."""
    world = scene.world
    branded = await add_prompt(migrated, world.project, "Is Eventus any good?", branded=True)
    await answer(migrated, world, branded, days_ago=2, cites=[Cite(GUIDE)])
    a, cites = scene.prompts["a"], [Cite(GUIDE)]
    await answer(migrated, world, a, days_ago=4, cites=cites, valid=False)
    await answer(migrated, world, a, days_ago=4, cites=cites, superseded=True)
    await answer(migrated, world, a, days_ago=4, cites=cites, current=False)
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    elsewhere = replace(world, project=other, derivation_id=await derivation_of(migrated, other))
    theirs = await add_prompt(migrated, other, "Best managed SOC providers?")
    await answer(migrated, elsewhere, theirs, days_ago=1, cites=[Cite(GUIDE), Cite(GUIDE_TOP)])

    plain_response = await _detail(world, api)
    plain = _data(plain_response)
    asked = _data(await _detail(world, api, include_branded="true"))

    assert (
        plain_response.json()["meta"]["answers"],
        plain_response.json()["meta"]["citation_units"],
    ) == (4, 7)
    assert [(r["domain_role"], r["citation_units"]) for r in plain["rows"]] == [
        ("third_party", 4),
        ("competitor", 1),
    ]
    assert [(r["domain_role"], r["citation_units"]) for r in asked["rows"]] == [
        ("third_party", 5),
        ("competitor", 1),
    ]


async def test_the_detail_follows_the_country(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    german = await add_prompt(
        migrated, scene.world.project, "Bester SOC Anbieter?", country="DE", language="de"
    )
    await answer(migrated, scene.world, german, days_ago=2, cites=[Cite(GUIDE)])

    de = _data(await _detail(scene.world, api, **{"filter[country_iso]": "DE"}))
    us = _data(await _detail(scene.world, api, **{"filter[country_iso]": "US"}))

    assert [r["citation_units"] for r in de["rows"]] == [1]
    assert [r["citation_units"] for r in us["rows"]] == [4, 1]


async def test_the_detail_is_a_fixed_number_of_statements(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The base plan's 3,600 answers: the first read of the freshly loaded project (no
    statistics) is timed, 15 s being the hard limit, and sends as many statements as a read of a
    small project."""
    full = await full_project(resources, migrated)

    started = time.perf_counter()
    cold = await _detail(full, api, "site0.net")
    assert time.perf_counter() - started < 15
    await _detail(scene.world, api)
    with statements(resources) as small:
        await _detail(scene.world, api)
    with statements(resources) as large:
        await _detail(full, api, "site0.net")

    data = _data(cold)
    assert 0 < data["rows"][0]["citation_units"] <= FULL_ANSWERS * 10
    assert len(data["top_pages"]) == 3
    assert len(data["prompts"]) == 20
    assert len(large) == len(small), large


async def test_a_detail_of_another_project_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """An owner of another workspace, a deleted project and an unknown one are all `404`; the
    project is looked up before anything is read."""
    world = scene.world
    outsider = await member(resources, migrated, await make_workspace(migrated), "owner")
    foreign = await api.get(
        world.url("ai", "sources", "domains", EXAMPLE), headers=outsider.headers
    )
    unknown = await api.get(
        world.url("ai", "sources", "domains", EXAMPLE).replace(
            str(world.project.id), str(uuid.uuid4())
        ),
        headers=world.owner.headers,
    )
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )
    deleted = await _detail(world, api)

    assert problem(foreign) == problem(unknown) == problem(deleted) == NOT_FOUND


async def test_the_detail_lists_are_bounded(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """12 pages of one domain in one answer, 25 prompts citing it, 11 rival brands whose rule
    matched it (a row each, beside the third party's) and 6 of them named in the answers: the
    lists stop at 10 pages, 20 prompts, 10 rows and 5 entities."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    pages = [Cite(f"https://docs.example.org/page{n}") for n in range(12)]
    await answer(migrated, world, prompt, days_ago=1, cites=pages)
    for n in range(25):
        asked = await add_prompt(migrated, world.project, f"Question {n} about SOC services?")
        await answer(migrated, world, asked, days_ago=2, cites=[Cite(GUIDE)])
    rivals = [
        await _entity(migrated, world.project, f"Rival {n}", f"rival{n}.example", "competitor")
        for n in range(11)
    ]
    for entity in rivals:
        cited = await answer(
            migrated, world, prompt, days_ago=3, cites=[Cite(GUIDE, "competitor", entity)]
        )
        if entity in rivals[:6]:
            await _mention(migrated, world, cited, entity)

    data = _data(await _detail(world, api))

    assert len(data["top_pages"]) == 10
    assert len(data["prompts"]) == 20
    assert len(data["rows"]) == 10
    assert len(data["cited_with"]) == 5
    assert data["rows"][0]["domain_role"] == "third_party"


async def test_a_viewer_reads_the_detail(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    viewer = await member(resources, migrated, scene.world.workspace, "viewer")

    response = await api.get(
        scene.world.url("ai", "sources", "domains", EXAMPLE), headers=viewer.headers
    )

    assert response.status_code == 200, response.text
