"""Flagged citations out of the source reads by default, with their toggles (WP-14 T7;
BE-SOURCES-22; docs/14 section 9, open question O1): a citation flagged `unresolved_redirect` or
`engine_internal` is left out of the shares and units of domains, pages, changes, diversity, the
domain detail and the prompts' own pages, and counted again with `include_unresolved_redirects`
or `include_engine_internal`. The citation list and the fan-out read keep every citation.

The expected numbers are worked out by hand from the scene below. Nothing in ingest sets
`engine_internal` today: the toggle filters on it anyway, and the tests set it by hand."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from idraft.api.ai.source_routes import FLAGGED_COUNTED_BY_DEFAULT, flag_toggles
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    GUIDE,
    GUIDE_TOP,
    OWN_BLOG,
    WIKI,
    Cite,
    World,
    answer,
    make_world,
    statements,
)
from tests.api.auth.support import execute, fetchrow
from tests.api.entities.support import problem
from tests.collectors.ai_support import Prompt, add_prompt
from tests.conftest import PostgresServer

REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x"
ENGINE = "https://chat.engine-product.com/share/1"
BOTH = "https://www.both-flagged.org/x"
WRAPPED = "https://wrapped.example.net/a"
UNRESOLVED = "unresolved_redirect"
INTERNAL = "engine_internal"
INVALID_CURSOR = (400, "invalid_cursor")

NO_TOGGLE: dict[str, str] = {}
UNRESOLVED_TOGGLE = {"include_unresolved_redirects": "true"}
INTERNAL_TOGGLE = {"include_engine_internal": "true"}
BOTH_TOGGLES = {**UNRESOLVED_TOGGLE, **INTERNAL_TOGGLE}


@dataclass(frozen=True)
class Scene:
    world: World
    prompt: Prompt


async def _flag(pg: PostgresServer, observation_id: int, index: int, *flags: str) -> None:
    await execute(
        pg,
        "UPDATE ai.citations SET flags = $2 WHERE observation_id = $1 AND citation_index = $3",
        observation_id,
        list(flags),
        index,
    )


@pytest.fixture
async def scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Four answers of one prompt. ChatGPT: the own page, the guide and a wrapped link (flag
    `redirect_unwrapped`, which counts); Gemini: a grounding redirect (`unresolved_redirect`)
    and the guide; AI Mode: an engine link (`engine_internal`), a link flagged with both and the
    guide; ChatGPT again: only a grounding redirect, and the query "soc providers".

    Counted by default: 5 units (the own page, the guide three times, the wrapped link) on 3
    registrable domains, in 4 answers of which 3 cite. The redirect adds 2 units, the engine link
    1, the link with both flags 1 (only when both toggles are set)."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    first = await answer(
        migrated,
        world,
        prompt,
        days_ago=1,
        cites=[world.own_cite(), Cite(GUIDE), Cite(WRAPPED)],
    )
    second = await answer(
        migrated,
        world,
        prompt,
        days_ago=1,
        engine="gemini_web",
        cites=[Cite(REDIRECT), Cite(GUIDE)],
    )
    third = await answer(
        migrated,
        world,
        prompt,
        days_ago=2,
        engine="google_ai_mode",
        cites=[Cite(ENGINE), Cite(BOTH), Cite(GUIDE)],
    )
    fourth = await answer(
        migrated, world, prompt, days_ago=3, cites=[Cite(REDIRECT)], fan_out=["soc providers"]
    )
    await _flag(migrated, first, 3, "redirect_unwrapped")
    await _flag(migrated, second, 1, UNRESOLVED)
    await _flag(migrated, third, 1, INTERNAL)
    await _flag(migrated, third, 2, INTERNAL, UNRESOLVED)
    await _flag(migrated, fourth, 1, UNRESOLVED)
    return Scene(world, prompt)


async def _get(world: World, api: httpx.AsyncClient, path: str, **params: Any) -> httpx.Response:
    response = await api.get(
        world.url("ai", *path.split("/")), params=params, headers=world.owner.headers
    )
    assert response.status_code == 200, response.text
    return response


Reading = tuple[int, int]
"""What a read counts: its citation units and its registrable domains."""


def _domains(response: httpx.Response) -> Reading:
    body = response.json()
    return body["meta"]["citation_units"], len({row["registrable_domain"] for row in body["data"]})


def _changes(response: httpx.Response) -> Reading:
    rows = response.json()["data"]
    return sum(row["current_units"] for row in rows), len({r["registrable_domain"] for r in rows})


def _diversity(response: httpx.Response) -> Reading:
    body = response.json()
    return sum(e["citation_units"] for e in body["data"]), body["meta"]["distinct_domains"]


def _detail(response: httpx.Response) -> Reading:
    body = response.json()
    return body["meta"]["citation_units"], len(body["data"]["rows"])


@dataclass(frozen=True)
class Read:
    path: str
    params: dict[str, Any]
    reading: Callable[[httpx.Response], Reading]


READS = {
    "domains": Read("sources/domains", {"limit": 200}, _domains),
    "pages": Read("sources/pages", {"limit": 200}, _domains),
    "changes": Read("sources/changes", {"min_support": 1, "limit": 200}, _changes),
    "diversity": Read("sources/diversity", {}, _diversity),
    "detail of the redirect's domain": Read("sources/domains/google.com", {}, _detail),
}

# Per read: (units, domains) by default, with each toggle and with both. The domains are the own
# one, the guide's and the wrapped link's: three; the redirect adds google.com, the engine link
# engine-product.com and the link with both flags both-flagged.org. The detail names google.com:
# its units are the scope's and its rows are that domain's.
EXPECTED: dict[str, dict[str, Reading]] = {
    "domains": {"none": (5, 3), "unresolved": (7, 4), "internal": (6, 4), "both": (9, 6)},
    "pages": {"none": (5, 3), "unresolved": (7, 4), "internal": (6, 4), "both": (9, 6)},
    "changes": {"none": (5, 3), "unresolved": (7, 4), "internal": (6, 4), "both": (9, 6)},
    "diversity": {"none": (5, 3), "unresolved": (7, 4), "internal": (6, 4), "both": (9, 6)},
    "detail of the redirect's domain": {
        "none": (5, 0),
        "unresolved": (7, 1),
        "internal": (6, 0),
        "both": (9, 1),
    },
}
TOGGLES = {
    "none": NO_TOGGLE,
    "unresolved": UNRESOLVED_TOGGLE,
    "internal": INTERNAL_TOGGLE,
    "both": BOTH_TOGGLES,
}


@pytest.mark.parametrize("name", READS)
async def test_an_unresolved_redirect_is_left_out_by_default(
    name: str, api: httpx.AsyncClient, scene: Scene
) -> None:
    read = READS[name]

    response = await _get(scene.world, api, read.path, **read.params)

    assert read.reading(response) == EXPECTED[name]["none"]


@pytest.mark.parametrize("name", READS)
async def test_the_toggle_counts_it_again(name: str, api: httpx.AsyncClient, scene: Scene) -> None:
    read = READS[name]

    response = await _get(scene.world, api, read.path, **read.params, **UNRESOLVED_TOGGLE)

    assert read.reading(response) == EXPECTED[name]["unresolved"]


@pytest.mark.parametrize("name", READS)
async def test_an_engine_internal_link_is_left_out_unless_asked(
    name: str, api: httpx.AsyncClient, scene: Scene
) -> None:
    read = READS[name]

    response = await _get(scene.world, api, read.path, **read.params, **INTERNAL_TOGGLE)

    assert read.reading(response) == EXPECTED[name]["internal"]


@pytest.mark.parametrize("name", READS)
async def test_a_citation_with_both_flags_counts_only_with_both_toggles(
    name: str, api: httpx.AsyncClient, scene: Scene
) -> None:
    """The link flagged with both is left out by either toggle alone, and counted by both."""
    read = READS[name]

    response = await _get(scene.world, api, read.path, **read.params, **BOTH_TOGGLES)

    assert read.reading(response) == EXPECTED[name]["both"]


@pytest.mark.parametrize("name", READS)
async def test_asking_for_the_default_is_the_default(
    name: str, api: httpx.AsyncClient, scene: Scene
) -> None:
    read = READS[name]
    explicit = {"include_unresolved_redirects": "false", "include_engine_internal": "false"}

    plain = await _get(scene.world, api, read.path, **read.params)
    asked = await _get(scene.world, api, read.path, **read.params, **explicit)

    assert plain.json() == asked.json()


async def test_the_domain_rows_name_what_each_toggle_brings_back(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    names = {}
    for label, toggle in TOGGLES.items():
        rows = (await _get(scene.world, api, "sources/domains", limit=200, **toggle)).json()
        names[label] = {row["registrable_domain"] for row in rows["data"]}

    assert "google.com" not in names["none"]
    assert "engine-product.com" not in names["none"]
    assert names["unresolved"] - names["none"] == {"google.com"}
    assert names["internal"] - names["none"] == {"engine-product.com"}
    assert names["both"] - names["none"] == {"google.com", "engine-product.com", "both-flagged.org"}


async def test_an_answer_citing_only_a_flagged_link_counts_but_does_not_cite(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The ChatGPT answer of day 3 cites only the grounding redirect: it stays a counted answer
    (the share's `n_observations`), and cites a source only when the toggle counts the link."""
    default = (await _get(scene.world, api, "sources/domains")).json()["meta"]
    counted = (await _get(scene.world, api, "sources/domains", **UNRESOLVED_TOGGLE)).json()["meta"]

    assert (default["answers"], default["answers_citing"]) == (4, 3)
    assert (counted["answers"], counted["answers_citing"]) == (4, 4)
    assert sum(role["citation_units"] for role in default["by_role"]) == default["citation_units"]
    assert sum(role["citation_units"] for role in counted["by_role"]) == counted["citation_units"]


