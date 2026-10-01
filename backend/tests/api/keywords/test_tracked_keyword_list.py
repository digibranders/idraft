"""The tracked keyword list: filters, sorts, include blocks and pages (plan decision D15)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from sightline.api.keywords import filters
from sightline.api.pagination import encode_cursor
from sightline.api.resources import Resources
from sightline.api.schemas.keywords import TrackedKeywordFilter
from tests.api.auth.support import Workspace, execute, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import (
    OTHER_LOCATION,
    errors,
    group,
    keyword_project,
    project_url,
    set_metrics,
    term,
    tracked_id,
    vocabulary,
)
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _list(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    **params: Any,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project, "tracked-keywords"), params=params, headers=caller.headers
    )


def _texts(response: httpx.Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [row["keyword"]["text"] for row in response.json()["data"]]


async def test_the_list_is_active_keywords_by_text_with_a_total(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    for text in ("erp", "crm", "hr software"):
        await tracked_id(api, workspace, project, owner, text)
    archived = await tracked_id(api, workspace, project, owner, "archived")
    await api.patch(
        project_url(workspace, project, "tracked-keywords", archived),
        json={"is_active": False},
        headers=owner.headers,
    )
    deleted = await tracked_id(api, workspace, project, owner, "deleted")
    await api.delete(
        project_url(workspace, project, "tracked-keywords", deleted), headers=owner.headers
    )

    first = await _list(api, workspace, project, owner, limit=2)
    second = await _list(
        api, workspace, project, owner, limit=2, cursor=first.json()["page"]["next_cursor"]
    )
    inactive = await _list(api, workspace, project, owner, **{"filter[is_active]": "false"})

    assert _texts(first) == ["crm", "erp"]
    assert first.json()["page"]["total"] == 3
    assert first.json()["page"]["has_more"] is True
    assert _texts(second) == ["hr software"]
    assert second.json()["page"] == {"limit": 2, "next_cursor": None, "has_more": False, "total": 3}
    assert _texts(inactive) == ["archived"]
    row = first.json()["data"][0]
    assert (row["metrics"], row["groups"], row["terms"], row["competitors"]) == (
        None,
        None,
        None,
        None,
    )


async def test_each_filter_keeps_the_matching_keywords(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(
        api,
        workspace,
        project,
        owner,
        "crm software",
        device="mobile",
        intent="commercial",
        funnel_stage="bofu",
        priority=1,
        depth_profile="deep",
    )
    await tracked_id(
        api, workspace, project, owner, "erp", location_id=OTHER_LOCATION, language_code="de"
    )
    await tracked_id(api, workspace, project, owner, "hr", priority=4)
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET source = 'csv_import' WHERE id = $1",
        uuid.UUID(crm),
    )
    await set_metrics(migrated, workspace, crm, search_volume=1900, keyword_difficulty=40)

    cases: list[tuple[dict[str, Any], list[str]]] = [
        ({"filter[q]": "SOFT"}, ["crm software"]),
        ({"filter[device]": "mobile"}, ["crm software"]),
        ({"filter[location_id]": OTHER_LOCATION}, ["erp"]),
        ({"filter[language_code]": "de"}, ["erp"]),
        ({"filter[search_engine]": "google"}, ["crm software", "erp", "hr"]),
        ({"filter[intent_in]": ["commercial", "local"]}, ["crm software"]),
        ({"filter[funnel_stage_in]": "unknown"}, ["erp", "hr"]),
        ({"filter[priority_lte]": 3}, ["crm software", "erp"]),
        ({"filter[source_in]": "csv_import"}, ["crm software"]),
        ({"filter[depth_profile_in]": ["standard"]}, ["erp", "hr"]),
        ({"filter[search_volume_gte]": 1000}, ["crm software"]),
        ({"filter[keyword_difficulty_lte]": 30}, []),
    ]
    for params, expected in cases:
        response = await _list(api, workspace, project, owner, **params)
        assert _texts(response) == expected, params
        assert response.json()["page"]["total"] == len(expected), params


async def test_group_and_term_filters_include_what_is_under_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    parent = await group(migrated, workspace, project, "Product")
    child = await group(migrated, workspace, project, "Pricing", parent=parent)
    topics = await vocabulary(migrated, workspace)
    stages = await vocabulary(migrated, workspace)
    software = await term(migrated, workspace, topics, "software")
    crm_term = await term(migrated, workspace, topics, "crm", parent=software)
    hardware = await term(migrated, workspace, topics, "hardware")
    buying = await term(migrated, workspace, stages, "buying")
    await tracked_id(
        api, workspace, project, owner, "crm", group_ids=[child], term_ids=[crm_term, buying]
    )
    await tracked_id(api, workspace, project, owner, "erp", group_ids=[parent], term_ids=[software])
    await tracked_id(api, workspace, project, owner, "laptop", term_ids=[hardware, buying])

    by_group = await _list(api, workspace, project, owner, **{"filter[group]": parent})
    by_child = await _list(api, workspace, project, owner, **{"filter[group]": child})
    # Under software, and buying: two vocabularies, so both must match.
    both = await _list(api, workspace, project, owner, **{"filter[term]": [software, buying]})
    # Two terms of one vocabulary: either.
    either = await _list(api, workspace, project, owner, **{"filter[term]": [crm_term, hardware]})
    any_of = await _list(api, workspace, project, owner, **{"filter[term_in]": [software, buying]})

    assert _texts(by_group) == ["crm", "erp"]
    assert _texts(by_child) == ["crm"]
    assert _texts(both) == ["crm"]
    assert _texts(either) == ["crm", "laptop"]
    assert _texts(any_of) == ["crm", "erp", "laptop"]


async def test_a_metric_sort_puts_keywords_without_one_last_both_ways(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    volumes = {"a": 300, "b": None, "c": 100, "d": 300, "e": None}
    for text, volume in volumes.items():
        created = await tracked_id(api, workspace, project, owner, text)
        if volume is not None:
            await set_metrics(migrated, workspace, created, search_volume=volume)

    ascending = await _list(api, workspace, project, owner, sort="search_volume,keyword")
    descending = await _list(api, workspace, project, owner, sort="-search_volume,keyword")

    assert _texts(ascending) == ["c", "a", "d", "b", "e"]
    assert _texts(descending) == ["a", "d", "c", "b", "e"]


@pytest.mark.parametrize(
    "sort",
    [
        "keyword",
        "-keyword",
        "search_volume",
        "-search_volume",
        "keyword_difficulty",
        "-cpc_usd",
        "priority",
        "-priority,keyword",
        "created_at",
        "-created_at",
    ],
)
async def test_every_sort_pages_through_every_keyword_once(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    expected = set()
    for index, text in enumerate(("delta", "alpha", "echo", "bravo", "charlie")):
        created = await tracked_id(api, workspace, project, owner, text, priority=1 + index % 2)
        expected.add(text)
        if index % 2 == 0:
            await set_metrics(
                migrated,
                workspace,
                created,
                search_volume=100 * (index % 3),
                keyword_difficulty=10,
                # Distinct values with fractions, so a cursor carries a decimal it must keep.
                cpc_usd=f"{index}.2575",
            )
    whole = _texts(await _list(api, workspace, project, owner, sort=sort))

    seen: list[str] = []
    cursor = None
    while True:
        params: dict[str, Any] = {"sort": sort, "limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = await _list(api, workspace, project, owner, **params)
        seen.extend(_texts(response))
        cursor = response.json()["page"]["next_cursor"]
        if cursor is None:
            break

    assert seen == whole
    assert set(seen) == expected


async def test_include_fills_the_blocks_asked_for(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    pricing = await group(migrated, workspace, project, "Pricing")
    topic = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    created = await tracked_id(
        api, workspace, project, owner, "crm", group_ids=[pricing], term_ids=[topic]
    )
    await set_metrics(migrated, workspace, created, search_volume=1900)

    response = await _list(
        api, workspace, project, owner, include=["metrics", "groups", "terms", "competitors"]
    )
    partial = await _list(api, workspace, project, owner, include="groups")
    comma = await _list(api, workspace, project, owner, include="terms,metrics")

    (row,) = response.json()["data"]
    assert row["metrics"]["search_volume"]["value"] == 1900
    assert [g["group_id"] for g in row["groups"]] == [pricing]
    assert [t["term_id"] for t in row["terms"]] == [topic]
    assert row["competitors"] == []
    (only,) = partial.json()["data"]
    assert (only["metrics"], only["terms"]) == (None, None)
    assert [g["name"] for g in only["groups"]] == ["Pricing"]
    (both,) = comma.json()["data"]
    assert (both["groups"], [t["term_id"] for t in both["terms"]]) == (None, [topic])
    assert both["metrics"]["search_volume"]["value"] == 1900


async def test_a_cursor_is_bound_to_its_filters_and_sort(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    for text in ("a", "b", "c"):
        await tracked_id(api, workspace, project, owner, text)
    first = await _list(api, workspace, project, owner, limit=1)
    cursor = first.json()["page"]["next_cursor"]

    other_sort = await _list(
        api, workspace, project, owner, limit=1, cursor=cursor, sort="-keyword"
    )
    other_filter = await _list(
        api, workspace, project, owner, limit=1, cursor=cursor, **{"filter[device]": "desktop"}
    )

    assert problem(other_sort) == (400, "invalid_cursor")
    assert problem(other_filter) == (400, "invalid_cursor")


@pytest.mark.parametrize("sort", ["rank", "keyword,keyword", "-", "keyword,,priority"])
async def test_an_unknown_or_repeated_sort_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, sort: str
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await _list(api, workspace, project, owner, sort=sort)

    assert response.status_code == 422
    assert errors(response) == [("sort", "invalid_sort")]


async def test_list_filters_take_comma_lists_and_odd_values_match_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    crm_term = await term(migrated, workspace, topics, "crm")
    await tracked_id(
        api, workspace, project, owner, "crm", intent="commercial", term_ids=[crm_term]
    )
    await tracked_id(api, workspace, project, owner, "erp", intent="local")
    await tracked_id(api, workspace, project, owner, "hr")

    commas = await _list(
        api, workspace, project, owner, **{"filter[intent_in]": "commercial,local"}
    )
    unknown = await _list(
        api, workspace, project, owner, **{"filter[term]": [crm_term, str(uuid.uuid4())]}
    )
    blank = await _list(api, workspace, project, owner, **{"filter[q]": "   "})
    too_many = await _list(
        api,
        workspace,
        project,
        owner,
        **{"filter[term_in]": ",".join(str(uuid.uuid4()) for _ in range(101))},
    )

    assert _texts(commas) == ["crm", "erp"]
    assert _texts(unknown) == []
    assert _texts(blank) == []
    assert too_many.status_code == 422
    assert errors(too_many) == [("filter[term_in]", "too_long")]


async def test_a_cursor_with_values_beyond_the_columns_types_is_read_safely(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    await set_metrics(migrated, workspace, created, search_volume=10, keyword_difficulty=10)
    scope = {
        "sort": ["keyword_difficulty"],
        **filters.scope(TrackedKeywordFilter(is_active=True), project),
    }
    # Past what a smallint or a 4-digit numeric holds.
    cursor = encode_cursor([0, 2**40, str(uuid.uuid4())], scope=scope)
    decimal = encode_cursor([0, "1e40", str(uuid.uuid4())], scope={**scope, "sort": ["cpc_usd"]})

    response = await _list(api, workspace, project, owner, sort="keyword_difficulty", cursor=cursor)
    by_cpc = await _list(api, workspace, project, owner, sort="cpc_usd", cursor=decimal)

    assert (response.status_code, by_cpc.status_code) == (200, 200)
    assert _texts(response) == []


async def test_a_cursor_is_bound_to_its_project(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    for text in ("a", "b"):
        await tracked_id(api, workspace, project, owner, text)
        await tracked_id(api, workspace, other, owner, text)
    first = await _list(api, workspace, project, owner, limit=1)

    elsewhere = await _list(
        api, workspace, other, owner, limit=1, cursor=first.json()["page"]["next_cursor"]
    )

    assert problem(elsewhere) == (400, "invalid_cursor")
