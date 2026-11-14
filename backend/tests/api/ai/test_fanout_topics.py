"""`include=topics` on the fan-out queries (WP-14 T8; BE-TOPICS-12; docs/16 F4 "per prompt or
topic"): each query names the topic terms tagged on the prompts whose answers issued it, with the
answers each topic accounts for. The expected numbers are worked out by hand from the answers."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    World,
    answer,
    full_project,
    make_world,
    statements,
    tag,
    topic_of,
)
from tests.api.auth.support import execute, fetchrow
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt
from tests.conftest import PostgresServer

PRICING = "soc pricing"
BASICS = "soc basics"
RISK = "soc risk"
TOPICS_MAX = 10


@dataclass(frozen=True)
class Scene:
    world: World
    prompts: dict[str, Prompt]
    pricing: uuid.UUID
    security: uuid.UUID


async def _term(
    pg: PostgresServer, workspace_id: uuid.UUID, project_id: uuid.UUID | None, kind: str, name: str
) -> uuid.UUID:
    """A term of a new vocabulary of this kind, of the project or (`project_id` None) of the
    whole workspace."""
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, $3, $4) RETURNING id",
        workspace_id,
        project_id,
        kind,
        f"{kind} {uuid.uuid4().hex[:8]}",
    )
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3::text, $4::text, $4::text) RETURNING id",
        workspace_id,
        vocabulary["id"],
        name,
        name.lower().replace(" ", "-"),
    )
    term_id: uuid.UUID = term["id"]
    return term_id


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """ChatGPT answers, days before now in brackets. Topics: pricing on P1, pricing and security
    on P2, none on P3; the branded prompt carries security.

      a1 (1)  P1  "soc pricing"
      a2 (2)  P2  "soc pricing", "SOC  pricing" (the same query again), "soc risk"
      a3 (3)  P3  "soc pricing", "soc basics"
      b1 (2)  the branded prompt  "soc pricing"
      x1 (2)  P1, a refusal       "soc pricing"

    So "soc pricing" has 3 answers: pricing in a1 and a2 (2), security in a2 (1). "soc risk" is
    P2's alone: pricing and security once each. "soc basics" is P3's alone: no topic. The branded
    answer and the refusal count nowhere."""
    world = await make_world(resources, migrated)
    pricing = await topic_of(migrated, world, "Pricing")
    security = await topic_of(migrated, world, "Security")
    prompts = {
        "p1": await add_prompt(migrated, world.project, "Best managed SOC providers?"),
        "p2": await add_prompt(migrated, world.project, "How much does a managed SOC cost?"),
        "p3": await add_prompt(migrated, world.project, "What is a SOC?"),
        "brand": await add_prompt(migrated, world.project, "Is Eventus any good?", branded=True),
    }
    await tag(migrated, world, prompts["p1"], pricing)
    await tag(migrated, world, prompts["p2"], pricing)
    await tag(migrated, world, prompts["p2"], security)
    await tag(migrated, world, prompts["brand"], security)

    async def add(prompt: str, days: float, queries: list[str], **kw: Any) -> None:
        await answer(migrated, world, prompts[prompt], days_ago=days, fan_out=queries, **kw)

    await add("p1", 1, [PRICING])
    await add("p2", 2, [PRICING, "SOC  pricing", RISK])
    await add("p3", 3, [PRICING, BASICS])
    await add("brand", 2, [PRICING])
    await add("p1", 2, [PRICING], valid=False)
    return Scene(world, prompts, pricing, security)


async def _get(world: World, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    response = await api.get(
        world.url("ai", "fanout-queries"),
        params={"min_support": 1, "limit": 200, **params},
        headers=world.owner.headers,
    )
    assert response.status_code == 200, response.text
    return response


def _topics(response: httpx.Response) -> dict[str, list[tuple[str, int]]]:
    return {
        row["normalized_text"]: [(t["term_id"], t["observations"]) for t in row["topics"]]
        for row in response.json()["data"]
    }


async def test_each_query_names_the_topics_of_the_prompts_that_issued_it(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """A query an answer lists twice counts once for it: a2 lists "soc pricing" twice."""
    topics = _topics(await _get(scene.world, api, include="topics"))

    assert topics[PRICING] == [(str(scene.pricing), 2), (str(scene.security), 1)]


async def test_topics_with_as_many_answers_are_ordered_by_term_id(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    topics = _topics(await _get(scene.world, api, include="topics"))

    assert [term for term, _ in topics[RISK]] == sorted([str(scene.pricing), str(scene.security)])
    assert {seen for _, seen in topics[RISK]} == {1}


async def test_a_term_of_another_vocabulary_kind_is_not_a_topic(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    world = scene.world
    market = await _term(migrated, world.workspace.id, world.project.id, "market", "India")
    await tag(migrated, world, scene.prompts["p1"], market)

    topics = _topics(await _get(world, api, include="topics"))

    assert str(market) not in {term for rows in topics.values() for term, _ in rows}
    assert topics[PRICING] == [(str(scene.pricing), 2), (str(scene.security), 1)]


async def test_a_query_of_untagged_prompts_has_an_empty_topic_list(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The key is there and empty: the read was asked for, and found no topic."""
    response = await _get(scene.world, api, include="topics")

    assert _topics(response)[BASICS] == []
    assert all("topics" in row for row in response.json()["data"])


