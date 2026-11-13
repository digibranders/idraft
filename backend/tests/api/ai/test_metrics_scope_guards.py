"""The scope guards, on all seven aggregate routes at once (contract C8 and C5, WP-32 task 8).

Each route has its own tests of these guards beside its code; this file is the one place that
proves they hold the same way on every route, including the extra reads a route makes after the
summary (the role totals of the citation share, the entity units, the lost counts, the top
sources, the prompt attributes). Four guards:

- tenant: another project, and another workspace, never appear (`...are_not_counted...`);
- branded prompts are left out by default and back with `include_branded`;
- the term filter keeps the prompts given the term or a term below it;
- the 92 day cap: `test_a_window_is_at_most_92_days_and_in_order` of `test_metrics_contract` sends
  the longest window and one day more to all seven routes, so it is not repeated here.

A foreign or deleted project is `404 not_found` on every route, never `200` with empty data.
The seeded world is that of `test_prompts_summary`: three prompts in scope, one branded prompt
with an answer, Managed SOC (providers and pricing) and Compliance (providers) as topics."""

from __future__ import annotations

from typing import Any

import httpx

from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import entry, row_of
from tests.api.ai.metrics_support import (
    BREAKDOWN,
    COMPETITORS,
    OVERVIEW,
    ROUTES,
    Route,
    engine_tiles,
    get_overview,
)
from tests.api.ai.summary_support import CHATGPT, Summary, answer_in_another_project
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import problem
from tests.api.keywords.support import project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

# The two blocks of the competitors read are asked for: they are reads of their own.
EXTRA = {COMPETITORS.name: {"include": "lost_prompts,top_sources"}}


def _request(route: Route, **params: str) -> dict[str, str]:
    """The query of a valid request to the route: what it needs, and the blocks it can hold."""
    return {**route.needs, **EXTRA.get(route.name, {}), **params}


async def _body(world: Summary, api: httpx.AsyncClient, route: Route, **params: str) -> Any:
    response = await get_overview(world, api, route, **_request(route, **params))
    assert response.status_code == 200, (route.name, params, response.text)
    return response.json()


def _scrubbed(node: Any) -> Any:
    """The body without the `filters` echo of each value (it names the scope a test varies)."""
    if isinstance(node, dict):
        return {key: _scrubbed(item) for key, item in node.items() if key != "filters"}
    if isinstance(node, list):
        return [_scrubbed(item) for item in node]
    return node


def _plain(data: Any) -> Any:
    """The data without `topics_in_scope`, the one member that counts the term rows themselves."""
    if isinstance(data, dict):
        return {key: item for key, item in data.items() if key != "topics_in_scope"}
    return data


async def _data(world: Summary, api: httpx.AsyncClient, route: Route, **params: str) -> Any:
    return _scrubbed((await _body(world, api, route, **params))["data"])


async def _citations(world: Summary, api: httpx.AsyncClient, **scope: str) -> dict[str, Any]:
    """What the reads that go beyond the summary count on ChatGPT, as absolute numbers (the
    comparisons of the tests below are relative, so a leak that is always there would not move
    them): the Overview's own and all citation units, the competitors read's own and rival units
    and the units of the rival's top sources."""
    overview = engine_tiles((await _body(world, api, OVERVIEW, **scope))["data"], CHATGPT)
    body = await _body(world, api, COMPETITORS, include="top_sources", **scope)

    def units(value: dict[str, Any]) -> tuple[float, float]:
        return value["numerator"], value["denominator"]

    return {
        "overview": units(overview["ai.citation_share"]),
        "own": units(entry(row_of(body, world.own), CHATGPT)["citation_share"]),
        "rival": units(entry(row_of(body, world.rival), CHATGPT)["citation_share"]),
        "rival_sources": sum(
            source["citation_units"] for source in row_of(body, world.rival)["top_sources"]
        ),
    }


