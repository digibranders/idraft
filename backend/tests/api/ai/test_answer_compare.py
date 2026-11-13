"""`GET {P}/ai/observations/{id}/compare` (WP-26 T2, BE-REPORTS-04; contract
docs/ai-visibility/contracts/evidence.md): what one answer gained, lost and kept against the newest
earlier valid answer of the same prompt and engine that named the own brand. Every expected list
is worked out by hand from the answers each test writes."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    GUIDE,
    GUIDE_TOP,
    OWN,
    OWN_BLOG,
    RIVAL,
    WIKI,
    Cite,
    World,
    make_world,
    statements,
)
from tests.api.ai.sources_support import answer as write_answer
from tests.api.ai.support import ai_project
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import project_url
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.rank_support import _entity
from tests.conftest import PostgresServer

FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
NO_BASELINE = (404, "no_baseline")
INVALID = (422, "validation_failed")

COMPARE = (
    "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/"
    "{observation_id}/compare"
)


async def _mention(
    pg: PostgresServer,
    world: World,
    observation_id: int,
    entity_id: uuid.UUID,
    role: str,
    *,
    status: str = "accepted",
    current: bool = True,
) -> None:
    """A mention of a tracked entity under the derivation of the answer's fact row."""
    observation = await fetchrow(
        pg, "SELECT observed_at, engine_code FROM ai.observations WHERE id = $1", observation_id
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
        world.derivation_id,
        world.project.workspace_id,
        world.project.id,
        observation["engine_code"],
        role,
        status,
        current,
    )


async def answer(
    pg: PostgresServer, world: World, prompt: Prompt, *, named: bool = True, **changes: Any
) -> int:
    """An answer as the source tests write one. Its fact row says the own brand was mentioned
    unless `named` is false (the helper always writes false: it only knows the own citations)."""
    observation = await write_answer(pg, world, prompt, **changes)
    await execute(
        pg,
        "UPDATE ai.observation_facts SET own_mentioned = $2 WHERE observation_id = $1",
        observation,
        named,
    )
    return observation


async def _flag(pg: PostgresServer, observation_id: int, index: int, *flags: str) -> None:
    await execute(
        pg,
        "UPDATE ai.citations SET flags = $2 WHERE observation_id = $1 AND citation_index = $3",
        observation_id,
        list(flags),
        index,
    )


async def _compare(
    api: httpx.AsyncClient, world: World, observation_id: int, **query: str
) -> httpx.Response:
    return await api.get(
        world.url("ai", "observations", observation_id, "compare"),
        params=query,
        headers=world.owner.headers,
    )


async def _data(api: httpx.AsyncClient, world: World, observation_id: int) -> dict[str, Any]:
    response = await _compare(api, world, observation_id)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


async def _prompt(pg: PostgresServer, world: World, text: str = "Best managed SOC?") -> Prompt:
    return await add_prompt(pg, world.project, text)


def _names(items: Sequence[dict[str, Any]], key: str = "name") -> list[str]:
    return [item[key] for item in items]


async def test_latest_against_the_last_answer_that_named_you(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Newer than the one that named the brand are: a valid one that did not, a refusal that
    did and an answer whose facts are no longer current. None of them is the baseline."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    named = await answer(migrated, world, prompt, days_ago=9, cites=[world.own_cite()])
    await answer(migrated, world, prompt, days_ago=7, cites=[world.own_cite()], current=False)
    await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()], valid=False)
    await answer(migrated, world, prompt, days_ago=3, cites=[Cite(GUIDE)], named=False)
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)], named=False)

    data = await _data(api, world, latest)

    assert data["prompt_id"] == str(prompt.id)
    assert data["engine_code"] == "chatgpt_web"
    assert data["latest"]["observation_id"] == str(latest)
    assert data["latest"]["own_mentioned"] is False
    assert data["latest"]["own_domain_cited"] is False
    assert data["baseline"]["observation_id"] == str(named)
    assert data["baseline"]["own_mentioned"] is True
    assert data["baseline"]["own_domain_cited"] is True
    assert data["baseline"]["observed_at"] < data["latest"]["observed_at"]


