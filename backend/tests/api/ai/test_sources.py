"""Sources by registrable domain (plan D2 Task 1; docs/16 section 7, C1 and C2): citation units,
answers and prompts per domain and engine, the share of every unit in scope, over the answers the
prompts summary counts. The expected numbers are worked out by hand from the answers below."""

from __future__ import annotations

import time
import uuid
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta, timezone
from itertools import pairwise
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from idraft.api.ai.sources import SourceService
from idraft.api.auth.sessions import SessionContext
from idraft.api.permissions import Role
from idraft.api.resources import Resources
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import create_session_factory, workspace_transaction
from tests.api.ai.sources_support import (
    AT,
    FULL_ANSWERS,
    GUIDE,
    GUIDE_TOP,
    OWN,
    OWN_BLOG,
    RIVAL,
    WIKI,
    Cite,
    World,
    answer,
    cursor_key,
    derivation_of,
    forged_cursor,
    full_project,
    make_world,
    page_ids,
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
    """The base plan's 3,600 answers with 36,000 citations, 300 of them replaced by a newer
    answer and so not counted: one grouped statement for the rows and two for the totals,
    whatever the size. The first read of the freshly loaded project (no ANALYZE: no statistics)
    is timed: 15 s is the hard limit. A first read by each owner warms their session cache, so
    both counted reads start alike."""
    full = await full_project(resources, migrated)
    started = time.perf_counter()
    cold = await _get(full, api, "sources", "domains")
    assert time.perf_counter() - started < 15
    assert cold.status_code == 200, cold.text
    await _get(scene.world, api, "sources", "domains")
    with statements(resources) as small:
        await _get(scene.world, api, "sources", "domains")
    with statements(resources) as large:
        response = await _get(full, api, "sources", "domains")

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["meta"]["answers"], body["meta"]["citation_units"]) == (
        FULL_ANSWERS,
        FULL_ANSWERS * 10,
    )
    assert body["page"]["total"] == 20
    assert len(large) == len(small), large


async def test_the_read_transaction_turns_nested_loops_off_and_gives_the_connection_back(
    engine: AsyncEngine,
) -> None:
    """The reads run at REPEATABLE READ with nested loops off, for this transaction only: the
    guard that keeps a planner without statistics from timing out. The pool holds one
    connection, so the next transaction runs on the same server session and must find the
    defaults."""
    sessions = create_session_factory(engine)
    now = datetime.now(UTC)
    access = WorkspaceAccess(
        session=SessionContext(
            session_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            state="active",
            fresh_until=None,
            idle_expires_at=now + timedelta(days=1),
            absolute_expires_at=now + timedelta(days=1),
            last_seen_at=now,
        ),
        workspace_id=uuid.uuid4(),
        role=Role.VIEWER,
        project_ids=None,
    )
    settings = ("SHOW enable_nestloop", "SHOW transaction_isolation")

    async def read(transaction: AbstractAsyncContextManager[AsyncSession]) -> list[Any]:
        async with transaction as db:
            return [(await db.execute(text(sql))).scalar_one() for sql in settings]

    guarded = await read(SourceService(sessions=sessions)._transaction(access))
    ordinary = await read(workspace_transaction(sessions, access.workspace_id))

    assert guarded == ["off", "repeatable read"]
    assert ordinary == ["on", "read committed"]


def _page(row: dict[str, Any]) -> tuple[Any, ...]:
    return row["url"], row["citation_units"], row["observations"], row["prompts"]


