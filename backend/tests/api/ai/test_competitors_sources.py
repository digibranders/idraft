"""Top sources of the competitors read (contract C5, `include=top_sources`): per tracked entity,
the registrable domains cited with the entity as their role, by citation units over all the
engines shown, counted as the Sources page counts them. The expected numbers are worked out by
hand from the seeded world of `test_prompts_summary` (see the docstring of its `summary` fixture);
the own page is cited in answers 2 and 5 of `providers` and in `misc` on ChatGPT and in the Gemini
answer, the rival's page in answer 4 and in `pricing` and in the Gemini answer, an outside page (no
role entity) in answers 1 and 3:

    own    eventussecurity.com  4 units in 4 answers (3 of ChatGPT, 1 of Gemini)
    rival  cybernx.com          3 units in 3 answers (2 of ChatGPT, 1 of Gemini)"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from idraft.api.ai import competitor_repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.db.engine import workspace_transaction
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import competitors_body, get_competitors, row_of
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_ONLY,
    OWN_PAGE,
    Answer,
    Summary,
    answer_in_another_project,
    ingested,
    new_world,
)
from tests.api.ai.test_prompts_summary import NEITHER
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import problem
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import OWN_HOST, RIVAL_HOST
from tests.collectors.rank_support import _entity
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

SOURCES = {"include": "top_sources"}
NEWS, WIKI, AAA = "news.example", "wiki.example", "aaa.example"


def _sources(body: dict[str, Any], entity: uuid.UUID) -> list[tuple[str, int, int]]:
    """(domain, citation units, answers) of the entity's top sources."""
    return [
        (item["registrable_domain"], item["citation_units"], item["answers"])
        for item in row_of(body, entity)["top_sources"]
    ]


async def _role_of(
    migrated: PostgresServer, world: Summary, entity: uuid.UUID, *domains: str
) -> None:
    """The citations of these registrable domains are made to name the entity as their role."""
    await execute(
        migrated,
        "UPDATE ai.citations c SET role_entity_id = $2, domain_role = 'competitor' "
        "FROM core.domains d WHERE d.id = c.domain_id AND c.project_id = $1 "
        "AND d.registrable_domain = ANY($3::text[])",
        world.project.id,
        entity,
        list(domains),
    )


async def test_top_sources_are_the_domains_cited_for_the_entity_by_units(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api, **SOURCES)

    # The own row has sources too; the outside page has no role entity and is nobody's.
    assert _sources(body, seeded.own) == [(OWN_HOST, 4, 4)]
    assert _sources(body, seeded.rival) == [(RIVAL_HOST, 3, 3)]
    assert [item["engine_code"] for item in body["data"][0]["by_engine"]] == [CHATGPT, GEMINI]
    # One list a row, over all the engines: not one for each engine.
    assert "top_sources" not in body["data"][0]["by_engine"][0]