async def test_entities_and_sources_gained_lost_and_kept(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Now: the own brand and the rival; the own page, the guide and the rival's page. Before:
    the own brand and a watched entity; the own blog, the guide's top page and the wiki. The
    own brand and the domains eventussecurity.com and example.org are kept."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    watched = await _entity(migrated, world.project, "Zed Co", "zed.test", "watch")
    silent = await _entity(migrated, world.project, "Yan Co", "yan.test", "competitor")
    gone = await _entity(migrated, world.project, "Xan Co", "xan.test", "competitor")
    stranger = await _entity(migrated, world.project, "Wen Co", "wen.test", "competitor")
    baseline = await answer(
        migrated,
        world,
        prompt,
        days_ago=5,
        cites=[
            world.own_cite(OWN_BLOG),
            Cite(GUIDE_TOP, title="Top picks"),
            Cite(WIKI, title="Wiki SOC"),
        ],
    )
    await _mention(migrated, world, baseline, world.own, "own")
    await _mention(migrated, world, baseline, watched, "watch")
    latest = await answer(
        migrated,
        world,
        prompt,
        days_ago=1,
        cites=[
            world.own_cite(OWN, title="Our SOC"),
            Cite(GUIDE, title="Guide to SOC"),
            world.rival_cite(RIVAL),
        ],
    )
    await _mention(migrated, world, latest, world.own, "own")
    await _mention(migrated, world, latest, world.rival, "competitor")
    # Not counted: an uncertain mention, a replaced one and one of an untracked entity.
    await _mention(migrated, world, latest, silent, "competitor", status="uncertain")
    await _mention(migrated, world, latest, gone, "competitor", current=False)
    await _mention(migrated, world, latest, stranger, "untracked")

    data = await _data(api, world, latest)

    entities = data["entities"]
    assert [(e["name"], e["role"]) for e in entities["gained"]] == [("CyberNX", "competitor")]
    assert entities["gained"][0]["entity_id"] == str(world.rival)
    assert [(e["name"], e["role"]) for e in entities["lost"]] == [("Zed Co", "watch")]
    assert [(e["name"], e["role"]) for e in entities["kept"]] == [("Eventus Security", "own")]
    sources = data["sources"]
    assert sources["gained"] == [
        {
            "registrable_domain": "cybernx.com",
            "host": "cybernx.com",
            "domain_role": "competitor",
            "title": None,
        }
    ]
    assert sources["lost"] == [
        {
            "registrable_domain": "wikipedia.org",
            "host": "en.wikipedia.org",
            "domain_role": "third_party",
            "title": "Wiki SOC",
        }
    ]
    assert sources["kept_count"] == 2


async def test_lists_are_sorted_by_name_and_domain(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    baseline = await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    await _mention(migrated, world, baseline, world.own, "own")
    latest = await answer(
        migrated,
        world,
        prompt,
        days_ago=1,
        cites=[Cite("https://zeta.example.net/a"), Cite("https://alpha.example.io/a")],
    )
    for name, role in [("beta Co", "watch"), ("Alpha Co", "competitor"), ("Gamma Co", "watch")]:
        entity = await _entity(migrated, world.project, name, f"{name[:4].lower()}.test", role)
        await _mention(migrated, world, latest, entity, role)

    data = await _data(api, world, latest)

    assert _names(data["entities"]["gained"]) == ["Alpha Co", "beta Co", "Gamma Co"]
    assert _names(data["sources"]["gained"], "registrable_domain") == [
        "example.io",
        "example.net",
    ]


async def test_sources_compare_by_registrable_domain_and_leave_flagged_citations_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Two citations flagged `engine_internal` and `unresolved_redirect` name domains the
    baseline does not cite: they are neither gained nor lost. A flagged citation of the
    baseline is not lost either."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    baseline = await answer(
        migrated,
        world,
        prompt,
        days_ago=5,
        cites=[world.own_cite(OWN_BLOG), Cite("https://tracker.example.io/r")],
    )
    await _flag(migrated, baseline, 2, "unresolved_redirect")
    latest = await answer(
        migrated,
        world,
        prompt,
        days_ago=1,
        cites=[
            world.own_cite(OWN),
            Cite("https://chatgpt.com/share/x"),
            Cite("https://l.example.net/r"),
            Cite(GUIDE),
        ],
    )
    await _flag(migrated, latest, 2, "engine_internal")
    await _flag(migrated, latest, 3, "unresolved_redirect", "engine_internal")

    data = await _data(api, world, latest)

    assert _names(data["sources"]["gained"], "registrable_domain") == ["example.org"]
    assert data["sources"]["lost"] == []
    assert data["sources"]["kept_count"] == 1


async def test_no_earlier_named_answer_is_404_no_baseline(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    await answer(migrated, world, prompt, days_ago=5, cites=[Cite(GUIDE)], named=False)
    await answer(migrated, world, prompt, days_ago=4, cites=[world.own_cite()], valid=False)
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite()])

    response = await _compare(api, world, latest)

    assert problem(response) == NO_BASELINE
    assert response.json()["title"]