async def test_topics_are_bounded_to_ten(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Twelve topics on one prompt: the ten with the lowest term id (all have one answer)."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    terms = [await topic_of(migrated, world, f"Topic {number}") for number in range(12)]
    for term in terms:
        await tag(migrated, world, prompt, term)
    await answer(migrated, world, prompt, days_ago=1, fan_out=[PRICING])

    topics = _topics(await _get(world, api, include="topics"))

    assert topics[PRICING] == [(str(term), 1) for term in sorted(terms, key=str)[:TOPICS_MAX]]


async def test_without_include_there_are_no_topics(api: httpx.AsyncClient, scene: Scene) -> None:
    rows = (await _get(scene.world, api)).json()["data"]

    assert rows
    assert all("topics" not in row for row in rows)


async def test_topics_add_one_statement(
    api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    await _get(scene.world, api, include="topics")
    with statements(resources) as plain:
        await _get(scene.world, api)
    with statements(resources) as with_part:
        await _get(scene.world, api, include="topics")

    assert len(with_part) - len(plain) == 1, with_part


async def test_a_full_project_with_topics_reads_as_many_statements_as_a_small_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, scene: Scene
) -> None:
    """Every prompt of a full project (150 prompts, about a thousand ChatGPT answers of three
    queries) carries a topic. The small one is a page of one row of the scene: a statement per
    row would show. The first read of the freshly loaded project, with no statistics, is timed:
    15 s is the hard limit."""
    full = await full_project(resources, migrated, fan_out=True)
    term = await topic_of(migrated, full, "Everything")
    await execute(
        migrated,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) "
        "SELECT id, $2, workspace_id FROM ai.prompts WHERE project_id = $1",
        full.project.id,
        term,
    )
    started = time.perf_counter()
    cold = await _get(full, api, include="topics")
    assert time.perf_counter() - started < 15
    await _get(scene.world, api, include="topics", limit=1)
    with statements(resources) as small:
        await _get(scene.world, api, include="topics", limit=1)
    with statements(resources) as large:
        response = await _get(full, api, include="topics")

    assert cold.status_code == 200
    rows = response.json()["data"]
    assert {row["normalized_text"] for row in rows} == {"mssp list", "soc pricing", "soc providers"}
    assert all([t["term_id"] for t in row["topics"]] == [str(term)] for row in rows)
    assert all(row["topics"][0]["observations"] == row["observations"] for row in rows)
    assert len(large) == len(small), large


async def test_topics_of_another_projects_terms_are_never_read(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The tag table does not check the project, so a term of another project of the workspace
    can sit on this project's prompt: it is no topic of this one. Other workspaces are kept out
    by row security and the cross-tenant scan with `include=topics`."""
    world = scene.world
    other = await make_project(migrated, world.workspace.id)
    stranger = await _term(migrated, world.workspace.id, other, "topic", "Stranger")
    await tag(migrated, world, scene.prompts["p1"], stranger)

    topics = _topics(await _get(world, api, include="topics"))

    assert str(stranger) not in {term for rows in topics.values() for term, _ in rows}
    assert topics[PRICING] == [(str(scene.pricing), 2), (str(scene.security), 1)]


async def test_a_workspace_wide_topic_is_a_topic_of_the_project(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """A vocabulary with no project is the workspace's: every project sees it (as the taxonomy
    routes list it), so its term tagged on a prompt is a topic of that prompt."""
    world = scene.world
    shared = await _term(migrated, world.workspace.id, None, "topic", "Shared")
    await tag(migrated, world, scene.prompts["p3"], shared)

    topics = _topics(await _get(world, api, include="topics"))

    assert topics[BASICS] == [(str(shared), 1)]
    assert (str(shared), 1) in topics[PRICING]


async def test_the_topics_follow_the_scope_of_the_read(
    api: httpx.AsyncClient, migrated: PostgresServer, scene: Scene
) -> None:
    """The branded prompt's answer counts only with `include_branded`, and the market filter
    keeps the prompts of that country: a UK prompt tagged security adds one answer to it."""
    world = scene.world
    uk = await add_prompt(migrated, world.project, "Best SOC in London?", country="GB")
    await tag(migrated, world, uk, scene.security)
    await answer(migrated, world, uk, days_ago=1, fan_out=[PRICING])
    both = sorted([(str(scene.pricing), 2), (str(scene.security), 2)])

    default = _topics(await _get(world, api, include="topics"))
    branded = _topics(await _get(world, api, include="topics", include_branded="true"))
    british = _topics(await _get(world, api, include="topics", **{"filter[country_iso]": "GB"}))
    american = _topics(await _get(world, api, include="topics", **{"filter[country_iso]": "US"}))

    assert default[PRICING] == both
    assert branded[PRICING] == [(str(scene.security), 3), (str(scene.pricing), 2)]
    assert british == {PRICING: [(str(scene.security), 1)]}
    assert american[PRICING] == [(str(scene.pricing), 2), (str(scene.security), 1)]


async def test_the_topics_of_a_page_are_those_of_its_rows(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """Page two of one row each: its topics are its own, not the first page's."""
    first = await _get(scene.world, api, include="topics", limit=1)
    second = await _get(scene.world, api, include="topics", limit=1, offset=1)

    assert list(_topics(first)) == [PRICING]
    (name,) = _topics(second)
    assert name != PRICING
    assert _topics(second)[name] != _topics(first)[PRICING]