async def test_top_sources_are_by_units_then_domain_and_count_answers(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The rival is also the role of the outside page (2 units in 2 answers), of a wiki cited in one
    answer with four pages (4 units in 1 answer: most units, though last by name) and of a site
    whose two pages are cited in one answer (2 units in 1 answer: a tie with the outside page, which
    its name puts first, whatever the answers)."""
    await _crowd_the_rival(migrated, worker_db, import_store, seeded)

    body = await competitors_body(seeded, api, sources_limit=4, **SOURCES)

    assert _sources(body, seeded.rival) == [
        (WIKI, 4, 1),
        (RIVAL_HOST, 3, 3),
        (AAA, 2, 1),
        (NEWS, 2, 2),
    ]


async def _crowd_the_rival(
    migrated: PostgresServer, worker_db: Ledger, store: MemoryStore, world: Summary
) -> None:
    """The rival has four domains: cybernx.com (3 units), news.example (2), wiki.example (4) and
    aaa.example (2)."""
    wiki = tuple(f"https://{WIKI}/soc-{n}" for n in range(4))
    aaa = tuple(f"https://{AAA}/soc-{n}" for n in range(2))
    await ingested(
        world,
        migrated,
        worker_db,
        store,
        [Answer("misc", NEITHER, wiki, 2), Answer("misc", NEITHER, aaa, 3)],
    )
    await _role_of(migrated, world, world.rival, NEWS, WIKI, AAA)


async def test_sources_limit_caps_each_entity(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    await _crowd_the_rival(migrated, worker_db, import_store, seeded)

    default = await competitors_body(seeded, api, **SOURCES)
    one = await competitors_body(seeded, api, sources_limit=1, **SOURCES)
    four = await competitors_body(seeded, api, sources_limit=4, **SOURCES)

    # Three by default, and the cap is for each entity: the own row keeps its one domain.
    assert [domain for domain, _, _ in _sources(default, seeded.rival)] == [WIKI, RIVAL_HOST, AAA]
    assert _sources(one, seeded.rival) == [(WIKI, 4, 1)]
    assert [domain for domain, _, _ in _sources(four, seeded.rival)] == [
        WIKI,
        RIVAL_HOST,
        AAA,
        NEWS,
    ]
    two = await competitors_body(seeded, api, sources_limit=2, **SOURCES)
    assert len(_sources(two, seeded.rival)) == 2
    for body in (default, one, two):
        assert _sources(body, seeded.own) == [(OWN_HOST, 4, 4)]
    for value in ("0", "6", "x"):
        assert problem(await get_competitors(seeded, api, sources_limit=value, **SOURCES)) == (
            422,
            "validation_failed",
        ), value


async def test_an_entity_with_no_cited_domain_has_an_empty_list(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    alpha = await _entity(migrated, seeded.project, "Alpha Corp", "alpha.example", "competitor")

    body = await competitors_body(seeded, api, **SOURCES)

    assert row_of(body, alpha)["top_sources"] == []


async def test_top_sources_are_absent_unless_asked(api: httpx.AsyncClient, seeded: Summary) -> None:
    for params in ({}, {"include": "lost_prompts"}, {"sources_limit": 2}):
        body = await competitors_body(seeded, api, **params)

        assert all("top_sources" not in row for row in body["data"]), params


async def test_top_sources_leave_out_flagged_citations(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """As on the Sources page: a citation flagged `engine_internal` or `unresolved_redirect` is not
    a unit, and its answer does not count for the domain."""
    await execute(
        migrated,
        "UPDATE ai.citations SET flags = ARRAY['unresolved_redirect'] "
        "WHERE project_id = $1 AND engine_code = $2 AND domain_role = 'own'",
        seeded.project.id,
        CHATGPT,
    )
    await execute(
        migrated,
        "UPDATE ai.citations SET flags = ARRAY['engine_internal'] "
        "WHERE project_id = $1 AND domain_role = 'competitor'",
        seeded.project.id,
    )

    body = await competitors_body(seeded, api, **SOURCES)

    # Only the Gemini citation of the own page is left, and the rival has none: an empty list.
    assert _sources(body, seeded.own) == [(OWN_HOST, 1, 1)]
    assert _sources(body, seeded.rival) == []


async def test_top_sources_follow_branded_and_term_scope(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The branded prompt cites the own page once; `misc` (no topic) is out of Managed SOC."""
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("brand", OWN_ONLY, (OWN_PAGE,), 1)]
    )

    default = await competitors_body(seeded, api, **SOURCES)
    branded = await competitors_body(seeded, api, include_branded="true", **SOURCES)
    only = await competitors_body(seeded, api, branded_only="true", **SOURCES)
    soc = await competitors_body(
        seeded, api, **{"filter[term]": str(seeded.topics["soc"])}, **SOURCES
    )
    india = await competitors_body(seeded, api, **{"filter[country_iso]": "FR"}, **SOURCES)

    assert _sources(default, seeded.own) == [(OWN_HOST, 4, 4)]
    assert _sources(branded, seeded.own) == [(OWN_HOST, 5, 5)]
    assert _sources(only, seeded.own) == [(OWN_HOST, 1, 1)]
    assert _sources(only, seeded.rival) == []
    # `providers` and `pricing`: answers 2 and 5 of ChatGPT, and the Gemini answer.
    assert _sources(soc, seeded.own) == [(OWN_HOST, 3, 3)]
    assert _sources(soc, seeded.rival) == [(RIVAL_HOST, 3, 3)]
    assert _sources(india, seeded.own) == []


