"""`include=cited_with` and `include=by_role_by_engine` on the domain list (WP-14 T6; CF-10, OV-N7):
the tracked entity named in the most answers that cite each row, and the units and citing answers
of each role per engine. The expected numbers are worked out by hand from the answers below."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
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
    full_project,
    make_world,
    statements,
)
from tests.api.auth.support import execute, fetchrow
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import OWN_HOST, RIVAL_HOST, Prompt, add_prompt
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.conftest import PostgresServer

ELSEWHERE = "https://other.example.net/x"
ENGINES = ["chatgpt_web", "gemini_web", "google_ai_mode"]
ROLES = ("own", "competitor", "third_party")
EVERY = "series,cited_with,by_role_by_engine"


@dataclass(frozen=True)
class Scene:
    world: World
    prompt: Prompt
    answers: dict[str, int]


async def _mention(
    pg: PostgresServer,
    world: World,
    observation_id: int,
    entity_id: uuid.UUID,
    *,
    project_id: uuid.UUID | None = None,
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
        "ARRAY['[0,8)'::int4range], 'accepted', true)",
        observation_id,
        observation["observed_at"],
        entity_id,
        world.derivation_id,
        world.project.workspace_id,
        project_id or world.project.id,
        observation["engine_code"],
        "own" if entity_id == world.own else "competitor",
    )


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """One prompt; days before now in brackets; every answer is ChatGPT's unless it says so.

      a1 (1)  guide, its top page and the wiki   names the rival and the own brand
      a2 (2)  guide                              names the rival
      a3 (3)  the own page (own)                 names the own brand
      a4 (4)  the own domain's blog (third)      names the rival
      a5 (5)  another site                       names nobody
      a6 (2)  Gemini: guide                      names nobody
      a7 (6)  the rival's page (competitor)      names nobody

    So `example.org` has 3 units in a1 and a2, `wikipedia.org` 1, the own domain 1 unit as the
    own brand and 1 as a third party, the rival's domain 1 and `example.net` 1."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    ids: dict[str, int] = {}

    async def add(name: str, days: float, cites: list[Cite], **kw: Any) -> None:
        ids[name] = await answer(migrated, world, prompt, days_ago=days, cites=cites, **kw)

    await add("a1", 1, [Cite(GUIDE), Cite(GUIDE_TOP), Cite(WIKI)])
    await add("a2", 2, [Cite(GUIDE)])
    await add("a3", 3, [world.own_cite(OWN)])
    await add("a4", 4, [Cite(OWN_BLOG)])
    await add("a5", 5, [Cite(ELSEWHERE)])
    await add("a6", 2, [Cite(GUIDE)], engine="gemini_web")
    await add("a7", 6, [world.rival_cite(RIVAL)])
    await _mention(migrated, world, ids["a1"], world.rival)
    await _mention(migrated, world, ids["a1"], world.own)
    await _mention(migrated, world, ids["a2"], world.rival)
    await _mention(migrated, world, ids["a3"], world.own)
    await _mention(migrated, world, ids["a4"], world.rival)
    return Scene(world, prompt, ids)