async def test_an_answer_with_no_earlier_answer_at_all_is_404_no_baseline(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    only = await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite()])

    assert problem(await _compare(api, world, only)) == NO_BASELINE


async def test_an_answer_without_current_facts_has_nothing_to_compare(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Not extracted yet: its entities and sources are unknown, not empty."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET is_current = false WHERE observation_id = $1",
        latest,
    )

    assert problem(await _compare(api, world, latest)) == NO_BASELINE


async def test_a_superseded_or_other_engine_or_other_prompt_answer_is_never_the_baseline(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Newer than the right baseline, and each wrong in one way."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    other = await _prompt(migrated, world, "Another question?")
    right = await answer(migrated, world, prompt, days_ago=20, cites=[world.own_cite()])
    await answer(migrated, world, prompt, days_ago=9, cites=[world.own_cite()], superseded=True)
    await answer(migrated, world, prompt, days_ago=7, cites=[world.own_cite()], engine="gemini_web")
    await answer(migrated, world, other, days_ago=5, cites=[world.own_cite()])
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])

    data = await _data(api, world, latest)

    assert data["baseline"]["observation_id"] == str(right)


async def test_a_later_answer_is_never_the_baseline(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The answer of the path is the middle one: the newer named answer is not its baseline,
    and the newest answer has the middle one as its own."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    oldest = await answer(migrated, world, prompt, days_ago=9, cites=[world.own_cite()])
    middle = await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    newest = await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite()])

    assert (await _data(api, world, middle))["baseline"]["observation_id"] == str(oldest)
    assert (await _data(api, world, newest))["baseline"]["observation_id"] == str(middle)
    assert problem(await _compare(api, world, oldest)) == NO_BASELINE


async def test_an_observation_of_another_project_in_the_workspace_is_404_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])
    elsewhere = await make_project(migrated, world.workspace.id, name="Elsewhere", slug="else")

    response = await api.get(
        project_url(world.workspace, elsewhere, "ai", "observations", latest, "compare"),
        headers=world.owner.headers,
    )

    assert problem(response) == NOT_FOUND


async def test_a_deleted_project_is_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )

    assert problem(await _compare(api, world, latest)) == NOT_FOUND


async def test_a_missing_observation_is_404(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)

    assert problem(await _compare(api, world, 2**62)) == NOT_FOUND