async def test_each_page_has_its_units_and_a_title_an_answer_gave_it(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """Ties on units sort by canonical URL: the rival's page before the own page."""
    response = await _get(scene.world, api, "sources", "pages")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [_page(row) for row in data] == [
        (RIVAL, 3, 3, 2),
        (OWN, 3, 3, 2),
        (WIKI, 2, 2, 2),
        (GUIDE, 2, 2, 1),
        (PRICING, 1, 1, 1),
        (OWN_BLOG, 1, 1, 1),
        (GUIDE_TOP, 1, 1, 1),
    ]
    own = data[1]
    assert (own["host"], own["registrable_domain"], own["domain_role"]) == (
        OWN_HOST,
        OWN_HOST,
        "own",
    )
    assert (own["role_entity_id"], own["title"]) == (str(scene.world.own), "Managed SOC by Eventus")
    assert [engine["citation_units"] for engine in own["engines"]] == [2, 0, 1]
    blog = data[5]
    assert (blog["host"], blog["registrable_domain"]) == (f"www.{OWN_HOST}", OWN_HOST)
    assert data[0]["title"] is None
    assert response.json()["page"]["total"] == 7
    assert response.json()["meta"]["citation_units"] == 13


async def test_a_domains_pages_add_up_to_its_units(api: httpx.AsyncClient, scene: Scene) -> None:
    """a3 cites the own domain's pricing page as a third party: the domain has a row for each role
    (4 and 1 units, Task 1), and its pages split the same way."""
    pages = await _get(
        scene.world, api, "sources", "pages", **{"filter[registrable_domain]": OWN_HOST}
    )
    own_pages = await _get(
        scene.world,
        api,
        "sources",
        "pages",
        **{"filter[registrable_domain]": OWN_HOST, "filter[domain_role_in]": "own"},
    )

    rows = [_page(row) for row in pages.json()["data"]]
    assert rows == [(OWN, 3, 3, 2), (PRICING, 1, 1, 1), (OWN_BLOG, 1, 1, 1)]
    assert sum(row[1] for row in rows) == 5
    own_rows = [_page(row) for row in own_pages.json()["data"]]
    assert own_rows == [(OWN, 3, 3, 2), (OWN_BLOG, 1, 1, 1)]
    assert sum(row[1] for row in own_rows) == 4


@pytest.mark.parametrize("route", [("sources", "pages"), ("citations",)])
@pytest.mark.parametrize("name", ["a\x00b", "a\nb", "a\x7fb"])
async def test_a_control_character_in_the_domain_filter_is_refused(
    api: httpx.AsyncClient, scene: Scene, route: tuple[str, ...], name: str
) -> None:
    """The house rule (schemas.common): a control character, NUL included, is a 422 and never a
    500 from the database."""
    response = await _get(scene.world, api, *route, **{"filter[registrable_domain]": name})

    assert problem(response) == (422, "validation_failed")


async def test_pages_page_by_offset(api: httpx.AsyncClient, scene: Scene) -> None:
    second = await _get(scene.world, api, "sources", "pages", offset=2, limit=2)
    beyond = await _get(scene.world, api, "sources", "pages", offset=10, limit=2)

    assert [row["url"] for row in second.json()["data"]] == [WIKI, GUIDE]
    assert beyond.json()["data"] == []
    assert beyond.json()["page"] == {"offset": 10, "limit": 2, "total": 7}


async def test_the_citations_are_listed_newest_answer_first(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    counted = [scene.answers[name] for name in ("a1", "a2", "a3", "b1", "b2")]
    expected = await fetch(
        migrated,
        "SELECT observation_id, citation_index FROM ai.citations WHERE observation_id = ANY($1) "
        "ORDER BY observed_at DESC, observation_id DESC, citation_index",
        counted,
    )

    response = await _get(scene.world, api, "citations", limit=200)

    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [(int(row["observation_id"]), row["citation_index"]) for row in rows] == [
        (row["observation_id"], row["citation_index"]) for row in expected
    ]
    assert len(rows) == 14
    first = rows[0]
    assert (first["prompt_id"], first["engine_code"], first["url"], first["domain_role"]) == (
        str(scene.prompts["a"].id),
        "chatgpt_web",
        OWN,
        "own",
    )
    assert response.json()["page"]["has_more"] is False


async def test_cursor_pages_hold_every_citation_once(api: httpx.AsyncClient, scene: Scene) -> None:
    whole = (await _get(scene.world, api, "citations", limit=200)).json()["data"]
    seen: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": 5} if cursor is None else {"limit": 5, "cursor": cursor}
        body = (await _get(scene.world, api, "citations", **params)).json()
        seen.extend(body["data"])
        cursor = body["page"]["next_cursor"]
        if cursor is None:
            break

    assert seen == whole
    assert len(seen) == 14


async def test_a_cursor_is_bound_to_its_filters(api: httpx.AsyncClient, scene: Scene) -> None:
    first = (
        await _get(scene.world, api, "citations", limit=1, **{"filter[domain_role_in]": "own"})
    ).json()

    other = await _get(scene.world, api, "citations", limit=1, cursor=first["page"]["next_cursor"])

    assert problem(other) == (400, "invalid_cursor")


async def test_a_page_or_a_domain_lists_the_citations_behind_its_units(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    own_url, _ = await page_ids(migrated, OWN)

    by_page = await _get(scene.world, api, "citations", limit=200, **{"filter[url_id]": own_url})
    by_domain = await _get(
        scene.world, api, "citations", limit=200, **{"filter[registrable_domain]": RIVAL_HOST}
    )

    # a1 lists the own page twice: four citations in three answers, the page's three units.
    page_rows = by_page.json()["data"]
    assert len(page_rows) == 4
    assert len({row["observation_id"] for row in page_rows}) == 3
    domain_rows = by_domain.json()["data"]
    assert sorted(row["prompt_id"] for row in domain_rows) == sorted(
        str(scene.prompts[name].id) for name in ("a", "a", "b")
    )


FORGED_KEYS = {
    "two values": [AT, 5],
    "four values": [AT, 5, 1, 1],
    "a key that is no list": 5,
    "a string index": [AT, 5, "1"],
    "a string id": [AT, "5", 1],
    "a number for the time": [5, 5, 1],
    "a time with no offset": ["2026-01-01T00:00:00", 5, 1],
    "a time that is no time": ["yesterday", 5, 1],
    "index 0": [AT, 5, 0],
    "a negative index": [AT, 5, -1],
    "an index past a smallint": [AT, 5, 40000],
    "the largest index": [AT, 5, 2**63 - 1],
    "a negative id": [AT, -1, 1],
    "year 1 that overflows in UTC": ["0001-01-01T00:00:00+01:00", 5, 1],
    "year 9999 that overflows in UTC": ["9999-12-31T23:59:59-01:00", 5, 1],
}


@pytest.mark.parametrize("name", FORGED_KEYS)
async def test_a_forged_citation_cursor_is_refused_before_the_query(
    api: httpx.AsyncClient, scene: Scene, name: str
) -> None:
    """A cursor holds three plain values the database must take: a forged one with the right
    hash is a 400, never a 500 from the driver."""
    real = (await _get(scene.world, api, "citations", limit=1)).json()["page"]["next_cursor"]

    forged = await _get(
        scene.world, api, "citations", limit=1, cursor=forged_cursor(real, FORGED_KEYS[name])
    )

    assert problem(forged) == (400, "invalid_cursor")


async def test_a_cursor_with_the_right_hash_and_a_good_key_is_taken(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The forged cases above fail on their key, not on the way they are made."""
    page = (await _get(scene.world, api, "citations", limit=1)).json()
    cursor = page["page"]["next_cursor"]
    key = cursor_key(cursor)
    local = datetime.fromisoformat(key[0]).astimezone(timezone(timedelta(hours=-5)))

    again = await _get(scene.world, api, "citations", limit=1, cursor=forged_cursor(cursor, key))
    other_zone = await _get(
        scene.world,
        api,
        "citations",
        limit=1,
        cursor=forged_cursor(cursor, [local.isoformat(), *key[1:]]),
    )

    real = await _get(scene.world, api, "citations", limit=1, cursor=cursor)
    assert again.json() == other_zone.json() == real.json()
    assert again.json()["data"][0]["citation_index"] == 2


@pytest.mark.parametrize("cursor", ["!!!", "e30", "bm90IGpzb24", "W10", "eyJrIjpbXX0"])
async def test_a_cursor_that_is_no_cursor_is_refused(
    api: httpx.AsyncClient, scene: Scene, cursor: str
) -> None:
    """Not base64 or not JSON, a payload that is no object, one with no hash, one with no key."""
    response = await _get(scene.world, api, "citations", cursor=cursor)

    assert problem(response) == (400, "invalid_cursor")


async def test_the_last_page_has_no_cursor_and_one_row_fewer_leaves_one_row(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The scene has 14 citations: a limit of 14 is the last page, 13 leaves one."""
    exact = (await _get(scene.world, api, "citations", limit=14)).json()
    short = (await _get(scene.world, api, "citations", limit=13)).json()
    last = (
        await _get(scene.world, api, "citations", limit=13, cursor=short["page"]["next_cursor"])
    ).json()

    assert len(exact["data"]) == 14
    assert exact["page"] == {"limit": 14, "next_cursor": None, "has_more": False}
    assert len(short["data"]) == 13
    assert short["page"]["has_more"] is True
    assert short["page"]["next_cursor"] is not None
    assert last["data"] == exact["data"][13:]
    assert last["page"] == {"limit": 13, "next_cursor": None, "has_more": False}


@pytest.mark.parametrize("limit", [1, 2, 3, 5])
async def test_a_page_boundary_inside_one_answer_loses_and_repeats_no_citation(
    api: httpx.AsyncClient, scene: Scene, limit: int
) -> None:
    """a1 lists four sources and a2 three: with these limits a page ends between two citations of
    one answer, and the next starts with the same answer's next one."""
    whole = (await _get(scene.world, api, "citations", limit=200)).json()["data"]
    pages: list[list[dict[str, Any]]] = []
    cursor: str | None = None
    for _ in range(20):  # 14 rows at one a page is the most; a cursor that never ends fails
        params: dict[str, Any] = {"limit": limit}
        if cursor is not None:
            params["cursor"] = cursor
        body = (await _get(scene.world, api, "citations", **params)).json()
        pages.append(body["data"])
        cursor = body["page"]["next_cursor"]
        if cursor is None:
            break

    assert cursor is None
    seen = [row for page in pages for row in page]
    assert seen == whole
    assert len({(row["observation_id"], row["citation_index"]) for row in seen}) == 14
    assert any(
        before[-1]["observation_id"] == after[0]["observation_id"]
        for before, after in pairwise(pages)
    )


async def test_role_and_domain_filters_narrow_the_pages_not_the_share_or_the_meta(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    whole = (await _get(scene.world, api, "sources", "pages")).json()
    cases = [
        ({"filter[domain_role_in]": "own"}, [OWN, OWN_BLOG]),
        ({"filter[registrable_domain]": CYBERNX}, [RIVAL]),
        (
            {
                "filter[domain_role_in]": "competitor,third_party",
                "filter[registrable_domain]": EVENTUS,
            },
            [PRICING],
        ),
    ]

    for params, urls in cases:
        response = await _get(scene.world, api, "sources", "pages", **params)

        assert response.status_code == 200, response.text
        body = response.json()
        assert [row["url"] for row in body["data"]] == urls
        assert body["page"]["total"] == len(urls)
        assert {row["source_share"]["denominator"] for row in body["data"]} == {13}
        assert body["meta"] == whole["meta"]


async def test_an_engine_filter_narrows_the_pages_with_their_scope(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """Unlike a role or a domain, an engine is part of the scope: its answers are all there is,
    so the meta and the share's denominator are that engine's (a3: four citations)."""
    response = await _get(
        scene.world, api, "sources", "pages", **{"filter[engine_code_in]": "gemini_web"}
    )

    body = response.json()
    assert sorted(row["url"] for row in body["data"]) == sorted([GUIDE, GUIDE_TOP, RIVAL, PRICING])
    assert {row["source_share"]["denominator"] for row in body["data"]} == {4}
    assert body["page"]["total"] == 4
    meta = body["meta"]
    assert (meta["engine_codes"], meta["answers"], meta["citation_units"]) == (
        ["gemini_web"],
        1,
        4,
    )


async def test_the_citation_filters_keep_only_the_rows_that_match(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    b = str(scene.prompts["b"].id)
    cases: list[tuple[dict[str, str], str, str, int]] = [
        ({"filter[domain_role_in]": "own"}, "domain_role", "own", 5),
        ({"filter[domain_role_in]": "competitor"}, "domain_role", "competitor", 3),
        ({"filter[engine_code_in]": "gemini_web"}, "engine_code", "gemini_web", 4),
        ({"filter[prompt_id]": b}, "prompt_id", b, 3),
        ({"filter[term]": str(scene.topic)}, "prompt_id", b, 3),
    ]

    for params, field, value, count in cases:
        response = await _get(scene.world, api, "citations", limit=200, **params)

        assert response.status_code == 200, response.text
        rows = response.json()["data"]
        assert len(rows) == count, params
        assert {row[field] for row in rows} == {value}, params


async def test_a_cursor_does_not_cross_to_another_project_of_the_workspace(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    elsewhere = replace(world, project=other, derivation_id=await derivation_of(migrated, other))
    theirs = await add_prompt(migrated, other, "Best managed SOC providers?")
    await answer(migrated, elsewhere, theirs, days_ago=1, cites=[Cite(GUIDE), Cite(WIKI)])
    cursor = (await _get(world, api, "citations", limit=1)).json()["page"]["next_cursor"]

    crossed = await api.get(
        elsewhere.url("ai", "citations"),
        params={"limit": 1, "cursor": cursor},
        headers=world.owner.headers,
    )

    assert problem(crossed) == (400, "invalid_cursor")


async def test_provider_text_is_cut_to_a_bound_whatever_its_length(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A 5,000 character title and raw URL come back cut, ending in `...`, on both routes: the
    row is still served, not a 500. Ordinary titles are not touched (a2's, above)."""
    world = scene.world
    observation = await answer(
        migrated,
        world,
        scene.prompts["a"],
        days_ago=0.5,
        cites=[Cite(GUIDE, title="T" * 5000)],
    )
    await execute(
        migrated,
        "UPDATE ai.citations SET raw_url = $2 WHERE observation_id = $1",
        observation,
        "https://guide.example.org/" + "p" * 5000,
    )

    citation = (await _get(world, api, "citations", limit=1)).json()["data"][0]
    pages = (
        await _get(world, api, "sources", "pages", **{"filter[registrable_domain]": EXAMPLE})
    ).json()["data"]

    assert int(citation["observation_id"]) == observation
    assert citation["title"] == "T" * 297 + "..."
    assert citation["raw_url"] == "https://guide.example.org/" + "p" * 971 + "..."
    assert len(citation["raw_url"]) == 1000
    guide = next(row for row in pages if row["url"] == GUIDE)
    assert guide["title"] == "T" * 297 + "..."


async def test_an_unknown_project_has_no_pages_or_citations(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    world = scene.world
    for parts in (("sources", "pages"), ("citations",)):
        url = world.url("ai", *parts).replace(str(world.project.id), str(uuid.uuid4()))
        response = await api.get(url, headers=world.owner.headers)
        assert problem(response) == (404, "not_found")


async def test_pages_and_citations_of_a_full_project_are_fast_without_statistics(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The first read of a freshly loaded project (no ANALYZE: the planner has no statistics)
    must not nest its loops over 36,000 citations: 15 s is the hard limit, a second is the aim.
    Then, as for the domains, a full project reads as many statements as a small one."""
    full = await full_project(resources, migrated)
    cold: dict[str, float] = {}
    for name, parts in (("pages", ("sources", "pages")), ("citations", ("citations",))):
        started = time.perf_counter()
        response = await _get(full, api, *parts, limit=200)
        cold[name] = time.perf_counter() - started
        assert response.status_code == 200, response.text
    assert max(cold.values()) < 15, cold
    pages = (await _get(full, api, "sources", "pages", limit=200)).json()
    units = FULL_ANSWERS * 10
    assert (pages["page"]["total"], pages["meta"]["citation_units"]) == (50, units)
    assert sum(row["citation_units"] for row in pages["data"]) == units
    first = (await _get(full, api, "citations", limit=50)).json()
    assert len(first["data"]) == 50
    assert first["page"]["has_more"] is True
    started = time.perf_counter()
    second = await _get(full, api, "citations", limit=50, cursor=first["page"]["next_cursor"])
    assert time.perf_counter() - started < 15
    keys = {
        (row["observation_id"], row["citation_index"])
        for row in first["data"] + second.json()["data"]
    }
    assert len(keys) == 100

    await _get(scene.world, api, "sources", "pages")
    await _get(scene.world, api, "citations")
    for parts in (("sources", "pages"), ("citations",)):
        with statements(resources) as small:
            await _get(scene.world, api, *parts)
        with statements(resources) as large:
            await _get(full, api, *parts)
        assert len(large) == len(small), large
