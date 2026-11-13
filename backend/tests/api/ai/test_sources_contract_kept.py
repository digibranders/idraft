"""The guards of the WP-03 contract file `test_contract_sources.py` that are still true now the
additions are built (WP-14 T9), and the guard of the whole package: every source read sends a fixed
number of statements. WP-14 deleted the WP-03 file once each of its guards had a home.

Where each old guard went (test names of the deleted file, `501` guards are gone with the stubs):

| Old guard                                                         | New home                |
|-------------------------------------------------------------------|-------------------------|
| `test_a_built_new_source_route_answers_a_viewer` (3 routes)       | `test_a_viewer_reads_*` |
| `test_a_new_source_route_checks_access_first` (3 routes)          | `test_every_source_*`   |
| `test_the_source_reads_check_access_first` (changes, `include`s)  | `test_every_source_*`   |
| `test_a_registrable_domain_longer_than_253_is_refused`            | `BOUNDS` (path of 254)  |
| `test_an_addition_out_of_bounds_is_refused` (12 cases)            | `BOUNDS` (first block)  |
| `test_the_source_reads_without_additions_answer_as_before`        | `test_plain_reads_*`    |
| `test_a_plain_source_row_holds_none_of_the_added_fields`          | `test_plain_reads_*`    |
| `test_the_api_document_has_the_source_additions`                  | same name, below        |
| `test_the_api_document_has_the_new_source_routes`                 | same name, below        |

New here: the access check over every source route and option, the bounds of every parameter T1 to
T8 added, the as-built key sets of every plain read, the descriptions that still say "not built",
and the statement counts."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from idraft.api.resources import Resources
from tests.api.ai.sources_support import (
    GUIDE,
    GUIDE_TOP,
    WIKI,
    Cite,
    World,
    answer,
    full_project,
    make_world,
    statements,
    tag,
    topic_of,
)
from tests.api.ai.support import ai_project
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import project_url
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer

FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")
TOO_LARGE = (422, "window_too_large")

COUNTRY = {"filter[country_iso]": "US"}
FLAGS = {"include_unresolved_redirects": "true", "include_engine_internal": "true"}

# Every source route with every option it takes (the entries of the cross-tenant `QUERIES`).
OPTIONS: list[tuple[str, dict[str, str]]] = [
    (
        "sources/domains",
        {
            "include": "series,cited_with,by_role_by_engine",
            "compare": "previous_period",
            "min_support": "1",
            **COUNTRY,
            **FLAGS,
        },
    ),
    (
        "sources/pages",
        {"include": "series", "compare": "previous_period", "min_support": "1", **COUNTRY, **FLAGS},
    ),
    ("sources/changes", {"kind": "lost", "min_support": "1", **COUNTRY, **FLAGS}),
    ("citations", COUNTRY),
    ("fanout-queries", {"include": "topics", "min_support": "1", **COUNTRY}),
    ("sources/diversity", {"include": "series,ads", **COUNTRY, **FLAGS}),
    ("sources/domains/g2.com", {**COUNTRY, **FLAGS}),
    ("sources/prompts", {"filter[own_cited]": "false", **COUNTRY, **FLAGS}),
]
ROUTES = [path for path, _ in OPTIONS]
NEW_ROUTES = ["sources/diversity", "sources/domains/g2.com", "sources/prompts"]
# What a request names that is not an option of the package: the window, the page, the sorts and
# the filters that were built before it.
OLD_PARAMETERS = {
    "from",
    "to",
    "limit",
    "offset",
    "cursor",
    "sort",
    "include_branded",
    "filter[engine_code_in]",
    "filter[prompt_id]",
    "filter[term]",
    "filter[domain_role_in]",
    "filter[registrable_domain]",
    "filter[url_id]",
}


def _case(path: str, params: dict[str, str], expected: tuple[int, str] = INVALID) -> Any:
    return pytest.param(path, params, expected, id=f"{path[:48]} {params!r}"[:140])


def _bounds() -> list[Any]:
    cases = [
        # The twelve cases of the WP-03 file.
        _case("sources/pages", {"include": "cited_with"}),
        _case("sources/changes", {"kind": "gone"}),
        _case("sources/changes", {"min_support": "0"}),
        _case("sources/changes", {"min_support": "1001"}),
        _case("sources/domains", {"filter[country_iso]": "us"}),
        _case("sources/domains", {"include": "series,cited_with,by_role_by_engine,series"}),
        _case("sources/pages", {"include": "series,series"}),
        _case("sources/diversity", {"include": "pages"}),
        _case("sources/diversity", {"include": "series,ads,series"}),
        _case("fanout-queries", {"include": "series"}),
        _case("sources/prompts", {"filter[own_cited]": "maybe"}),
        _case("sources/prompts", {"limit": "201"}),
        # A registrable domain of 254 characters.
        _case("sources/domains/" + "a" * 250 + ".com", {}),
        # The include lists.
        _case("sources/domains", {"include": "topics"}),
        _case("fanout-queries", {"include": "topics,topics"}),
        _case("sources/diversity", {"include": "series,ads,ads"}),
        # `min_support` from 1 to 1,000.
        _case("sources/domains", {"min_support": "0"}),
        _case("sources/domains", {"min_support": "1001"}),
        _case("sources/pages", {"min_support": "0"}),
        _case("sources/pages", {"min_support": "1001"}),
        _case("fanout-queries", {"min_support": "0"}),
        _case("fanout-queries", {"min_support": "1001"}),
        # The other parameters of the package.
        _case("sources/domains", {"compare": "previous_year"}),
        _case("sources/pages", {"compare": "previous_year"}),
        _case("sources/domains", {"sort": "-nothing"}),
        _case("sources/changes", {"filter[domain_role_in]": "friend"}),
        _case("sources/domains", {"filter[domain_role_in]": "own,competitor,third_party,own"}),
        _case("sources/pages", {"filter[registrable_domain]": "a" * 254}),
        _case("citations", {"filter[registrable_domain]": "a" * 254}),
        _case("sources/pages", {"filter[registrable_domain]": ""}),
        _case("citations", {"filter[url_id]": "0"}),
        # The pages: 1 to 200 rows, an offset up to 100,000, a cursor of at most 512 characters.
        *[
            _case(path, {"limit": limit})
            for path in ("sources/domains", "sources/pages", "sources/changes", "fanout-queries")
            for limit in ("0", "201")
        ],
        *[
            _case(path, {"offset": "100001"})
            for path in ("sources/domains", "sources/pages", "sources/changes", "fanout-queries")
        ],
        *[_case(path, {"limit": "0"}) for path in ("citations", "sources/prompts")],
        _case("citations", {"limit": "201"}),
        *[_case(path, {"cursor": "a" * 513}) for path in ("citations", "sources/prompts")],
    ]
    for path in ROUTES:
        cases += [
            # The country is two capital letters.
            *[_case(path, {"filter[country_iso]": value}) for value in ("us", "USA", "U1", "")],
            # The window ends after it starts and spans at most 92 days.
            _case(path, {"from": "2026-06-10", "to": "2026-06-01"}),
            _case(path, {"from": "2026-01-01", "to": "2026-06-01"}, TOO_LARGE),
        ]
    for path in ROUTES:
        if path not in ("citations", "fanout-queries"):
            cases += [
                _case(path, {"include_unresolved_redirects": "maybe"}),
                _case(path, {"include_engine_internal": "maybe"}),
            ]
    # A control character, NUL included, is refused and never reaches the database.
    for value in ("a\x00b", "a\nb", "a\x7fb"):
        cases += [
            _case("sources/pages", {"filter[registrable_domain]": value}),
            _case("citations", {"filter[registrable_domain]": value}),
        ]
    for escaped in ("a%00b", "a%0ab", "a%7fb"):
        cases.append(_case(f"sources/domains/{escaped}", {}))
    return cases


BOUNDS = _bounds()


@dataclass(frozen=True)
class Tenants:
    workspace: Workspace
    project: uuid.UUID
    billing: Caller
    viewer: Caller
    outsider: Caller

    def url(self, *parts: str) -> str:
        return project_url(self.workspace, self.project, "ai", *parts)


async def _tenants(resources: Resources, pg: PostgresServer) -> Tenants:
    """A project, a billing member and a viewer of its workspace, and a member of another one."""
    workspace = await make_workspace(pg)
    return Tenants(
        workspace,
        await ai_project(pg, workspace),
        await member(resources, pg, workspace, "billing"),
        await member(resources, pg, workspace, "viewer"),
        await member(resources, pg, await make_workspace(pg), "owner"),
    )


@pytest.mark.parametrize("path", NEW_ROUTES)
async def test_a_viewer_reads_a_new_route_with_nothing_to_count(
    path: str, api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The new routes answer `200` for a reader, empty when the project has no answer."""
    tenants = await _tenants(resources, migrated)

    response = await api.get(tenants.url(path), headers=tenants.viewer.headers)

    assert response.status_code == 200, response.text
    assert response.json()["meta"]["engine_codes"] == [
        "chatgpt_web",
        "gemini_web",
        "google_ai_mode",
    ]