async def test_a_viewer_can_compare_and_billing_cannot(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """`data:read` is enough: a viewer has no `raw:read` and still compares."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])
    viewer = await member(resources, migrated, world.workspace, "viewer")
    billing = await member(resources, migrated, world.workspace, "billing")
    url = world.url("ai", "observations", latest, "compare")

    assert problem(await api.get(url)) == (401, "unauthenticated")
    assert problem(await api.get(url, headers=billing.headers)) == FORBIDDEN
    assert (await api.get(url, headers=viewer.headers)).status_code == 200
    raw = await api.get(world.url("ai", "observations", latest, "raw"), headers=viewer.headers)
    assert problem(raw) == FORBIDDEN


async def test_the_observed_at_hint_is_not_a_parameter(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The route takes no query: like any unknown parameter the hint of the detail route is a
    `422`, and cannot narrow the lookup."""
    world = await make_world(resources, migrated)
    prompt = await _prompt(migrated, world)
    await answer(migrated, world, prompt, days_ago=5, cites=[world.own_cite()])
    latest = await answer(migrated, world, prompt, days_ago=1, cites=[Cite(GUIDE)])

    response = await _compare(api, world, latest, observed_at="1999-01-01T00:00:00Z")

    assert problem(response) == INVALID
    assert response.json()["errors"][0]["path"] == "observed_at"


async def test_compare_statements_are_constant(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """A pair with two citations and a pair with 40 citations and 12 mentions each send the same
    statements: the latest, the baseline, the mentions of both and the citations of both."""
    world = await make_world(resources, migrated)
    small_prompt = await _prompt(migrated, world, "Small?")
    await answer(migrated, world, small_prompt, days_ago=5, cites=[world.own_cite()])
    small = await answer(migrated, world, small_prompt, days_ago=1, cites=[Cite(GUIDE)])
    big_prompt = await _prompt(migrated, world, "Big?")
    entities = [
        await _entity(migrated, world.project, f"Co {n}", f"co{n}.test", "competitor")
        for n in range(12)
    ]
    pair = []
    for days in (5, 1):
        cites = [world.own_cite(), *(Cite(f"https://site{n}.net/p") for n in range(39))]
        observation = await answer(migrated, world, big_prompt, days_ago=days, cites=cites)
        for entity in entities:
            await _mention(migrated, world, observation, entity, "competitor")
        pair.append(observation)

    await _data(api, world, small)  # The session is looked up once; later requests hit its cache.
    with statements(resources) as few:
        await _data(api, world, small)
    with statements(resources) as many:
        data = await _data(api, world, pair[1])

    assert data["sources"]["kept_count"] == 40
    assert len(entities) == len(data["entities"]["kept"])
    assert len(few) == len(many)
    own = [sql for sql in many if "set_config" not in sql]
    assert len(own) == 5, own


@pytest.mark.parametrize("observation_id", ["0", str(2**63), "-1", "abc"])
async def test_compare_validates_the_id_as_a_64_bit_integer(
    observation_id: str,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "observations", observation_id, "compare")

    assert problem(await api.get(url, headers=viewer.headers)) == INVALID


async def test_compare_accepts_the_largest_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await ai_project(migrated, workspace)
    url = project_url(workspace, project, "ai", "observations", str(2**63 - 1), "compare")

    assert problem(await api.get(url, headers=viewer.headers)) == NOT_FOUND


async def test_compare_is_404_for_a_non_member_and_for_a_project_outside_the_scope(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    elsewhere = await make_workspace(migrated, name="Elsewhere")
    project = await ai_project(migrated, workspace)
    other = await ai_project(migrated, workspace)
    outsider = await member(resources, migrated, elsewhere, "owner")
    scoped = await member(resources, migrated, workspace, "viewer", project_ids=[other])
    url = project_url(workspace, project, "ai", "observations", "1", "compare")

    assert problem(await api.get(url, headers=outsider.headers)) == NOT_FOUND
    assert problem(await api.get(url, headers=scoped.headers)) == NOT_FOUND


async def test_a_project_of_another_workspace_gets_no_comparison(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The caller's own workspace in the path, another workspace's project and answer."""
    mine = await make_world(resources, migrated)
    theirs = await make_world(resources, migrated)
    prompt = await _prompt(migrated, theirs)
    await answer(migrated, theirs, prompt, days_ago=5, cites=[theirs.own_cite()])
    latest = await answer(migrated, theirs, prompt, days_ago=1, cites=[Cite(GUIDE)])

    response = await api.get(
        project_url(mine.workspace, theirs.project.id, "ai", "observations", latest, "compare"),
        headers=mine.owner.headers,
    )

    assert problem(response) == NOT_FOUND


def test_the_compare_route_is_published_with_its_response_model() -> None:
    document = build_openapi()
    operation = document["paths"][COMPARE]["get"]
    schemas = document["components"]["schemas"]

    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AnswerCompareResponse"
    }
    assert "not_implemented" not in operation["description"]
    for problem_text in ("not_found", "no_baseline", "403", "422"):
        assert problem_text in operation["description"], problem_text
    assert {"AnswerCompare", "AnswerCompareResponse", "CompareSide"} <= set(schemas)


def test_the_new_fields_are_optional_in_openapi() -> None:
    schemas = build_openapi()["components"]["schemas"]

    for model, field in [
        ("CitationOut", "quote"),
        ("ObservationDetail", "answer_sha256"),
        ("ObservationDetail", "raw_sha256"),
    ]:
        assert field in schemas[model]["properties"], (model, field)
        assert field not in schemas[model].get("required", []), (model, field)
        assert schemas[model]["properties"][field].get("description"), (model, field)