async def test_another_projects_and_workspaces_answers_are_not_counted_on_every_route(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today, naming their
    brand and citing a page, and the pages they cite are given the rival's role: no body moves."""
    scope = {"include_branded": "true"}

    def asked(route: Route) -> dict[str, str]:
        return {**scope, **({"compare": "previous_period"} if route.compares else {})}

    before = {route.name: await _body(seeded, api, route, **asked(route)) for route in ROUTES}
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

    for route in ROUTES:
        after = await _body(seeded, api, route, **asked(route))

        assert after == before[route.name], route.name
    # Own 3, rival 2 and third parties 2 citation units of 7 on ChatGPT (the rival's top sources
    # are over every engine: one more on Gemini): the other projects add none.
    assert await _citations(seeded, api) == {
        "overview": (3, 7),
        "own": (3, 7),
        "rival": (2, 7),
        "rival_sources": 3,
    }


async def test_branded_prompts_are_left_out_of_every_route_by_default(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """The branded prompt has an answer that names the own brand. The default scope never holds
    it, `include_branded` adds it and `branded_only` is it alone; once the prompt is archived
    nothing else was branded, so asking for it changes nothing."""
    default = {route.name: await _data(seeded, api, route) for route in ROUTES}
    asked = {
        route.name: await _data(seeded, api, route, include_branded="true") for route in ROUTES
    }
    only = {route.name: await _data(seeded, api, route, branded_only="true") for route in ROUTES}

    for route in ROUTES:
        assert asked[route.name] != default[route.name], route.name
        assert only[route.name] not in (default[route.name], asked[route.name]), route.name
    await execute(
        migrated,
        "UPDATE ai.prompts SET is_active = false WHERE id = $1",
        seeded.prompts["brand"].id,
    )
    for route in ROUTES:
        assert await _data(seeded, api, route) == default[route.name], route.name
        assert await _data(seeded, api, route, include_branded="true") == default[route.name], (
            route.name
        )
    # The archived prompt cites the own page too and is never counted: own 3 of 7 units, not 4.
    assert await _citations(seeded, api, include_branded="true") == {
        "overview": (3, 7),
        "own": (3, 7),
        "rival": (2, 7),
        "rival_sources": 3,
    }


async def test_the_term_subtree_scopes_every_route(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """Managed SOC (providers and pricing) is put under a new term Security. A filter on Security
    gives what a filter on Managed SOC gives, `misc` stays out of both, and Compliance
    (providers alone) differs from Managed SOC because `pricing` is not under it."""
    soc = seeded.topics["soc"]
    parent = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "SELECT workspace_id, vocabulary_id, 'Security', 'security', 'security' "
        "FROM core.taxonomy_terms WHERE id = $1 RETURNING id",
        soc,
    )
    await execute(
        migrated,
        "UPDATE core.taxonomy_terms SET parent_id = $2, path = 'security/managed-soc' "
        "WHERE id = $1",
        soc,
        parent["id"],
    )

    for route in ROUTES:
        # The topic rows of the breakdown would list Security itself under its own filter: the
        # markets of the same prompts show the scope without them.
        rows = {"dimension": "country"} if route is BREAKDOWN else {}
        whole = await _data(seeded, api, route, **rows)
        under_soc = await _data(seeded, api, route, **rows, **{"filter[term]": str(soc)})
        under_parent = await _data(
            seeded, api, route, **rows, **{"filter[term]": str(parent["id"])}
        )
        compliance = await _data(
            seeded, api, route, **rows, **{"filter[term]": str(seeded.topics["compliance"])}
        )

        # The Overview also counts the topics in scope, and Security is one more topic row.
        assert _plain(under_parent) == _plain(under_soc), route.name
        assert under_soc != whole, route.name
        assert compliance not in (under_soc, whole), route.name
    # The citation reads keep to the prompts of the term: `misc` (own page) is out of Managed SOC
    # (own 2, rival 2, third parties 2 of 6 units) and `pricing` (rival page) out of Compliance.
    assert await _citations(seeded, api, **{"filter[term]": str(parent["id"])}) == {
        "overview": (2, 6),
        "own": (2, 6),
        "rival": (2, 6),
        "rival_sources": 3,
    }
    assert await _citations(seeded, api, **{"filter[term]": str(seeded.topics["compliance"])}) == {
        "overview": (2, 5),
        "own": (2, 5),
        "rival": (1, 5),
        "rival_sources": 2,
    }


async def test_a_foreign_or_deleted_project_is_not_found_on_every_route(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    """A project of another workspace read through this workspace's path, and a deleted project,
    answer `404 not_found` and never `200` with empty data."""
    foreign = await make_project(migrated, (await make_workspace(migrated)).id)
    for route in ROUTES:
        url = project_url(seeded.workspace, foreign, *route.tail)
        response = await api.get(url, params=_request(route), headers=seeded.owner.headers)

        assert problem(response) == (404, "not_found"), route.name
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )
    for route in ROUTES:
        response = await get_overview(seeded, api, route, **_request(route))

        assert problem(response) == (404, "not_found"), route.name
