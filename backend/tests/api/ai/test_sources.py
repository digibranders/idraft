"""Sources by registrable domain (plan D2 Task 1; docs/16 section 7, C1 and C2): citation units,
answers and prompts per domain and engine, the share of every unit in scope, over the answers the
prompts summary counts. The expected numbers are worked out by hand from the answers below."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    GUIDE,
    GUIDE_TOP,
    OWN_BLOG,
    WIKI,
    Cite,
    World,
    answer,
    derivation_of,
    full_project,
    make_world,
    statements,
    tag,
    topic_of,
)
from tests.api.auth.support import execute, fetch
from tests.api.entities.support import member, problem
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import OWN_HOST, RIVAL_HOST, Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

EVENTUS, CYBERNX, EXAMPLE, WIKIPEDIA = OWN_HOST, RIVAL_HOST, "example.org", "wikipedia.org"
PRICING = f"https://{OWN_HOST}/pricing"
ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]


@dataclass(frozen=True)
class Scene:
    world: World
    prompts: dict[str, Prompt]
    answers: dict[str, int]
    topic: uuid.UUID


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Prompts `a` and `b` (b in topic Pricing), a branded one and an archived one. Days before
    now in brackets; counted answers first.

      a1 ChatGPT (1)  own page, guide, wiki, own page again   4 rows, 3 units
      a2 ChatGPT (2)  own page (title, 5 occurrences), own blog (www), rival
      a3 Gemini  (3)  guide, guide top (www.example.org), rival, eventussecurity.com/pricing
                      (cited as a third party: the domain is the own one, the role is not)
      b1 ChatGPT (2)  wiki, rival
      b2 AI Mode (4)  own page
      c1 ChatGPT (6)  no citations at all
    Left out: a refusal, a superseded answer and one whose facts are not current, each citing the
    own page; an answer 28 days ago (the window opens 27 days ago); the branded prompt's answer
    (own page); the archived prompt's answer (rival)."""
    world = await make_world(resources, migrated)
    project = world.project
    prompts = {
        "a": await add_prompt(migrated, project, "Best managed SOC providers?"),
        "b": await add_prompt(migrated, project, "How much does a managed SOC cost?"),
        "brand": await add_prompt(migrated, project, "Is Eventus Security any good?", branded=True),
        "archived": await add_prompt(migrated, project, "An old SOC question?", active=False),
    }
    topic = await topic_of(migrated, world, "Pricing")
    await tag(migrated, world, prompts["b"], topic)
    own, rival = world.own_cite(), world.rival_cite()
    guide, top, wiki = Cite(GUIDE), Cite(GUIDE_TOP), Cite(WIKI)
    answers: dict[str, int] = {}

    async def add(name: str, prompt: str, days: float, cites: list[Cite], **kw: Any) -> None:
        answers[name] = await answer(
            migrated, world, prompts[prompt], days_ago=days, cites=cites, **kw
        )

    await add("a1", "a", 1, [own, guide, wiki, own])
    await add(
        "a2",
        "a",
        2,
        [
            world.own_cite(title="Managed SOC by Eventus", occurrences=5),
            world.own_cite(OWN_BLOG),
            rival,
        ],
    )
    await add("a3", "a", 3, [guide, top, rival, Cite(PRICING)], engine="gemini_web")
    await add("b1", "b", 2, [wiki, rival])
    await add("b2", "b", 4, [own], engine="google_ai_mode")
    await add("c1", "a", 6, [])
    await add("refused", "a", 5, [own], valid=False)
    await add("superseded", "a", 6, [own], superseded=True)
    await add("not_current", "a", 7, [own], current=False)
    await add("old", "a", 28, [own])
    await add("brand", "brand", 2, [own])
    await add("archived", "archived", 2, [rival])
    return Scene(world, prompts, answers, topic)


async def _get(world: World, api: httpx.AsyncClient, *path: str, **params: Any) -> httpx.Response:
    return await api.get(world.url("ai", *path), params=params, headers=world.owner.headers)