async def test_the_shares_use_the_units_that_count(api: httpx.AsyncClient, scene: Scene) -> None:
    """The guide has 3 units: of 5 by default, of 7 with the redirects counted."""
    rows = {
        label: next(
            row
            for row in (await _get(scene.world, api, "sources/domains", **toggle)).json()["data"]
            if row["registrable_domain"] == "example.org"
        )
        for label, toggle in (("none", NO_TOGGLE), ("unresolved", UNRESOLVED_TOGGLE))
    }

    assert rows["none"]["source_share"]["value"] == pytest.approx(3 / 5)
    assert rows["unresolved"]["source_share"]["value"] == pytest.approx(3 / 7)
    assert rows["unresolved"]["source_share"]["denominator"] == 7


async def test_a_citation_with_another_flag_still_counts(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The wrapped link, flagged `redirect_unwrapped`, is counted by default."""
    rows = (await _get(scene.world, api, "sources/domains", limit=200)).json()["data"]

    assert "example.net" in {row["registrable_domain"] for row in rows}


async def test_the_series_and_the_previous_period_leave_the_flagged_out_too(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """Every number of a read follows the toggles: the weekly series, whose points add up to the
    units of the scope, and the counts of the window before."""
    for toggle, units in ((NO_TOGGLE, 5), (UNRESOLVED_TOGGLE, 7)):
        body = (
            await _get(
                scene.world,
                api,
                "sources/domains",
                include="series",
                compare="previous_period",
                **toggle,
            )
        ).json()
        assert sum(week["citation_units"] for week in body["meta"]["series"]) == units
        assert body["meta"]["citation_units"] == units
        assert all(row["previous"]["citation_units"] == 0 for row in body["data"])


async def test_the_detail_weeks_leave_the_flagged_out_too(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The guide's weekly numbers per engine: its own units do not move, and the units of every
    source of the engine that week (the share's denominator) follow the toggles."""
    for toggle, units in ((NO_TOGGLE, 5), (UNRESOLVED_TOGGLE, 7), (BOTH_TOGGLES, 9)):
        detail = (await _get(scene.world, api, "sources/domains/example.org", **toggle)).json()
        weeks = [week for engine in detail["data"]["engines"] for week in engine["series"]]
        assert sum(week["citation_units"] for week in weeks) == 3
        assert sum(week["all_citation_units"] for week in weeks) == units


async def test_the_lost_and_new_rules_leave_the_flagged_out_too(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """A flagged link is no source of a domain: google.com is not new while the redirects are
    left out, and is new when they count."""
    default = (await _get(scene.world, api, "sources/changes", min_support=2)).json()["data"]
    counted = (
        await _get(scene.world, api, "sources/changes", min_support=2, **UNRESOLVED_TOGGLE)
    ).json()["data"]

    assert "google.com" not in {row["registrable_domain"] for row in default}
    assert "google.com" in {row["registrable_domain"] for row in counted}


async def test_the_citation_list_and_fanout_keep_every_citation(
    api: httpx.AsyncClient, scene: Scene
) -> None:
    """The list of citations is the evidence behind the counts: it lists the flagged ones, and the
    fan-out read names a domain whatever its links are flagged."""
    citations = (await _get(scene.world, api, "citations", limit=100)).json()["data"]
    fanout = (await _get(scene.world, api, "fanout-queries", min_support=1)).json()["data"]

    assert [row["raw_url"] for row in citations].count(REDIRECT) == 2
    assert {ENGINE, BOTH} <= {row["raw_url"] for row in citations}
    assert len(citations) == 9
    (query,) = fanout
    assert [d["registrable_domain"] for d in query["cited_domains"]] == ["google.com"]
    assert query["cited_domains"][0]["citation_units"] == 1


async def test_the_toggles_add_no_statement(
    api: httpx.AsyncClient, resources: Resources, scene: Scene
) -> None:
    for name, read in READS.items():
        await _get(scene.world, api, read.path, **read.params)
        with statements(resources) as plain:
            await _get(scene.world, api, read.path, **read.params)
        with statements(resources) as toggled:
            await _get(scene.world, api, read.path, **read.params, **BOTH_TOGGLES)
        assert len(toggled) == len(plain), name
    await _get(scene.world, api, "sources/prompts")
    with statements(resources) as plain:
        await _get(scene.world, api, "sources/prompts")
    with statements(resources) as toggled:
        await _get(scene.world, api, "sources/prompts", **BOTH_TOGGLES)
    assert len(toggled) == len(plain)


@pytest.fixture
async def plain(resources: Resources, migrated: PostgresServer) -> Scene:
    """A scene with no flagged citation."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite(), Cite(GUIDE)])
    await answer(
        migrated, world, prompt, days_ago=2, engine="gemini_web", cites=[Cite(WRAPPED), Cite(GUIDE)]
    )
    return Scene(world, prompt)


@pytest.mark.parametrize("name", READS)
async def test_plain_requests_answer_as_before_without_flagged_citations(
    name: str, api: httpx.AsyncClient, plain: Scene
) -> None:
    read = READS[name]

    default = await _get(plain.world, api, read.path, **read.params)
    toggled = await _get(plain.world, api, read.path, **read.params, **BOTH_TOGGLES)

    assert default.json() == toggled.json()


def test_the_default_is_one_constant_and_leaves_both_flags_out() -> None:
    """`FLAGGED_COUNTED_BY_DEFAULT` is the one place the default is decided (O1): False leaves
    both flags out when no toggle is asked, each toggle brings its flag back."""
    assert FLAGGED_COUNTED_BY_DEFAULT is False
    assert flag_toggles() == (INTERNAL, UNRESOLVED)
    assert flag_toggles(include_unresolved_redirects=True) == (INTERNAL,)
    assert flag_toggles(include_engine_internal=True) == (UNRESOLVED,)
    assert flag_toggles(include_unresolved_redirects=True, include_engine_internal=True) == ()


@pytest.fixture
async def own_scene(resources: Resources, migrated: PostgresServer) -> Scene:
    """Prompt P1: one answer citing an own page flagged `unresolved_redirect` and another own
    page. Prompt P2: one answer citing only a flagged own page."""
    world = await make_world(resources, migrated)
    first = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    second = await add_prompt(migrated, world.project, "How much does a SOC cost?")
    one = await answer(
        migrated, world, first, days_ago=1, cites=[world.own_cite(), world.own_cite(OWN_BLOG)]
    )
    two = await answer(migrated, world, second, days_ago=1, cites=[world.own_cite()])
    await _flag(migrated, one, 1, UNRESOLVED)
    await _flag(migrated, two, 1, UNRESOLVED)
    return Scene(world, first)


async def test_the_prompts_read_leaves_a_flagged_own_citation_out_by_default(
    api: httpx.AsyncClient, own_scene: Scene
) -> None:
    """P1 cites one own page that counts (the blog) and P2 none; with the toggle P1 cites two and
    P2 one."""
    default = (await _get(own_scene.world, api, "sources/prompts")).json()["data"]
    counted = (await _get(own_scene.world, api, "sources/prompts", **UNRESOLVED_TOGGLE)).json()[
        "data"
    ]

    assert sorted((r["answers_citing_own"], r["own_citation_units"]) for r in default) == [
        (0, 0),
        (1, 1),
    ]
    assert sorted((r["answers_citing_own"], r["own_citation_units"]) for r in counted) == [
        (1, 1),
        (1, 2),
    ]
    assert sorted(r["own_pages"] for r in default) == [0, 1]
    assert sorted(r["own_pages"] for r in counted) == [1, 2]


async def test_filter_own_cited_follows_the_toggles(
    api: httpx.AsyncClient, own_scene: Scene
) -> None:
    """P2 cites no own page that counts by default, so `own_cited=false` keeps it; with the
    toggle it cites one."""
    asked = {"filter[own_cited]": "false"}
    default = (await _get(own_scene.world, api, "sources/prompts", **asked)).json()["data"]
    counted = (
        await _get(own_scene.world, api, "sources/prompts", **asked, **UNRESOLVED_TOGGLE)
    ).json()["data"]

    assert len(default) == 1
    assert counted == []


async def test_the_prompts_read_with_an_engine_internal_own_link(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    cited = await answer(migrated, world, prompt, days_ago=1, cites=[world.own_cite()])
    await _flag(migrated, cited, 1, INTERNAL)

    default = (await _get(world, api, "sources/prompts")).json()["data"]
    counted = (await _get(world, api, "sources/prompts", **INTERNAL_TOGGLE)).json()["data"]
    other = (await _get(world, api, "sources/prompts", **UNRESOLVED_TOGGLE)).json()["data"]

    assert [r["answers_citing_own"] for r in default] == [0]
    assert [r["answers_citing_own"] for r in counted] == [1]
    assert [r["answers_citing_own"] for r in other] == [0]


async def test_a_prompts_cursor_is_bound_to_the_toggles(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, own_scene: Scene
) -> None:
    world = own_scene.world
    cursor = (await _get(world, api, "sources/prompts", limit=1)).json()["page"]["next_cursor"]
    assert cursor is not None

    for toggle in (UNRESOLVED_TOGGLE, INTERNAL_TOGGLE, BOTH_TOGGLES):
        response = await api.get(
            world.url("ai", "sources", "prompts"),
            params={"limit": 1, "cursor": cursor, **toggle},
            headers=world.owner.headers,
        )
        assert problem(response) == INVALID_CURSOR, toggle
    same = await api.get(
        world.url("ai", "sources", "prompts"),
        params={"limit": 1, "cursor": cursor},
        headers=world.owner.headers,
    )
    assert same.status_code == 200, same.text


async def _mention(
    pg: PostgresServer, world: World, observation_id: int, entity: uuid.UUID
) -> None:
    """The mention of a tracked entity in an answer, as `seed_extraction` writes one."""
    observation = await fetchrow(
        pg, "SELECT observed_at, engine_code FROM ai.observations WHERE id = $1", observation_id
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
        entity,
        world.derivation_id,
        world.project.workspace_id,
        world.project.id,
        observation["engine_code"],
        "own" if entity == world.own else "competitor",
    )


@dataclass(frozen=True)
class Flagged:
    world: World
    first: Prompt
    second: Prompt


@pytest.fixture
async def flagged(resources: Resources, migrated: PostgresServer) -> Flagged:
    """Two prompts, days before now in brackets. P1 is "Best managed SOC providers?", P2 "How
    much does a SOC cost?". The link to the guide's top page is flagged `unresolved_redirect` in
    f2 and `engine_internal` in f3, the grounding redirect (google.com) in g1 and g2.

      f1 (1)  ChatGPT, P1   the guide, the wiki                  names the rival
      f2 (2)  ChatGPT, P1   the top page (flagged)               names the own brand
      f3 (3)  ChatGPT, P2   the top page (flagged)               names the own brand
      g1 (2)  Gemini, P1    the guide, the redirect (flagged)    names nobody
      g2 (3)  Gemini, P1    the redirect (flagged)               names nobody

    Counted by default: ChatGPT 3 answers, 1 citing, 2 units on 2 domains (example.org and
    wikipedia.org), so (1 + 1)^2 / (1 + 1) = 2; Gemini 2 answers, 1 citing, 1 unit on 1 domain.
    Nothing else moves: f2, f3 and g2 are answers that cite no source that counts."""
    world = await make_world(resources, migrated)
    first = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    second = await add_prompt(migrated, world.project, "How much does a SOC cost?")
    f1 = await answer(migrated, world, first, days_ago=1, cites=[Cite(GUIDE), Cite(WIKI)])
    f2 = await answer(migrated, world, first, days_ago=2, cites=[Cite(GUIDE_TOP)])
    f3 = await answer(migrated, world, second, days_ago=3, cites=[Cite(GUIDE_TOP)])
    g1 = await answer(
        migrated,
        world,
        first,
        days_ago=2,
        engine="gemini_web",
        cites=[Cite(GUIDE), Cite(REDIRECT)],
    )
    g2 = await answer(
        migrated, world, first, days_ago=3, engine="gemini_web", cites=[Cite(REDIRECT)]
    )
    await _flag(migrated, f2, 1, UNRESOLVED)
    await _flag(migrated, f3, 1, INTERNAL)
    await _flag(migrated, g1, 2, UNRESOLVED)
    await _flag(migrated, g2, 1, UNRESOLVED)
    await _mention(migrated, world, f1, world.rival)
    await _mention(migrated, world, f2, world.own)
    await _mention(migrated, world, f3, world.own)
    return Flagged(world, first, second)


def _engines(response: httpx.Response) -> dict[str, dict[str, Any]]:
    return {entry["engine_code"]: entry for entry in response.json()["data"]}


async def test_the_effective_sources_leave_the_flagged_citation_out(
    api: httpx.AsyncClient, flagged: Flagged
) -> None:
    """The squares of `effective_sources` come from the units per domain: the flagged links to
    example.org (2 more units) and google.com (2 units, a domain of its own) are not in them."""
    response = await _get(flagged.world, api, "sources/diversity")

    engines = _engines(response)
    chatgpt, gemini = engines["chatgpt_web"], engines["gemini_web"]
    assert (chatgpt["citation_units"], chatgpt["distinct_domains"]) == (2, 2)
    assert (
        chatgpt["effective_sources"]["numerator"],
        chatgpt["effective_sources"]["denominator"],
    ) == (
        4.0,
        2,
    )
    assert chatgpt["effective_sources"]["value"] == pytest.approx(2.0)
    assert (gemini["citation_units"], gemini["distinct_domains"]) == (1, 1)
    assert (
        gemini["effective_sources"]["numerator"],
        gemini["effective_sources"]["denominator"],
    ) == (
        1.0,
        1,
    )
    assert response.json()["meta"]["distinct_domains"] == 2


async def test_an_answer_with_only_flagged_links_still_counts_in_diversity(
    api: httpx.AsyncClient, flagged: Flagged
) -> None:
    """f2, f3 and g2 are answers, only not citing a source: they stay in `answers` and out of
    `answers_citing`. With the toggles they cite."""
    default = _engines(await _get(flagged.world, api, "sources/diversity"))
    counted = _engines(await _get(flagged.world, api, "sources/diversity", **BOTH_TOGGLES))

    assert [
        (e["answers"], e["answers_citing"]) for e in (default["chatgpt_web"], default["gemini_web"])
    ] == [
        (3, 1),
        (2, 1),
    ]
    assert [
        (e["answers"], e["answers_citing"]) for e in (counted["chatgpt_web"], counted["gemini_web"])
    ] == [
        (3, 3),
        (2, 2),
    ]


async def test_the_diversity_weeks_leave_the_flagged_citation_out(
    api: httpx.AsyncClient, flagged: Flagged
) -> None:
    """Whatever week the answers fall in, the weekly units of an engine add up to the units it
    counts: 2 for ChatGPT and 1 for Gemini, and 4 and 3 with the flagged links counted."""
    for toggle, expected in ((NO_TOGGLE, (2, 1)), (BOTH_TOGGLES, (4, 3))):
        engines = _engines(
            await _get(flagged.world, api, "sources/diversity", include="series", **toggle)
        )
        units = tuple(
            sum(point["citation_units"] for point in engines[code]["series"])
            for code in ("chatgpt_web", "gemini_web")
        )
        assert units == expected, toggle


async def test_the_domain_detail_prompts_leave_the_flagged_citation_out(
    api: httpx.AsyncClient, flagged: Flagged
) -> None:
    """example.org is cited by P1 in f1 and g1 (2 units in 2 answers); P2 cites it only through
    a flagged link, so it is not one of the domain's prompts."""
    default = (await _get(flagged.world, api, "sources/domains/example.org")).json()["data"]
    counted = (
        await _get(flagged.world, api, "sources/domains/example.org", **BOTH_TOGGLES)
    ).json()["data"]

    assert [
        (p["prompt_id"], p["citation_units"], p["observations"]) for p in default["prompts"]
    ] == [(str(flagged.first.id), 2, 2)]
    assert [
        (p["prompt_id"], p["citation_units"], p["observations"]) for p in counted["prompts"]
    ] == [
        (str(flagged.first.id), 3, 3),
        (str(flagged.second.id), 1, 1),
    ]


async def test_the_role_split_per_engine_agrees_with_the_roles_on_the_flagged_scene(
    api: httpx.AsyncClient, flagged: Flagged
) -> None:
    """ChatGPT: 2 third-party units in 1 answer; Gemini: 1 unit in 1. Both reads leave the
    flagged links out, so the split adds up to `by_role`; with the toggles they count in both."""
    for toggle, expected in (
        (NO_TOGGLE, {"chatgpt_web": (2, 1), "gemini_web": (1, 1)}),
        (BOTH_TOGGLES, {"chatgpt_web": (4, 3), "gemini_web": (3, 2)}),
    ):
        meta = (
            await _get(flagged.world, api, "sources/domains", include="by_role_by_engine", **toggle)
        ).json()["meta"]

        split = {
            entry["engine_code"]: (
                entry["third_party"]["citation_units"],
                entry["third_party"]["answers_citing"],
            )
            for entry in meta["by_role_by_engine"]
        }
        by_role = next(r for r in meta["by_role"] if r["domain_role"] == "third_party")
        assert {k: split[k] for k in expected} == expected, toggle
        assert sum(units for units, _ in split.values()) == by_role["citation_units"], toggle
        assert meta["citation_units"] == by_role["citation_units"], toggle


async def test_cited_with_does_not_name_an_entity_of_a_flagged_citation(
    api: httpx.AsyncClient, flagged: Flagged
) -> None:
    """example.org is cited by f1 (names the rival) and g1 (names nobody). f2 and f3 reach it
    only through a flagged link and name the own brand: with the toggles the own brand, named
    twice, wins over the rival, named once."""
    rows = {}
    for label, toggle in (("none", NO_TOGGLE), ("both", BOTH_TOGGLES)):
        body = (
            await _get(flagged.world, api, "sources/domains", include="cited_with", **toggle)
        ).json()["data"]
        rows[label] = next(r for r in body if r["registrable_domain"] == "example.org")

    assert rows["none"]["cited_with"] == {"entity_id": str(flagged.world.rival), "observations": 1}
    assert rows["both"]["cited_with"] == {"entity_id": str(flagged.world.own), "observations": 2}
