"""`min_support` on the source rows and the new and lost sources (WP-14 T4; CF-09, BE-SOURCES-05,
BE-SOURCES-06; docs/16 C5 and C6). `min_support` is a floor on a row's citation units in the
window. A source is new with at least `min_support` units in the window and none in as many days
before; it is lost with at least `min_support` units in a support window and none in each of the
two windows after it. Windows are UTC days: with `from` 6 days ago and `to` today the window W is
days 0 to 6 ago, W-1 is days 7 to 13 and W-2 is days 14 to 20. The numbers are worked out by
hand."""

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
    FULL_ANSWERS,
    GUIDE,
    GUIDE_TOP,
    OWN,
    RIVAL,
    WIKI,
    Cite,
    World,
    answer,
    derivation_of,
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute, fetchrow
from tests.api.entities.support import problem
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import OWN_HOST, RIVAL_HOST, Prompt, add_prompt
from tests.collectors.support import Project
from tests.conftest import PostgresServer

EXAMPLE, WIKIPEDIA = "example.org", "wikipedia.org"
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")
FIRST_MINUTE = timedelta(minutes=1)
LAST_MINUTE = timedelta(hours=23, minutes=59)


def _day(days: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=days)).isoformat()


def _days_ago(days: int, offset: timedelta) -> float:
    """How long before now the UTC day `days` ago, `offset` after its start, began."""
    day = datetime.now(UTC).date() - timedelta(days=days)
    instant = datetime(day.year, day.month, day.day, tzinfo=UTC) + offset
    return (datetime.now(UTC) - instant).total_seconds() / 86400


@dataclass(frozen=True)
class Scene:
    world: World
    prompt: Prompt


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    world = await make_world(resources, migrated)
    return Scene(world, await add_prompt(migrated, world.project, "Best managed SOC providers?"))


async def _at(
    pg: PostgresServer,
    scene: Scene,
    days: float | tuple[int, timedelta],
    *cites: Cite,
    engine: str = "chatgpt_web",
    prompt: Prompt | None = None,
) -> int:
    """An answer of the scene's prompt citing `cites`: `days` days before now, or the minute
    `offset` after the start of the day `days` ago (`(days, offset)`)."""
    ago = _days_ago(*days) if isinstance(days, tuple) else days
    return await answer(
        pg, scene.world, prompt or scene.prompt, days_ago=ago, engine=engine, cites=list(cites)
    )