def _row(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        row["registrable_domain"],
        row["domain_role"],
        row["citation_units"],
        row["observations"],
        row["prompts"],
        [engine["citation_units"] for engine in row["engines"]],
    )


def _domains(response: httpx.Response) -> list[tuple[Any, ...]]:
    assert response.status_code == 200, response.text
    return [_row(row) for row in response.json()["data"]]


def _day(days: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


async def test_each_domain_has_its_units_answers_prompts_and_engines(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(scene.world, api, "sources", "domains")

    assert _domains(response) == [
        (EVENTUS, "own", 4, 3, 2, [3, 0, 1]),
        (CYBERNX, "competitor", 3, 3, 2, [2, 1, 0]),
        (EXAMPLE, "third_party", 3, 2, 1, [1, 2, 0]),
        (WIKIPEDIA, "third_party", 2, 2, 2, [2, 0, 0]),
        (EVENTUS, "third_party", 1, 1, 1, [0, 1, 0]),
    ]
    data = response.json()["data"]
    assert [engine["engine_code"] for engine in data[0]["engines"]] == ENGINES
    assert (data[0]["role_entity_id"], data[1]["role_entity_id"]) == (
        str(scene.world.own),
        str(scene.world.rival),
    )
    assert data[2]["role_entity_id"] is None
    share = data[0]["source_share"]
    assert (share["numerator"], share["denominator"], share["n_observations"]) == (4, 13, 6)
    assert share["value"] == pytest.approx(4 / 13)
    assert response.json()["page"] == {"offset": 0, "limit": 50, "total": 5}


async def test_one_registrable_domain_cited_in_two_roles_is_two_rows(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The own domain is cited as the own brand (4 units) and, on its pricing page in a3, as a
    third party (1 unit): one row for each role, not one for the domain."""
    rows = [
        row
        for row in (await _get(scene.world, api, "sources", "domains")).json()["data"]
        if row["registrable_domain"] == EVENTUS
    ]

    assert [(row["domain_role"], row["citation_units"]) for row in rows] == [
        ("own", 4),
        ("third_party", 1),
    ]
    assert [row["role_entity_id"] for row in rows] == [str(scene.world.own), None]


async def test_a_url_cited_twice_in_one_answer_is_one_unit_and_occurrences_do_not_count(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """a1 lists the own page twice and a2 says it occurred 5 times: the own domain has 4 units
    (a1 1, a2 2, b2 1), not 5 or 9."""
    (own, *_) = _domains(await _get(scene.world, api, "sources", "domains"))

    assert own[:3] == (EVENTUS, "own", 4)


async def test_the_meta_states_the_answers_the_units_and_each_role(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    response = await _get(scene.world, api, "sources", "domains")

    meta = response.json()["meta"]
    # c1 is counted and cites nothing: 6 answers, 5 of them citing.
    assert (meta["answers"], meta["answers_citing"], meta["citation_units"]) == (6, 5, 13)
    assert meta["by_role"] == [
        {"domain_role": "own", "citation_units": 4, "observations": 3},
        {"domain_role": "competitor", "citation_units": 3, "observations": 3},
        {"domain_role": "third_party", "citation_units": 6, "observations": 3},
    ]
    assert meta["engine_codes"] == ENGINES
    assert meta["include_branded"] is False
    assert meta["window"]["from"] == _day(27)
    assert meta["window"]["to"] == _day(0)
    seen = await fetch(
        migrated,
        "SELECT id, observed_at FROM ai.observations WHERE id = ANY($1)",
        [scene.answers["a1"], scene.answers["b2"]],
    )
    at = {row["id"]: row["observed_at"] for row in seen}
    own = response.json()["data"][0]
    assert datetime.fromisoformat(own["first_seen_at"]) == at[scene.answers["b2"]]
    assert datetime.fromisoformat(own["last_seen_at"]) == at[scene.answers["a1"]]


async def test_domains_sort_by_prompts_then_units(api: httpx.AsyncClient, scene: Scene) -> None:
    by_prompts = _domains(await _get(scene.world, api, "sources", "domains", sort="-prompts"))
    by_answers = _domains(await _get(scene.world, api, "sources", "domains", sort="-observations"))

    assert [row[0] for row in by_prompts] == [EVENTUS, CYBERNX, WIKIPEDIA, EXAMPLE, EVENTUS]
    assert [row[0] for row in by_answers] == [EVENTUS, CYBERNX, EXAMPLE, WIKIPEDIA, EVENTUS]


async def test_branded_prompts_count_when_asked_for(api: httpx.AsyncClient, scene: Scene) -> None:
    response = await _get(scene.world, api, "sources", "domains", include_branded="true")

    assert _domains(response)[0] == (EVENTUS, "own", 5, 4, 3, [4, 0, 1])
    meta = response.json()["meta"]
    assert (meta["answers"], meta["citation_units"], meta["include_branded"]) == (7, 14, True)


async def test_one_prompt_is_read_whether_archived_or_branded(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    archived = await _get(
        scene.world,
        api,
        "sources",
        "domains",
        **{"filter[prompt_id]": str(scene.prompts["archived"].id)},
    )
    branded = await _get(
        scene.world,
        api,
        "sources",
        "domains",
        **{"filter[prompt_id]": str(scene.prompts["brand"].id)},
    )

    assert _domains(archived) == [(CYBERNX, "competitor", 1, 1, 1, [1, 0, 0])]
    assert _domains(branded) == [(EVENTUS, "own", 1, 1, 1, [1, 0, 0])]
    assert archived.json()["meta"]["answers"] == 1


async def test_an_engine_filter_keeps_its_answers_and_its_column(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(
        scene.world, api, "sources", "domains", **{"filter[engine_code_in]": "gemini_web"}
    )

    assert _domains(response) == [
        (EXAMPLE, "third_party", 2, 1, 1, [2]),
        (CYBERNX, "competitor", 1, 1, 1, [1]),
        (EVENTUS, "third_party", 1, 1, 1, [1]),
    ]
    meta = response.json()["meta"]
    assert (meta["engine_codes"], meta["answers"], meta["citation_units"]) == (
        ["gemini_web"],
        1,
        4,
    )


async def test_a_role_filter_narrows_the_rows_not_the_share(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    response = await _get(
        scene.world, api, "sources", "domains", **{"filter[domain_role_in]": "own"}
    )

    assert _domains(response) == [(EVENTUS, "own", 4, 3, 2, [3, 0, 1])]
    share = response.json()["data"][0]["source_share"]
    assert (share["numerator"], share["denominator"]) == (4, 13)
    assert response.json()["meta"]["citation_units"] == 13


async def test_a_term_keeps_the_prompts_given_it(api: httpx.AsyncClient, scene: Scene) -> None:
    response = await _get(
        scene.world, api, "sources", "domains", **{"filter[term]": str(scene.topic)}
    )

    assert _domains(response) == [
        (CYBERNX, "competitor", 1, 1, 1, [1, 0, 0]),
        (EVENTUS, "own", 1, 1, 1, [0, 0, 1]),
        (WIKIPEDIA, "third_party", 1, 1, 1, [1, 0, 0]),
    ]
    assert (response.json()["meta"]["answers"], response.json()["meta"]["citation_units"]) == (2, 3)


async def test_pages_of_rows_and_a_page_past_the_end(api: httpx.AsyncClient, scene: Scene) -> None:
    second = await _get(scene.world, api, "sources", "domains", offset=2, limit=2)
    beyond = await _get(scene.world, api, "sources", "domains", offset=10, limit=2)

    assert [row[0] for row in _domains(second)] == [EXAMPLE, WIKIPEDIA]
    assert second.json()["page"] == {"offset": 2, "limit": 2, "total": 5}
    assert _domains(beyond) == []
    assert beyond.json()["page"] == {"offset": 10, "limit": 2, "total": 5}


async def test_the_window_bounds_the_answers(api: httpx.AsyncClient, scene: Scene) -> None:
    """`to` two days ago leaves a1 (yesterday, 3 units) out; `from` is given too, because a `to`
    alone moves the default 28 day window with it and would take in the answer of 28 days ago."""
    response = await _get(
        scene.world, api, "sources", "domains", **{"from": _day(27), "to": _day(2)}
    )
    too_large = await _get(scene.world, api, "sources", "domains", **{"from": _day(100)})
    reversed_ = await _get(
        scene.world, api, "sources", "domains", **{"from": _day(1), "to": _day(3)}
    )

    meta = response.json()["meta"]
    assert (meta["answers"], meta["citation_units"]) == (5, 10)
    assert problem(too_large) == (422, "window_too_large")
    assert problem(reversed_) == (422, "validation_failed")


async def test_another_projects_answers_do_not_count_and_a_deleted_project_is_not_found(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    elsewhere = replace(world, project=other, derivation_id=await derivation_of(migrated, other))
    theirs = await add_prompt(migrated, other, "Best managed SOC providers?")
    await answer(migrated, elsewhere, theirs, days_ago=1, cites=[world.own_cite()])

    counted = await _get(world, api, "sources", "domains")
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )
    deleted = await _get(world, api, "sources", "domains")
    unknown = await api.get(
        elsewhere.url("ai", "sources", "domains").replace(str(other.id), str(uuid.uuid4())),
        headers=world.owner.headers,
    )

    assert _domains(counted)[0] == (EVENTUS, "own", 4, 3, 2, [3, 0, 1])
    assert problem(deleted) == problem(unknown) == (404, "not_found")


async def test_another_workspaces_answers_and_domains_are_never_counted_or_shown(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """A second workspace answers the same prompt text, cites the own domain's page as its own
    brand and a domain nobody in the first cites. The first workspace's rows, meta and shares do
    not move, its body holds nothing of the second, and the second reads only its own."""
    before = (await _get(scene.world, api, "sources", "domains")).json()

    other = await make_world(resources, migrated)
    theirs = await add_prompt(migrated, other.project, "Best managed SOC providers?")
    await answer(
        migrated,
        other,
        theirs,
        days_ago=1,
        cites=[other.own_cite(), Cite("https://secret.tenantb.io/soc")],
    )
    after = await _get(scene.world, api, "sources", "domains")
    theirs_read = await _get(other, api, "sources", "domains")

    assert after.json() == before
    assert "tenantb.io" not in after.text
    assert str(other.own) not in after.text
    assert _domains(theirs_read) == [
        (EVENTUS, "own", 1, 1, 1, [1, 0, 0]),
        ("tenantb.io", "third_party", 1, 1, 1, [1, 0, 0]),
    ]
    assert theirs_read.json()["meta"]["answers"] == 1
    assert str(scene.world.own) not in theirs_read.text


async def test_a_viewer_reads_the_sources(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    viewer = await member(resources, migrated, scene.world.workspace, "viewer")

    response = await api.get(scene.world.url("ai", "sources", "domains"), headers=viewer.headers)

    assert response.status_code == 200, response.text


async def test_a_full_project_reads_as_many_statements_as_a_small_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The base plan's 3,600 answers with 36,000 citations: one grouped statement for the rows
    and two for the totals, whatever the size. A first read by each owner warms their session
    cache, so both counted reads start alike."""
    full = await full_project(resources, migrated)
    await _get(full, api, "sources", "domains")
    await _get(scene.world, api, "sources", "domains")
    with statements(resources) as small:
        await _get(scene.world, api, "sources", "domains")
    with statements(resources) as large:
        response = await _get(full, api, "sources", "domains")

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["meta"]["answers"], body["meta"]["citation_units"]) == (3600, 36000)
    assert body["page"]["total"] == 20
    assert len(large) == len(small), large