@pytest.mark.parametrize(
    ("path", "params"),
    [case for path, options in OPTIONS for case in ((path, {}), (path, options))],
    ids=lambda value: value if isinstance(value, str) else ",".join(value) or "plain",
)
async def test_every_source_read_checks_access_first(
    path: str,
    params: dict[str, str],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """Billing is `403` and a member of another workspace `404` before anything is read, on every
    source route, plain and with every option."""
    tenants = await _tenants(resources, migrated)
    url = tenants.url(path)

    refused = await api.get(url, params=params, headers=tenants.billing.headers)
    hidden = await api.get(url, params=params, headers=tenants.outsider.headers)

    assert problem(refused) == FORBIDDEN
    assert problem(hidden) == NOT_FOUND


def test_the_access_cases_name_every_option_of_every_source_route() -> None:
    """A parameter added to a source route and missing from `OPTIONS` (and so from the access
    check) fails here."""
    document = build_openapi()
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai"
    for path, options in OPTIONS:
        route = path.replace("g2.com", "{registrable_domain}")
        named = {
            parameter["name"]
            for parameter in document["paths"][f"{prefix}/{route}"]["get"]["parameters"]
            if parameter["in"] == "query"
        }
        assert named - OLD_PARAMETERS <= options.keys(), (path, named - OLD_PARAMETERS)


@pytest.mark.parametrize(("path", "params", "expected"), BOUNDS)
async def test_a_parameter_out_of_bounds_is_refused(
    path: str,
    params: dict[str, str],
    expected: tuple[int, str],
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    tenants = await _tenants(resources, migrated)

    response = await api.get(tenants.url(path), params=params, headers=tenants.viewer.headers)

    assert problem(response) == expected, response.text


DOMAIN_ROW_KEYS = {
    "registrable_domain",
    "domain_role",
    "role_entity_id",
    "citation_units",
    "observations",
    "prompts",
    "engines",
    "source_share",
    "first_seen_at",
    "last_seen_at",
}
PAGE_ROW_KEYS = DOMAIN_ROW_KEYS | {"url_id", "url", "host", "title"}
META_KEYS = {
    "window",
    "include_branded",
    "engine_codes",
    "answers",
    "answers_citing",
    "citation_units",
    "by_role",
}
CITATION_KEYS = {
    "observation_id",
    "observed_at",
    "prompt_id",
    "engine_code",
    "citation_index",
    "url_id",
    "url",
    "raw_url",
    "host",
    "registrable_domain",
    "title",
    "citation_kind",
    "domain_role",
    "role_entity_id",
    "occurrences",
}
FANOUT_KEYS = {
    "query_text",
    "normalized_text",
    "engine_code",
    "observations",
    "prompts",
    "prompt_ids",
    "first_seen_at",
    "last_seen_at",
    "cited_domains",
}
FANOUT_META_KEYS = {
    "window",
    "include_branded",
    "engine_codes",
    "min_support",
    "answers",
    "answers_with_fanout",
    "answers_truncated",
    "engines_without_fanout",
}
DIVERSITY_KEYS = {
    "engine_code",
    "answers",
    "answers_citing",
    "citation_units",
    "distinct_domains",
    "effective_sources",
}
DIVERSITY_META_KEYS = {
    "window",
    "include_branded",
    "engine_codes",
    "distinct_domains",
    "effective_sources_engine_average",
}


@pytest.mark.parametrize(
    ("path", "row_keys", "meta_keys"),
    [
        ("sources/domains", DOMAIN_ROW_KEYS, META_KEYS),
        ("sources/pages", PAGE_ROW_KEYS, META_KEYS),
        ("citations", CITATION_KEYS, None),
        ("fanout-queries", FANOUT_KEYS, FANOUT_META_KEYS),
        ("sources/diversity", DIVERSITY_KEYS, DIVERSITY_META_KEYS),
    ],
)
async def test_plain_reads_keep_the_as_built_keys(
    path: str,
    row_keys: set[str],
    meta_keys: set[str] | None,
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """A request that asks for no block answers with the keys the first build had: no `series`,
    `cited_with`, `by_role_by_engine`, `topics`, `ads`, `previous`, `category` or
    `category_source`, in the rows or in `meta`."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    for days in (1, 2):
        await answer(
            migrated,
            world,
            prompt,
            days_ago=days,
            cites=[world.own_cite(), Cite(GUIDE)],
            fan_out=["soc pricing"],
        )

    response = await api.get(world.url("ai", path), headers=world.owner.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data"]
    for row in body["data"]:
        assert row.keys() == row_keys, path
    if meta_keys is not None:
        assert body["meta"].keys() == meta_keys, path


def _parameters(operation: dict[str, Any]) -> set[str]:
    return {parameter["name"] for parameter in operation["parameters"]}


def _bound(schema: dict[str, Any], keyword: str) -> Any:
    """A bound of a field, whether the field is nullable (`anyOf`) or not."""
    for candidate in schema.get("anyOf", [schema]):
        if keyword in candidate:
            return candidate[keyword]
    return None


def test_the_api_document_has_the_source_additions() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai"

    assert f"{prefix}/sources/changes" in paths
    for path in ("sources/domains", "sources/pages", "citations", "fanout-queries"):
        assert "filter[country_iso]" in _parameters(paths[f"{prefix}/{path}"]["get"]), path
    for path in ("sources/domains", "sources/pages"):
        names = _parameters(paths[f"{prefix}/{path}"]["get"])
        assert {"include", "min_support"} <= names, path
    for name in (
        "SourceWeekUnits",
        "CitedWith",
        "SourcesWeek",
        "RoleAnswers",
        "EngineRoleUnits",
        "SourceChangeRow",
        "SourceChangesMeta",
        "SourceChangePage",
    ):
        assert name in schemas, name
    optional = {
        "SourceDomainRow": ("series", "cited_with", "category", "category_source"),
        "SourcePageRow": ("series",),
        "SourcesMeta": ("series", "by_role_by_engine"),
    }
    for model, fields in optional.items():
        for field in fields:
            assert field in schemas[model]["properties"], (model, field)
            assert field not in schemas[model].get("required", []), (model, field)
    for model, field, bound in (
        ("SourceDomainRow", "series", 14),
        ("SourcePageRow", "series", 14),
        ("SourcesMeta", "series", 14),
        ("SourcesMeta", "by_role_by_engine", 3),
        ("SourceChangesMeta", "engine_codes", 3),
    ):
        assert _bound(schemas[model]["properties"][field], "maxItems") == bound, (model, field)
    for model, field, bound in (
        ("SourceDomainRow", "category", 64),
        ("SourceChangeRow", "registrable_domain", 253),
    ):
        assert _bound(schemas[model]["properties"][field], "maxLength") == bound, (model, field)
    for path, bound in (("sources/domains", 3), ("sources/pages", 1)):
        (include,) = (
            parameter
            for parameter in paths[f"{prefix}/{path}"]["get"]["parameters"]
            if parameter["name"] == "include"
        )
        # The house list parameters (`filter[engine_code_in]`) publish their bound as `maxLength`.
        assert include["schema"]["maxLength"] == bound, path


def _parameter(operation: dict[str, Any], name: str) -> dict[str, Any]:
    found: list[dict[str, Any]] = [
        parameter for parameter in operation["parameters"] if parameter["name"] == name
    ]
    assert len(found) == 1, name
    return found[0]


def test_the_api_document_has_the_new_source_routes() -> None:
    document = build_openapi()
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai"

    for path in ("sources/diversity", "sources/domains/{registrable_domain}", "sources/prompts"):
        assert f"{prefix}/{path}" in paths, path
    for name in (
        "SourceDiversity",
        "SourceDiversityEngine",
        "SourceDiversityMeta",
        "DiversityWeek",
        "AdPresence",
        "SourceDomainDetail",
        "SourceDomainDetailData",
        "DomainEngineSeries",
        "DomainEngineWeek",
        "DomainPrompt",
        "PromptOwnPagesPage",
        "PromptOwnPagesRow",
        "PromptOwnPagesMeta",
        "OwnPage",
        "FanoutTopic",
    ):
        assert name in schemas, name

    topics = schemas["FanoutQueryRow"]["properties"]["topics"]
    assert "topics" not in schemas["FanoutQueryRow"].get("required", [])
    assert _bound(topics, "maxItems") == 10
    assert schemas["SourceDiversity"]["properties"]["data"]["maxItems"] == 3
    assert _bound(schemas["SourceDiversityMeta"]["properties"]["engine_codes"], "maxItems") == 3
    assert _bound(schemas["SourceDiversityEngine"]["properties"]["series"], "maxItems") == 14
    for field, bound in (
        ("rows", 10),
        ("top_pages", 10),
        ("prompts", 20),
        ("cited_with", 5),
        ("engines", 3),
    ):
        detail = schemas["SourceDomainDetailData"]["properties"][field]
        assert detail["maxItems"] == bound, field

    diversity = paths[f"{prefix}/sources/diversity"]["get"]
    fanout = paths[f"{prefix}/fanout-queries"]["get"]
    assert _parameter(diversity, "include")["schema"]["maxLength"] == 2
    assert _parameter(fanout, "include")["schema"]["maxLength"] == 1
    prompts = paths[f"{prefix}/sources/prompts"]["get"]
    assert "filter[own_cited]" in _parameters(prompts)
    # The rows have no array bound: the keyset page's `limit` is what bounds them.
    assert _parameter(prompts, "limit")["schema"]["maximum"] == 200
    for path in (
        "sources/domains",
        "sources/pages",
        "sources/changes",
        "sources/diversity",
        "sources/domains/{registrable_domain}",
        "sources/prompts",
    ):
        operation = paths[f"{prefix}/{path}"]["get"]
        for name in ("include_unresolved_redirects", "include_engine_internal"):
            assert _parameter(operation, name)["schema"]["default"] is False, (path, name)


def _described(document: dict[str, Any], node: Any, seen: set[str]) -> list[tuple[str, str, str]]:
    """The `(model, field, description)` of every field under a schema node, following the
    references and reading each model once."""
    if isinstance(node, list):
        return [found for item in node for found in _described(document, item, seen)]
    if not isinstance(node, dict):
        return []
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        if name in seen:
            return []
        seen.add(name)
        schema = document["components"]["schemas"][name]
        own = [
            (name, field, prop["description"])
            for field, prop in schema.get("properties", {}).items()
            if "description" in prop
        ]
        return own + _described(document, schema, seen)
    return [found for value in node.values() for found in _described(document, value, seen)]


def test_only_what_the_code_does_not_return_is_described_as_not_built() -> None:
    """Every addition is built, so no description of a parameter, an operation or a field of a
    source read says `Not built yet` or `Not returned yet`, except the two fields WP-60 will
    return (`category` and `category_source`), which must still say so."""
    document = build_openapi()
    prefix = "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai"
    seen: set[str] = set()
    hits: list[tuple[str, str]] = []
    for path in [route.replace("g2.com", "{registrable_domain}") for route in ROUTES]:
        operation = document["paths"][f"{prefix}/{path}"]["get"]
        texts = [(path, "operation", operation.get("description", ""))]
        texts += [(path, p["name"], p.get("description", "")) for p in operation["parameters"]]
        schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
        texts += _described(document, schema, seen)
        hits += [
            (owner, field)
            for owner, field, text in texts
            if "Not built yet" in text or "Not returned yet" in text
        ]

    assert sorted(hits) == [("SourceDomainRow", "category"), ("SourceDomainRow", "category_source")]


# What the small and the full project cite: the domain the detail route reads in each.
SMALL_DOMAIN, FULL_DOMAIN = "example.org", "site0.net"
STATEMENTS: list[tuple[str, dict[str, str]]] = [
    ("sources/domains", {}),
    ("sources/domains", {"include": "series"}),
    ("sources/domains", {"include": "cited_with"}),
    ("sources/domains", {"include": "by_role_by_engine"}),
    ("sources/domains", {"compare": "previous_period"}),
    ("sources/domains", {**OPTIONS[0][1]}),
    ("sources/domains", {"filter[domain_role_in]": "third_party", "min_support": "1"}),
    ("sources/pages", {}),
    ("sources/pages", {"include": "series"}),
    ("sources/pages", {**OPTIONS[1][1]}),
    ("sources/changes", {"kind": "new", "min_support": "1"}),
    ("sources/changes", {"kind": "lost", "min_support": "1"}),
    ("sources/changes", {"kind": "new", "min_support": "1", **COUNTRY, **FLAGS}),
    ("citations", {}),
    ("citations", {**COUNTRY}),
    ("fanout-queries", {"min_support": "1"}),
    ("fanout-queries", {"include": "topics", "min_support": "1"}),
    ("fanout-queries", {"include": "topics", "min_support": "1", **COUNTRY}),
    ("sources/diversity", {}),
    ("sources/diversity", {"include": "series"}),
    ("sources/diversity", {"include": "ads"}),
    ("sources/diversity", {"include": "series,ads", **COUNTRY, **FLAGS}),
    ("sources/domains/{domain}", {}),
    ("sources/domains/{domain}", {**COUNTRY, **FLAGS}),
    ("sources/prompts", {}),
    ("sources/prompts", {"filter[own_cited]": "false"}),
    ("sources/prompts", {"filter[own_cited]": "true", **COUNTRY, **FLAGS}),
]


async def _every_answer_names_the_rival(pg: PostgresServer, world: World) -> None:
    await execute(
        pg,
        "INSERT INTO ai.entity_mentions (observation_id, observed_at, entity_id, derivation_id, "
        "workspace_id, project_id, engine_code, role, mention_count, first_char_offset, "
        "mention_order, prominence, match_method, confidence, evidence_spans, mention_status, "
        "is_current) SELECT o.id, o.observed_at, $2, $3, o.workspace_id, o.project_id, "
        "o.engine_code, 'competitor', 1, 0, 1, 1, 'alias_word', 1, "
        "ARRAY['[0,8)'::int4range], 'accepted', true FROM ai.observations o "
        "WHERE o.project_id = $1",
        world.project.id,
        world.rival,
        world.derivation_id,
    )


async def _every_prompt_is_a_topic(pg: PostgresServer, world: World) -> None:
    term = await topic_of(pg, world, "Everything")
    await execute(
        pg,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) "
        "SELECT id, $2, workspace_id FROM ai.prompts WHERE project_id = $1",
        world.project.id,
        term,
    )


async def _small_world(resources: Resources, pg: PostgresServer) -> World:
    """A few answers that give every block something to read: own, rival and third party
    citations, a flagged one, one query issued, a topic and a rival named in each answer, on two
    engines. A source lost needs answers 60 days back, where the test partitions end: the lost
    read is empty here, and `test_sources_changes.py` counts its statements over lost rows."""
    world = await make_world(resources, pg)
    first = await add_prompt(pg, world.project, "Best managed SOC providers?")
    second = await add_prompt(pg, world.project, "How much does a managed SOC cost?")
    await tag(pg, world, first, await topic_of(pg, world, "Pricing"))
    newest = await answer(
        pg,
        world,
        first,
        days_ago=1,
        cites=[world.own_cite(), Cite(GUIDE), Cite(WIKI)],
        fan_out=["soc pricing"],
    )
    await answer(
        pg,
        world,
        second,
        days_ago=2,
        cites=[world.rival_cite(), Cite(GUIDE)],
        fan_out=["soc pricing"],
    )
    await answer(pg, world, second, days_ago=3, engine="gemini_web", cites=[Cite(GUIDE_TOP)])
    await execute(
        pg,
        "UPDATE ai.citations SET flags = $2 WHERE observation_id = $1 AND citation_index = 3",
        newest,
        ["unresolved_redirect"],
    )
    await _every_answer_names_the_rival(pg, world)
    await _every_prompt_is_a_topic(pg, world)
    return world


async def test_the_whole_package_is_a_fixed_number_of_statements(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """Every source read, plain and with each of its blocks, sends the statements of a small
    project when it reads a full one (150 prompts, 3,600 answers, 36,000 citations, the rival
    named in each answer and a topic on each prompt): a query per row, anywhere, would show.
    The full project is built once, so the table is walked in one test."""
    small = await _small_world(resources, migrated)
    full = await full_project(resources, migrated, fan_out=True)
    await _every_answer_names_the_rival(migrated, full)
    await _every_prompt_is_a_topic(migrated, full)

    async def read(world: World, domain: str, path: str, params: dict[str, str]) -> list[str]:
        with statements(resources) as seen:
            response = await api.get(
                world.url("ai", path.format(domain=domain)),
                params=params,
                headers=world.owner.headers,
            )
        assert response.status_code == 200, (path, params, response.text)
        return seen

    # The first read on a connection of the pool sends the driver's own set-up statements.
    await read(full, FULL_DOMAIN, *STATEMENTS[0])
    differing: dict[str, tuple[int, int]] = {}
    for path, params in STATEMENTS:
        await read(small, SMALL_DOMAIN, path, params)
        few = await read(small, SMALL_DOMAIN, path, params)
        many = await read(full, FULL_DOMAIN, path, params)
        if len(many) != len(few):
            differing[f"{path} {params}"] = (len(few), len(many))

    assert not differing, differing