async def _changes(scene: Scene, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    """`sources/changes` over W (today and the 6 days before) unless the window is given."""
    window = {"from": _day(6), "to": _day(0)}
    return await api.get(
        scene.world.url("ai", "sources", "changes"),
        params={**window, **params},
        headers=scene.world.owner.headers,
    )


async def _read(scene: Scene, api: httpx.AsyncClient, *path: str, **params: Any) -> httpx.Response:
    window = {"from": _day(6), "to": _day(0)}
    return await api.get(
        scene.world.url("ai", *path),
        params={**window, **params},
        headers=scene.world.owner.headers,
    )


def _names(response: httpx.Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [row["registrable_domain"] for row in response.json()["data"]]


@pytest.mark.parametrize(
    ("path", "key", "kept", "left_out"),
    [("domains", "registrable_domain", EXAMPLE, WIKIPEDIA), ("pages", "url", GUIDE, WIKI)],
)
async def test_min_support_leaves_out_rarer_rows(
    path: str,
    key: str,
    kept: str,
    left_out: str,
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    scene: Scene,
) -> None:
    for days in (1, 2, 3):
        await _at(migrated, scene, days, Cite(GUIDE))
    await _at(migrated, scene, 4, Cite(WIKI))

    plain = (await _read(scene, api, "sources", path)).json()
    two = (await _read(scene, api, "sources", path, min_support=2)).json()
    three = (await _read(scene, api, "sources", path, min_support=3)).json()
    four = (await _read(scene, api, "sources", path, min_support=4)).json()

    assert {row[key] for row in plain["data"]} == {kept, left_out}
    assert plain["page"]["total"] == 2
    assert [row[key] for row in two["data"]] == [kept]
    assert two["page"]["total"] == 1
    assert [row[key] for row in three["data"]] == [kept]
    assert (four["data"], four["page"]["total"]) == ([], 0)
    assert two["meta"] == three["meta"] == four["meta"] == plain["meta"]


async def test_min_support_counts_units_not_answers(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """One answer citing two pages of one domain is 2 units and 1 answer; a page is 1 unit."""
    await _at(migrated, scene, 1, Cite(GUIDE), Cite(GUIDE_TOP))

    domains = (await _read(scene, api, "sources", "domains", min_support=2)).json()
    pages = (await _read(scene, api, "sources", "pages", min_support=2)).json()

    [row] = domains["data"]
    assert (row["registrable_domain"], row["citation_units"], row["observations"]) == (
        EXAMPLE,
        2,
        1,
    )
    assert pages["data"] == []


async def test_a_new_source_has_min_support_now_and_none_before(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """Guide: 2 units in W (one in the first minute of W), none in W-1 (the last minute of day
    14 is before W-1: it does not count there). Wiki: 2 units in W and 1 in the last minute of
    day 7, the last of W-1. The own page: 1 unit in W, under `min_support`."""
    first = await _at(migrated, scene, (6, FIRST_MINUTE), Cite(GUIDE))
    last = await _at(migrated, scene, 3, Cite(GUIDE))
    await _at(migrated, scene, (14, LAST_MINUTE), Cite(GUIDE))
    await _at(migrated, scene, 5, Cite(WIKI))
    await _at(migrated, scene, 2, Cite(WIKI))
    await _at(migrated, scene, (7, LAST_MINUTE), Cite(WIKI))
    await _at(migrated, scene, 1, scene.world.own_cite())

    response = await _changes(scene, api, kind="new", min_support=2)

    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["data"]
    seen = {
        key: await fetchrow(migrated, "SELECT observed_at FROM ai.observations WHERE id = $1", n)
        for key, n in (("first", first), ("last", last))
    }
    assert row["registrable_domain"] == EXAMPLE
    assert (row["current_units"], row["previous_units"]) == (2, 0)
    assert datetime.fromisoformat(row["first_seen_at"]) == seen["first"]["observed_at"]
    assert datetime.fromisoformat(row["last_seen_at"]) == seen["last"]["observed_at"]
    meta = body["meta"]
    assert (meta["window"]["from"], meta["window"]["to"]) == (_day(6), _day(0))
    assert (meta["compare_window"]["from"], meta["compare_window"]["to"]) == (_day(13), _day(7))
    assert (meta["kind"], meta["min_support"]) == ("new", 2)
    assert body["page"] == {"offset": 0, "limit": 50, "total": 1}


async def test_a_lost_source_had_min_support_and_then_two_empty_windows(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The support window is W-2 (days 20 to 14). Guide: 3 units in it, one in its first minute
    and one in its last, and none after. Wiki: 3 units in the last minute of day 21, before the
    support window. The own page: 3 units in W-2 and one in the first minute of W-1. Rival: 3
    units in W-2 and one in W."""
    own = scene.world.own_cite()
    await _at(migrated, scene, (20, FIRST_MINUTE), Cite(GUIDE))
    await _at(migrated, scene, 17, Cite(GUIDE))
    await _at(migrated, scene, (14, LAST_MINUTE), Cite(GUIDE))
    for _ in range(3):
        await _at(migrated, scene, (21, LAST_MINUTE), Cite(WIKI))
    for days in (15, 16, 18):
        await _at(migrated, scene, days, own)
    await _at(migrated, scene, (13, FIRST_MINUTE), own)
    for days in (15, 16, 18):
        await _at(migrated, scene, days, scene.world.rival_cite())
    await _at(migrated, scene, 1, scene.world.rival_cite())

    response = await _changes(scene, api, kind="lost", min_support=3)

    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["data"]
    assert row["registrable_domain"] == EXAMPLE
    assert (row["current_units"], row["previous_units"]) == (0, 3)
    assert row["first_seen_at"] is None
    assert row["last_seen_at"] is None
    meta = body["meta"]
    assert (meta["window"]["from"], meta["window"]["to"]) == (_day(13), _day(0))
    assert (meta["compare_window"]["from"], meta["compare_window"]["to"]) == (_day(20), _day(14))
    assert (meta["kind"], meta["min_support"]) == ("lost", 3)


async def test_a_source_cited_in_the_window_before_is_not_lost_yet(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """One empty window is not two: wiki was cited 3 times in W-1 and not in W."""
    for days in (8, 10, 12):
        await _at(migrated, scene, days, Cite(WIKI))
    await _at(migrated, scene, 17, Cite(GUIDE))
    await _at(migrated, scene, 18, Cite(GUIDE))
    await _at(migrated, scene, 19, Cite(GUIDE))

    response = await _changes(scene, api, kind="lost", min_support=3)

    assert _names(response) == [EXAMPLE]


async def test_a_lost_source_below_min_support_is_not_listed(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    await _at(migrated, scene, 17, Cite(GUIDE))

    two = await _changes(scene, api, kind="lost", min_support=2)
    one = await _changes(scene, api, kind="lost", min_support=1)

    assert _names(two) == []
    assert two.json()["page"]["total"] == 0
    assert _names(one) == [EXAMPLE]


async def test_a_new_source_below_min_support_is_not_listed(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    await _at(migrated, scene, 2, Cite(GUIDE))

    assert _names(await _changes(scene, api, kind="new", min_support=2)) == []
    assert _names(await _changes(scene, api, kind="new", min_support=1)) == [EXAMPLE]


async def test_changes_keep_roles_apart(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    for days in (1, 2):
        await _at(migrated, scene, days, world.own_cite())
        await _at(migrated, scene, days, world.rival_cite())

    everyone = (await _changes(scene, api, kind="new")).json()
    rivals = await _changes(scene, api, kind="new", **{"filter[domain_role_in]": "competitor"})

    rows = {row["registrable_domain"]: row for row in everyone["data"]}
    assert set(rows) == {OWN_HOST, RIVAL_HOST}
    assert (rows[OWN_HOST]["domain_role"], rows[OWN_HOST]["role_entity_id"]) == (
        "own",
        str(world.own),
    )
    assert (rows[RIVAL_HOST]["domain_role"], rows[RIVAL_HOST]["role_entity_id"]) == (
        "competitor",
        str(world.rival),
    )
    assert _names(rivals) == [RIVAL_HOST]


async def test_a_new_source_counts_units_not_answers(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """One answer citing two pages of one domain is 2 units and 1 answer: `min_support=2` is met
    by that answer alone."""
    await _at(migrated, scene, 2, Cite(GUIDE), Cite(GUIDE_TOP))

    new = await _changes(scene, api, kind="new", min_support=2)
    three = await _changes(scene, api, kind="new", min_support=3)

    assert [(r["registrable_domain"], r["current_units"]) for r in new.json()["data"]] == [
        (EXAMPLE, 2)
    ]
    assert _names(three) == []


async def test_a_lost_source_counts_units_not_answers(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The same one answer, in the support window (W-2): 2 units, so `min_support=2` lists it."""
    await _at(migrated, scene, 17, Cite(GUIDE), Cite(GUIDE_TOP))

    lost = await _changes(scene, api, kind="lost", min_support=2)
    three = await _changes(scene, api, kind="lost", min_support=3)

    assert [(r["registrable_domain"], r["previous_units"]) for r in lost.json()["data"]] == [
        (EXAMPLE, 2)
    ]
    assert _names(three) == []


async def test_a_new_source_is_judged_per_role_not_per_domain(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """`example.org` as a third party: 2 units in W, none before, so new. As the competitor: 1
    unit in W and 1 in W-1, so not new. Merged by domain it would have 3 units now and 1 before,
    and would not be listed at all."""
    world = scene.world
    for days in (1, 2):
        await _at(migrated, scene, days, Cite(GUIDE))
    await _at(migrated, scene, 3, world.rival_cite(GUIDE))
    await _at(migrated, scene, 10, world.rival_cite(GUIDE))

    response = await _changes(scene, api, kind="new", min_support=1)

    assert response.status_code == 200, response.text
    assert [
        (r["registrable_domain"], r["domain_role"], r["current_units"], r["previous_units"])
        for r in response.json()["data"]
    ] == [(EXAMPLE, "third_party", 2, 0)]


async def test_a_lost_source_is_judged_per_role_not_per_domain(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """`example.org` as a third party: 3 units in W-2 and none after, so lost. As the competitor:
    3 units in W, so not lost. Merged by domain it would have 3 units now, and would not be
    listed at all."""
    world = scene.world
    for days in (15, 16, 17):
        await _at(migrated, scene, days, Cite(GUIDE))
    for days in (1, 2, 3):
        await _at(migrated, scene, days, world.rival_cite(GUIDE))

    response = await _changes(scene, api, kind="lost", min_support=3)

    assert response.status_code == 200, response.text
    assert [
        (r["registrable_domain"], r["domain_role"], r["current_units"], r["previous_units"])
        for r in response.json()["data"]
    ] == [(EXAMPLE, "third_party", 0, 3)]


async def test_changes_follow_the_scope(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A branded prompt cites the rival: left out unless asked for. ChatGPT cites guide, Gemini
    cites wiki: the engine filter keeps one."""
    branded = await add_prompt(migrated, scene.world.project, "Is Eventus any good?", branded=True)
    await _at(migrated, scene, 2, Cite(GUIDE))
    await _at(migrated, scene, 3, Cite(WIKI), engine="gemini_web")
    await _at(migrated, scene, 4, scene.world.rival_cite(RIVAL), prompt=branded)

    plain = await _changes(scene, api, min_support=1)
    asked = await _changes(scene, api, min_support=1, include_branded="true")
    gemini = await _changes(scene, api, min_support=1, **{"filter[engine_code_in]": "gemini_web"})

    assert sorted(_names(plain)) == [EXAMPLE, WIKIPEDIA]
    assert sorted(_names(asked)) == [RIVAL_HOST, EXAMPLE, WIKIPEDIA]
    assert _names(gemini) == [WIKIPEDIA]
    meta = gemini.json()["meta"]
    assert (meta["include_branded"], meta["engine_codes"]) == (False, ["gemini_web"])
    assert asked.json()["meta"]["include_branded"] is True


async def test_changes_follow_the_country(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    german = await add_prompt(
        migrated, scene.world.project, "Bester SOC Anbieter?", country="DE", language="de"
    )
    await _at(migrated, scene, 2, Cite(GUIDE))
    await _at(migrated, scene, 2, Cite(WIKI), prompt=german)

    assert _names(await _changes(scene, api, min_support=1, **{"filter[country_iso]": "DE"})) == [
        WIKIPEDIA
    ]
    assert _names(await _changes(scene, api, min_support=1, **{"filter[country_iso]": "US"})) == [
        EXAMPLE
    ]
    assert _names(await _changes(scene, api, min_support=1, **{"filter[country_iso]": "FR"})) == []


async def test_changes_page_by_offset_most_units_first(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """Guide 4 units, wiki 3, the rival 2: new in W, listed by units, 2 to a page."""
    for days in (1, 2, 3, 4):
        await _at(migrated, scene, days, Cite(GUIDE))
    for days in (1, 2, 3):
        await _at(migrated, scene, days, Cite(WIKI))
    for days in (1, 2):
        await _at(migrated, scene, days, scene.world.rival_cite())

    first = (await _changes(scene, api, limit=2)).json()
    second = (await _changes(scene, api, limit=2, offset=2)).json()
    beyond = (await _changes(scene, api, limit=2, offset=3)).json()

    assert [(r["registrable_domain"], r["current_units"]) for r in first["data"]] == [
        (EXAMPLE, 4),
        (WIKIPEDIA, 3),
    ]
    assert [(r["registrable_domain"], r["current_units"]) for r in second["data"]] == [
        (RIVAL_HOST, 2)
    ]
    assert first["page"] == {"offset": 0, "limit": 2, "total": 3}
    assert second["page"] == {"offset": 2, "limit": 2, "total": 3}
    assert (beyond["data"], beyond["page"]["total"]) == ([], 3)
    assert (first["meta"]["kind"], first["meta"]["min_support"]) == ("new", 2)


async def test_lost_sources_page_by_the_units_they_had(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    for days in (15, 16, 17):
        await _at(migrated, scene, days, Cite(WIKI))
    for days in (15, 16, 17, 18):
        await _at(migrated, scene, days, Cite(GUIDE))

    body = (await _changes(scene, api, kind="lost", limit=1)).json()

    assert [(r["registrable_domain"], r["previous_units"]) for r in body["data"]] == [(EXAMPLE, 4)]
    assert body["page"]["total"] == 2


@pytest.mark.parametrize(
    ("params", "bad"),
    [({"limit": 201}, INVALID), ({"offset": 100_001}, INVALID), ({"limit": 0}, INVALID)],
)
async def test_the_page_of_changes_is_bounded(
    params: dict[str, int], bad: tuple[int, str], api: httpx.AsyncClient, scene: Scene
) -> None:
    assert problem(await _changes(scene, api, **params)) == bad


async def test_a_window_over_92_days_is_refused(api: httpx.AsyncClient, scene: Scene) -> None:
    response = await _changes(scene, api, **{"from": _day(100), "to": _day(0)})

    assert problem(response) == (422, "window_too_large")


async def test_a_92_day_window_reads_the_two_windows_before_it(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The longest window asked: `lost` answers over it and the 92 days before, and compares
    with the 92 before those: 276 days in all."""
    response = await _changes(scene, api, kind="lost", **{"from": _day(91), "to": _day(0)})

    assert response.status_code == 200, response.text
    meta = response.json()["meta"]
    assert (meta["window"]["from"], meta["window"]["to"]) == (_day(183), _day(0))
    assert (meta["compare_window"]["from"], meta["compare_window"]["to"]) == (
        _day(275),
        _day(184),
    )


async def test_changes_of_a_deleted_or_unknown_project_are_not_found(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )
    deleted = await _changes(scene, api)
    unknown = await api.get(
        world.url("ai", "sources", "changes").replace(str(world.project.id), str(uuid.uuid4())),
        headers=world.owner.headers,
    )

    assert problem(deleted) == problem(unknown) == NOT_FOUND


async def test_changes_count_nothing_of_another_project(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    other = Project(world.workspace.id, await make_project(migrated, world.workspace.id))
    elsewhere = replace(world, project=other, derivation_id=await derivation_of(migrated, other))
    theirs = await add_prompt(migrated, other, "Best managed SOC providers?")
    for days in (1, 2, 3):
        await answer(migrated, elsewhere, theirs, days_ago=days, cites=[Cite(GUIDE)])
    for days in (15, 16, 17):
        await answer(migrated, elsewhere, theirs, days_ago=days, cites=[Cite(WIKI)])
    for days in (1, 2):
        await _at(migrated, scene, days, Cite(WIKI))

    new = await _changes(scene, api, kind="new")
    lost = await _changes(scene, api, kind="lost", min_support=1)

    assert _names(new) == [WIKIPEDIA]
    assert _names(lost) == []


async def test_changes_count_nothing_of_a_superseded_or_invalid_answer(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    await _at(migrated, scene, 2, Cite(GUIDE))
    await answer(migrated, scene.world, scene.prompt, days_ago=3, cites=[Cite(WIKI)], valid=False)
    await answer(
        migrated, scene.world, scene.prompt, days_ago=4, cites=[Cite(WIKI)], superseded=True
    )
    await answer(migrated, scene.world, scene.prompt, days_ago=5, cites=[Cite(WIKI)], current=False)

    assert _names(await _changes(scene, api, min_support=1)) == [EXAMPLE]


async def test_changes_are_one_statement_whatever_the_size(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """The base plan's 3,600 answers, 20 domains new in the default 28 days: the first read of
    the freshly loaded project (no statistics) is timed, 15 s being the hard limit, and each
    kind reads `ai.citations` in one statement and sends as many statements as a small project."""
    await _at(migrated, scene, 2, Cite(GUIDE))
    full = await full_project(resources, migrated)

    async def read(world: World, kind: str, **params: Any) -> httpx.Response:
        return await api.get(
            world.url("ai", "sources", "changes"),
            params={"kind": kind, "min_support": 1, **params},
            headers=world.owner.headers,
        )

    started = time.perf_counter()
    cold = await read(full, "lost")
    assert time.perf_counter() - started < 15
    assert cold.status_code == 200, cold.text
    new = (await read(full, "new", limit=200)).json()
    assert new["page"]["total"] == 20
    assert sum(row["current_units"] for row in new["data"]) == FULL_ANSWERS * 10
    assert (await read(full, "lost")).json()["data"] == []
    for kind in ("new", "lost"):
        await read(scene.world, kind)
        with statements(resources) as small:
            await read(scene.world, kind)
        with statements(resources) as large:
            await read(full, kind)
        assert len(large) == len(small), large
        assert sum("ai.citations" in text for text in large) == 1, large


@pytest.mark.parametrize("path", ["domains", "pages"])
async def test_min_support_adds_no_statement(
    path: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    await _at(migrated, scene, 2, Cite(GUIDE), Cite(OWN))
    await _read(scene, api, "sources", path)
    with statements(resources) as plain:
        await _read(scene, api, "sources", path)
    with statements(resources) as bounded:
        await _read(scene, api, "sources", path, min_support=2)

    assert len(bounded) == len(plain), bounded