async def _domains(world: World, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    return await api.get(
        world.url("ai", "sources", "domains"), params=params, headers=world.owner.headers
    )


def _rows(response: httpx.Response) -> dict[tuple[str, str], dict[str, Any]]:
    assert response.status_code == 200, response.text
    return {(r["registrable_domain"], r["domain_role"]): r for r in response.json()["data"]}


async def test_each_domain_row_names_the_entity_most_named_with_it(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """`example.org`: a1 and a2 cite it and name the rival, a1 names the own brand too, so the
    rival with 2 (a1 cites it on two pages: one answer). A row whose answers name nobody has no
    `cited_with` key: absent, not null."""
    rows = _rows(await _domains(scene.world, api, include="cited_with"))

    assert rows[("example.org", "third_party")]["cited_with"] == {
        "entity_id": str(scene.world.rival),
        "observations": 2,
    }
    assert "cited_with" not in rows[("example.net", "third_party")]
    assert "cited_with" not in rows[(RIVAL_HOST, "competitor")]


async def test_cited_with_ties_are_broken_by_entity_id(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The wiki is cited by a1 only, which names the rival and the own brand once each."""
    rows = _rows(await _domains(scene.world, api, include="cited_with"))

    assert rows[("wikipedia.org", "third_party")]["cited_with"] == {
        "entity_id": str(min(scene.world.own, scene.world.rival)),
        "observations": 1,
    }


async def test_cited_with_keeps_roles_apart(api: httpx.AsyncClient, scene: Scene) -> None:
    """The own domain is cited as the own brand by a3 (names the own brand) and as a third
    party by a4 (names the rival): each row has its own answers, so its own entity."""
    world = scene.world
    rows = _rows(await _domains(world, api, include="cited_with"))

    assert rows[(OWN_HOST, "own")]["cited_with"] == {
        "entity_id": str(world.own),
        "observations": 1,
    }
    assert rows[(OWN_HOST, "third_party")]["cited_with"] == {
        "entity_id": str(world.rival),
        "observations": 1,
    }


async def test_a_mention_that_is_not_current_or_accepted_does_not_count(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    await execute(
        migrated,
        "UPDATE ai.entity_mentions SET is_current = false WHERE observation_id = $1",
        scene.answers["a3"],
    )
    await execute(
        migrated,
        "UPDATE ai.entity_mentions SET mention_status = 'uncertain' WHERE observation_id = $1",
        scene.answers["a4"],
    )

    rows = _rows(await _domains(scene.world, api, include="cited_with"))

    assert "cited_with" not in rows[(OWN_HOST, "own")]
    assert "cited_with" not in rows[(OWN_HOST, "third_party")]


async def test_a_mention_filed_under_another_project_does_not_count(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A mention row of the same answer that belongs to another project of the workspace is not
    this project's: `example.net` (a5, which names nobody) stays without an entity."""
    world = scene.world
    other = await make_project(migrated, world.workspace.id)
    stranger = await _entity(
        migrated, Project(world.workspace.id, other), "Other Co", "o.test", "competitor"
    )
    await _mention(migrated, world, scene.answers["a5"], stranger, project_id=other)

    rows = _rows(await _domains(world, api, include="cited_with"))

    assert "cited_with" not in rows[("example.net", "third_party")]


async def test_cited_with_follows_the_scope(api: httpx.AsyncClient, scene: Scene) -> None:
    """Narrowed to Gemini, `example.org` is cited by a6 only, which names nobody."""
    rows = _rows(
        await _domains(
            scene.world,
            api,
            include="cited_with",
            **{"filter[engine_code_in]": "gemini_web"},
        )
    )

    assert set(rows) == {("example.org", "third_party")}
    assert "cited_with" not in rows[("example.org", "third_party")]


async def test_cited_with_is_read_for_the_rows_of_the_page_only(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """Page two of one row each: its `cited_with` is its own, not the first page's."""
    first = await _domains(scene.world, api, include="cited_with", limit="1")
    second = await _domains(scene.world, api, include="cited_with", limit="1", offset="1")

    assert first.json()["data"][0]["registrable_domain"] == "example.org"
    assert first.json()["data"][0]["cited_with"]["observations"] == 2
    assert second.json()["data"][0]["registrable_domain"] != "example.org"


async def test_cited_with_adds_one_statement(
    api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    await _domains(scene.world, api, include="cited_with")
    with statements(resources) as plain:
        await _domains(scene.world, api)
    with statements(resources) as with_part:
        await _domains(scene.world, api, include="cited_with")

    assert len(with_part) - len(plain) == 1, with_part


async def test_the_role_split_per_engine_adds_up_to_by_role(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """ChatGPT: the own page 1 unit in 1 answer; the rival's page 1 in 1; third parties 6 units
    in 4 answers (a1 3, a2, a4, a5). Gemini: 1 third-party unit in 1 answer. By role over every
    engine: own 1, competitor 1, third party 7."""
    response = await _domains(scene.world, api, include="by_role_by_engine")

    assert response.status_code == 200, response.text
    meta = response.json()["meta"]
    split = meta["by_role_by_engine"]
    assert [entry["engine_code"] for entry in split] == meta["engine_codes"] == ENGINES
    by_engine = {
        entry["engine_code"]: {
            role: (entry[role]["citation_units"], entry[role]["answers_citing"]) for role in ROLES
        }
        for entry in split
    }
    assert by_engine["chatgpt_web"] == {
        "own": (1, 1),
        "competitor": (1, 1),
        "third_party": (6, 4),
    }
    assert by_engine["gemini_web"] == {"own": (0, 0), "competitor": (0, 0), "third_party": (1, 1)}
    for role in ROLES:
        total = next(r["citation_units"] for r in meta["by_role"] if r["domain_role"] == role)
        assert sum(units[role][0] for units in by_engine.values()) == total


async def test_an_engine_with_no_citations_is_zeros(api: httpx.AsyncClient, scene: Scene) -> None:
    split = (await _domains(scene.world, api, include="by_role_by_engine")).json()["meta"][
        "by_role_by_engine"
    ]

    mode = next(entry for entry in split if entry["engine_code"] == "google_ai_mode")
    assert set(mode) == {"engine_code", *ROLES}
    for role in ROLES:
        assert mode[role] == {"citation_units": 0, "answers_citing": 0}


async def test_the_role_split_ignores_the_role_filter(api: httpx.AsyncClient, scene: Scene) -> None:
    """The split is meta, like `by_role`: `filter[domain_role_in]=own` narrows the rows only."""
    response = await _domains(
        scene.world,
        api,
        include="by_role_by_engine",
        **{"filter[domain_role_in]": "own"},
    )

    body = response.json()
    assert {row["domain_role"] for row in body["data"]} == {"own"}
    chatgpt = body["meta"]["by_role_by_engine"][0]
    assert chatgpt["third_party"] == {"citation_units": 6, "answers_citing": 4}
    assert chatgpt["competitor"] == {"citation_units": 1, "answers_citing": 1}


async def test_the_role_split_follows_the_scope(api: httpx.AsyncClient, scene: Scene) -> None:
    """Narrowed to one engine the split lists that engine only."""
    response = await _domains(
        scene.world,
        api,
        include="by_role_by_engine",
        **{"filter[engine_code_in]": "gemini_web"},
    )

    split = response.json()["meta"]["by_role_by_engine"]
    assert [entry["engine_code"] for entry in split] == ["gemini_web"]
    assert split[0]["third_party"] == {"citation_units": 1, "answers_citing": 1}


async def test_the_role_split_leaves_branded_prompts_out_by_default(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    branded = await add_prompt(migrated, scene.world.project, "Is Eventus any good?", branded=True)
    await answer(migrated, scene.world, branded, days_ago=1, cites=[Cite(ELSEWHERE)])

    plain = await _domains(scene.world, api, include="by_role_by_engine")
    with_branded = await _domains(
        scene.world, api, include="by_role_by_engine", include_branded="true"
    )

    assert plain.json()["meta"]["by_role_by_engine"][0]["third_party"]["citation_units"] == 6
    assert with_branded.json()["meta"]["by_role_by_engine"][0]["third_party"] == {
        "citation_units": 7,
        "answers_citing": 5,
    }


async def test_by_role_by_engine_adds_one_statement(
    api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    await _domains(scene.world, api, include="by_role_by_engine")
    with statements(resources) as plain:
        await _domains(scene.world, api)
    with statements(resources) as with_part:
        await _domains(scene.world, api, include="by_role_by_engine")

    assert len(with_part) - len(plain) == 1, with_part


async def test_every_include_together_adds_four_statements(
    api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    """The series reads two statements, `cited_with` one and the split one."""
    await _domains(scene.world, api, include=EVERY)
    with statements(resources) as plain:
        await _domains(scene.world, api)
    with statements(resources) as everything:
        response = await _domains(scene.world, api, include=EVERY)

    assert response.status_code == 200, response.text
    assert len(everything) - len(plain) == 4, everything


async def test_a_full_project_with_every_include_reads_as_many_statements_as_a_small_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """3,600 answers (300 replaced) with 36,000 citations, the rival named in every one: the
    same statements as the small world, cold, without statistics."""
    full = await full_project(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, confidence, evidence_spans, mention_status, "
        "is_current) SELECT o.id, o.observed_at, $2, $3, o.workspace_id, o.project_id, "
        "o.engine_code, 'competitor', 1, 0, 1, 1, 'alias_word', 1, "
        "ARRAY['[0,8)'::int4range], 'accepted', true FROM ai.observations o "
        "WHERE o.project_id = $1",
        full.project.id,
        full.rival,
        full.derivation_id,
    )
    params = {"include": EVERY, "limit": "50"}
    started = time.perf_counter()
    cold = await api.get(
        full.url("ai", "sources", "domains"), params=params, headers=full.owner.headers
    )
    assert time.perf_counter() - started < 15
    assert cold.status_code == 200, cold.text
    await _domains(scene.world, api, include=EVERY)
    with statements(resources) as small:
        await _domains(scene.world, api, include=EVERY)
    with statements(resources) as large:
        response = await api.get(
            full.url("ai", "sources", "domains"), params=params, headers=full.owner.headers
        )

    body = response.json()
    assert len(body["data"]) == 20
    assert all(row["cited_with"]["entity_id"] == str(full.rival) for row in body["data"])
    assert sum(row["cited_with"]["observations"] for row in body["data"]) > 0
    third_party = sum(e["third_party"]["citation_units"] for e in body["meta"]["by_role_by_engine"])
    assert third_party == FULL_ANSWERS * 10
    assert len(large) == len(small), large