async def test_the_engine_filter_narrows_the_engines_the_sources_are_counted_over(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    chatgpt = await competitors_body(seeded, api, **{"filter[engine_code_in]": CHATGPT}, **SOURCES)
    gemini = await competitors_body(seeded, api, **{"filter[engine_code_in]": GEMINI}, **SOURCES)

    assert _sources(chatgpt, seeded.own) == [(OWN_HOST, 3, 3)]
    assert _sources(gemini, seeded.own) == [(OWN_HOST, 1, 1)]
    assert _sources(chatgpt, seeded.rival) == [(RIVAL_HOST, 2, 2)]
    assert _sources(gemini, seeded.rival) == [(RIVAL_HOST, 1, 1)]


async def test_another_projects_citations_are_not_top_sources(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today and cite a page
    whose role is the rival entity: the rows do not move."""
    before = await get_competitors(seeded, api, include_branded="true", **SOURCES)
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)
    await execute(
        migrated,
        "UPDATE ai.citations SET role_entity_id = $2, domain_role = 'competitor' "
        "WHERE project_id <> $1",
        seeded.project.id,
        seeded.rival,
    )
    spoofed = await fetchrow(
        migrated, "SELECT count(*) AS n FROM ai.citations WHERE role_entity_id = $1", seeded.rival
    )
    assert spoofed["n"] >= 4

    after = await get_competitors(seeded, api, include_branded="true", **SOURCES)

    assert after.json() == before.json()


async def test_the_sources_read_stays_in_the_project(
    resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """The statement itself, asked for this project's prompts: given another project's id (or
    another workspace's) it reads nothing."""
    other_project = await make_project(migrated, seeded.workspace.id)
    now = datetime.now(UTC)

    def scope(workspace_id: uuid.UUID, project_id: uuid.UUID) -> SourceScope:
        return SourceScope(
            workspace_id=workspace_id,
            project_id=project_id,
            since=now - timedelta(days=28),
            until=now + timedelta(days=1),
            engine_codes=(CHATGPT, GEMINI),
            prompt_ids=tuple(prompt.id for prompt in seeded.prompts.values()),
            excluded_flags=("engine_internal", "unresolved_redirect"),
        )

    ids = [seeded.own, seeded.rival]
    async with workspace_transaction(resources.sessions, seeded.workspace.id) as db:
        own = await competitor_repository.top_sources(
            db, scope(seeded.workspace.id, seeded.project.id), ids, 5
        )
        elsewhere = await competitor_repository.top_sources(
            db, scope(seeded.workspace.id, other_project), ids, 5
        )
        foreign = await competitor_repository.top_sources(
            db, scope(uuid.uuid4(), seeded.project.id), ids, 5
        )

    assert set(own) == {seeded.own, seeded.rival}
    assert elsewhere == {}
    assert foreign == {}


async def test_a_world_without_prompts_has_empty_lists_and_reads_no_citation(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    world = await new_world(resources, migrated)

    body = await competitors_body(world, api, include="top_sources,lost_prompts")

    assert [row["top_sources"] for row in body["data"]] == [[], []]
    rival = row_of(body, world.rival)["by_engine"][0]
    assert (rival["lost_prompts"], rival["lost_prompts_total"]) == ([], 0)
    assert rival["lost_prompts_with_min_answers"] == 0
