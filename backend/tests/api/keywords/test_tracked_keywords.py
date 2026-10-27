"""Tracked keywords (docs/19 section 3.6.1; plan decisions D3, D4, D5)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.keywords import repository
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import (
    LOCATION,
    OTHER_LOCATION,
    errors,
    keyword_project,
    project_url,
    track,
    tracked_id,
)
from tests.conftest import PostgresServer


async def _entity(api: httpx.AsyncClient, workspace: Workspace, caller: Caller, name: str) -> str:
    response = await api.post(
        f"/api/v1/workspaces/{workspace.id}/entities",
        json={"entity_type": "brand", "canonical_name": name},
        headers=caller.headers,
    )
    assert response.status_code == 201, response.text
    entity_id: str = response.json()["data"]["entity_id"]
    return entity_id


async def _give(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    entity_id: str,
    role: str = "competitor",
) -> None:
    response = await api.post(
        project_url(workspace, project_id, "entities"),
        json={"entity_id": entity_id, "role": role},
        headers=caller.headers,
    )
    assert response.status_code == 201, response.text


async def _group(pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, name: str) -> str:
    row = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_groups (workspace_id, project_id, name, path) "
        "VALUES ($1, $2, $3, $3) RETURNING id",
        workspace.id,
        project_id,
        name,
    )
    return str(row["id"])


async def _vocabulary(
    pg: PostgresServer,
    workspace: Workspace,
    *,
    project_id: uuid.UUID | None = None,
    single: bool = False,
    terms: tuple[str, ...] = ("crm",),
) -> list[str]:
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name, "
        "is_single_valued) VALUES ($1, $2, 'topic', $3, $4) RETURNING id",
        workspace.id,
        project_id,
        f"Topics {uuid.uuid4().hex[:6]}",
        single,
    )
    found = []
    for slug in terms:
        term = await fetchrow(
            pg,
            "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            workspace.id,
            vocabulary["id"],
            slug,
            slug,
            slug,
        )
        found.append(str(term["id"]))
    return found


async def _schedule(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, workload: str = "seo_rank"
) -> str:
    row = await fetchrow(
        pg,
        "INSERT INTO ops.schedules (workspace_id, project_id, workload, name, cadence, timezone, "
        "next_run_at) VALUES ($1, $2, $3, 'Ranks', 'daily', 'UTC', now()) RETURNING id",
        workspace.id,
        project_id,
        workload,
    )
    return str(row["id"])


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _audit(pg: PostgresServer, workspace: Workspace) -> list[str]:
    rows = await fetch(
        pg,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action LIKE 'tracked_keyword.%' ORDER BY id",
        workspace.id,
    )
    return [row["action"] for row in rows]


# Create.


async def test_a_keyword_is_tracked_with_the_projects_defaults(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await track(api, workspace, project, owner, "  CRM   Software ")

    assert response.status_code == 201, response.text
    (row,) = response.json()["data"]
    assert row["keyword"]["text"] == "CRM Software"
    assert row["keyword"]["normalized_text"] == "crm software"
    assert (row["location_id"], row["location"]["name"], row["language_code"]) == (
        LOCATION,
        "United States",
        "en",
    )
    assert (row["device"], row["search_engine"], row["os"]) == ("desktop", "google", None)
    assert (row["depth_profile"], row["frequency"], row["config_version"]) == (
        "standard",
        "daily",
        1,
    )
    assert (row["intent"], row["intent_source"], row["funnel_stage"], row["priority"]) == (
        "unknown",
        None,
        "unknown",
        3,
    )
    assert (row["source"], row["is_active"], row["target_url"], row["business_value"]) == (
        "manual",
        True,
        None,
        None,
    )
    assert row["created_by"]["user_id"] == str(owner.user_id)
    assert await _audit(migrated, workspace) == ["tracked_keyword.created"]


async def test_both_devices_and_the_projects_settings(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "UPDATE core.projects SET settings = $1 WHERE id = $2",
        json.dumps(
            {
                "version": 1,
                "seo": {
                    "default_device": "both",
                    "default_depth_profile": "deep",
                    "default_frequency": "weekly",
                },
            }
        ),
        project,
    )

    response = await track(api, workspace, project, owner, "crm")

    rows = response.json()["data"]
    assert [(r["device"], r["depth_profile"], r["frequency"]) for r in rows] == [
        ("desktop", "deep", "weekly"),
        ("mobile", "deep", "weekly"),
    ]
    assert await _audit(migrated, workspace) == ["tracked_keyword.created"] * 2


async def test_given_fields_are_stored(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    schedule = await _schedule(migrated, workspace, project)

    response = await track(
        api,
        workspace,
        project,
        owner,
        "crm pricing",
        location_id=OTHER_LOCATION,
        language_code="de",
        device="mobile",
        os="ios",
        depth_profile="deep",
        target_url="HTTPS://Acme.io/Pricing/?utm_source=x&b=2",
        intent="commercial",
        funnel_stage="bofu",
        priority=1,
        business_value="12.50",
        frequency="weekly",
        schedule_id=schedule,
    )

    assert response.status_code == 201, response.text
    (row,) = response.json()["data"]
    assert (row["location_id"], row["language_code"], row["device"], row["os"]) == (
        OTHER_LOCATION,
        "de",
        "mobile",
        "ios",
    )
    assert row["target_url"]["canonical_url"] == "https://acme.io/Pricing?b=2"
    assert (row["target_url"]["host"], row["target_url"]["path"]) == ("acme.io", "/Pricing")
    assert (row["intent"], row["intent_source"]) == ("commercial", "manual")
    assert (row["priority"], row["business_value"], row["schedule_id"]) == (1, "12.50", schedule)
    history = await fetch(
        migrated,
        "SELECT depth_profile, target_url_id FROM seo.tracked_keyword_config_history "
        "WHERE tracked_keyword_id = $1",
        uuid.UUID(row["tracked_keyword_id"]),
    )
    assert history[0]["depth_profile"] == "deep"
    assert str(history[0]["target_url_id"]) == row["target_url"]["url_id"]


@pytest.mark.parametrize(
    ("keyword", "code"),
    [
        ("site:acme.io crm", "search_operator_not_allowed"),
        ("x" * 701, "keyword_too_long"),
        ("crm\N{NULL}", "keyword_invalid"),
        ("\N{ZERO WIDTH SPACE}", "keyword_missing"),
    ],
)
async def test_a_keyword_that_cannot_be_tracked_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    keyword: str,
    code: str,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    response = await track(api, workspace, project, owner, keyword)
    assert response.status_code == 422
    assert errors(response) == [("keyword", code)]


@pytest.mark.parametrize(
    ("body", "accepted"),
    [
        ({"device": "desktop", "os": "ios"}, False),
        ({"device": "mobile", "os": "windows"}, False),
        ({"device": "both", "os": "ios"}, False),
        ({"os": "ios"}, False),
        ({"device": "mobile", "os": "ios"}, True),
        ({"device": "desktop", "os": "macos"}, True),
    ],
)
async def test_an_operating_system_must_run_on_the_keywords_device(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    body: dict[str, Any],
    accepted: bool,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await track(api, workspace, project, owner, "crm", **body)

    if accepted:
        assert response.status_code == 201
    else:
        assert response.status_code == 422
        assert errors(response) == [("os", "os_device_mismatch")]


async def test_a_depth_profile_that_is_not_offered_yet_is_refused_by_name(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)

    response = await track(
        api, workspace, project, owner, "crm", depth_profile="until_own_match_100"
    )

    assert response.status_code == 422
    assert errors(response) == [("depth_profile", "depth_profile_not_available")]
    # The others are accepted.
    ok = await track(api, workspace, project, owner, "crm", depth_profile="weekly_light")
    assert ok.status_code == 201


async def test_references_are_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    foreign_schedule = await _schedule(migrated, workspace, other)
    metrics_schedule = await _schedule(migrated, workspace, project, "keyword_metrics")
    foreign_group = await _group(migrated, workspace, other, "Elsewhere")
    (foreign_term,) = await _vocabulary(migrated, workspace, project_id=other)
    stranger = await _entity(api, workspace, owner, "Stranger")
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type, "
        "is_active) VALUES (2276, 'Germany', 'DE', 'Country', false) "
        "ON CONFLICT (id) DO UPDATE SET is_active = false",
    )

    cases: list[tuple[dict[str, Any], tuple[str, str]]] = [
        ({"location_id": 2276}, ("location_id", "location_unknown")),
        ({"target_url": "ftp://acme.io/x"}, ("target_url", "invalid_url")),
        ({"schedule_id": foreign_schedule}, ("schedule_id", "schedule_unknown")),
        ({"schedule_id": metrics_schedule}, ("schedule_id", "schedule_unknown")),
        ({"group_ids": [foreign_group]}, ("group_ids", "group_unknown")),
        ({"term_ids": [foreign_term]}, ("term_ids", "term_unknown")),
        (
            {"competitor_overrides": {"include": [stranger]}},
            ("competitor_overrides", "entity_not_in_project"),
        ),
    ]
    for body, expected in cases:
        response = await track(api, workspace, project, owner, "crm", **body)
        assert response.status_code == 422, body
        assert errors(response) == [expected], body
    assert await _audit(migrated, workspace) == []


async def test_a_project_without_a_location_or_language_needs_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "UPDATE core.projects SET default_location_id = NULL, default_language_code = NULL "
        "WHERE id = $1",
        project,
    )

    response = await track(api, workspace, project, owner, "crm")

    assert response.status_code == 422
    assert errors(response) == [
        ("location_id", "location_required"),
        ("language_code", "language_required"),
    ]


async def test_one_term_per_single_valued_vocabulary(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    first, second = await _vocabulary(migrated, workspace, single=True, terms=("a", "b"))

    response = await track(api, workspace, project, owner, "crm", term_ids=[first, second])

    assert response.status_code == 422
    assert errors(response) == [("term_ids", "single_valued_vocabulary")]


async def test_a_tracked_identity_is_a_duplicate_and_a_deleted_one_comes_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    live = await tracked_id(api, workspace, project, owner, "crm", priority=1)

    again = await track(api, workspace, project, owner, "CRM", device="both")
    assert problem(again) == (409, "duplicate")
    assert again.json()["existing_id"] == live
    # Nothing was written for the mobile half either.
    rows = await fetch(
        migrated, "SELECT count(*) AS n FROM seo.tracked_keywords WHERE project_id = $1", project
    )
    assert rows[0]["n"] == 1

    deleted = await api.delete(
        project_url(workspace, project, "tracked-keywords", live), headers=owner.headers
    )
    assert deleted.status_code == 204
    back = await track(api, workspace, project, owner, "crm", priority=5)
    assert back.status_code == 201
    (row,) = back.json()["data"]
    # The same row, with its stored settings (plan decision D3).
    assert (row["tracked_keyword_id"], row["priority"]) == (live, 1)


async def test_the_quota_refuses_with_its_numbers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 1)",
        workspace.id,
    )
    await tracked_id(api, workspace, project, owner, "crm")

    response = await track(api, workspace, project, owner, "erp", device="both")

    assert problem(response) == (422, "quota_exceeded")
    body = response.json()
    assert (body["limit"], body["used"], body["requested"]) == (1, 1, 2)


async def test_groups_terms_and_competitor_overrides_are_attached(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    group = await _group(migrated, workspace, project, "Pricing")
    (term,) = await _vocabulary(migrated, workspace)
    rival = await _entity(api, workspace, owner, "Rival")
    await _give(api, workspace, project, owner, rival)

    created = await tracked_id(
        api,
        workspace,
        project,
        owner,
        "crm",
        group_ids=[group],
        term_ids=[term],
        competitor_overrides={"exclude": [rival]},
    )
    detail = await api.get(
        project_url(workspace, project, "tracked-keywords", created), headers=owner.headers
    )

    data = detail.json()["data"]
    assert [g["group_id"] for g in data["groups"]] == [group]
    assert [(t["term_id"], t["vocabulary_kind"]) for t in data["terms"]] == [(term, "topic")]
    assert [(c["entity"]["entity_id"], c["mode"]) for c in data["competitor_overrides"]] == [
        (rival, "exclude")
    ]
    assert (data["config_history_count"], data["metrics"], data["schedule"]) == (1, None, None)


# Bulk create.


async def test_bulk_create_reports_created_skipped_and_rejected_items(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    existing = await tracked_id(api, workspace, project, owner, "crm")
    (term,) = await _vocabulary(migrated, workspace)

    response = await api.post(
        project_url(workspace, project, "tracked-keywords", "bulk-create"),
        json={
            "items": [
                {"keyword": "erp", "device": "both"},
                {"keyword": "CRM", "term_ids": [term]},
                {"keyword": "site:acme.io"},
                {"keyword": "hr", "location_id": 999999},
            ],
            "on_duplicate": "merge_terms",
        },
        headers=owner.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["created"]) == 2
    assert data["skipped"] == [{"index": 1, "existing_id": existing}]
    assert [(r["index"], r["code"]) for r in data["rejected"]] == [
        (2, "search_operator_not_allowed"),
        (3, "location_unknown"),
    ]
    # merge_terms gave the existing keyword the item's term.
    terms = await fetch(
        migrated,
        "SELECT term_id FROM seo.tracked_keyword_terms WHERE tracked_keyword_id = $1",
        uuid.UUID(existing),
    )
    assert [str(row["term_id"]) for row in terms] == [term]


async def test_bulk_create_over_the_quota_writes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 2)",
        workspace.id,
    )

    response = await api.post(
        project_url(workspace, project, "tracked-keywords", "bulk-create"),
        json={"items": [{"keyword": k} for k in ("a", "b", "c")]},
        headers=owner.headers,
    )

    assert problem(response) == (422, "quota_exceeded")
    rows = await fetch(
        migrated, "SELECT count(*) AS n FROM seo.keywords WHERE workspace_id = $1", workspace.id
    )
    assert rows[0]["n"] == 0


# Read, change, delete.


async def test_the_detail_carries_current_metrics(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    keyword = await fetchrow(
        migrated, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(created)
    )
    monthly = [{"year": 2025, "month": m, "search_volume": 100} for m in range(9, 13)] + [
        {"year": 2026, "month": m, "search_volume": 100} for m in range(1, 9)
    ]
    snapshot = await fetchrow(
        migrated,
        "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
        "language_code, source, fetched_at, data_month, search_volume, monthly_searches, "
        "cpc_usd, competition, competition_level, keyword_difficulty, intent_main, "
        "is_material_change) VALUES ($1, $2, $3, 'en', 'dataforseo_labs', "
        "'2026-09-20T03:00:00Z', '2026-08-01', 1900, $4, 14.23, 0.67, 'HIGH', 58, "
        "'commercial', true) RETURNING id",
        workspace.id,
        keyword["keyword_id"],
        LOCATION,
        json.dumps(monthly),
    )
    await execute(
        migrated,
        "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
        "source, workspace_id, snapshot_id, search_volume, cpc_usd, keyword_difficulty, "
        "intent_main, fetched_at) VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, 1900, 14.23, "
        "58, 'commercial', '2026-09-20T03:00:00Z')",
        keyword["keyword_id"],
        LOCATION,
        workspace.id,
        snapshot["id"],
    )

    response = await api.get(
        project_url(workspace, project, "tracked-keywords", created), headers=owner.headers
    )

    metrics = response.json()["data"]["metrics"]
    assert metrics["search_volume"]["metric"] == "seo.search_volume"
    assert (metrics["search_volume"]["value"], metrics["search_volume"]["unit"]) == (1900, "count")
    assert metrics["search_volume"]["is_estimate"] is True
    assert metrics["search_volume"]["window"] == {
        "from": "2025-09-01",
        "to": "2026-08-31",
        "timezone": "UTC",
    }
    assert (metrics["cpc_usd"], metrics["competition"], metrics["competition_level"]) == (
        "14.2300",
        0.67,
        "HIGH",
    )
    assert (metrics["keyword_difficulty"], metrics["intent_main"], metrics["data_month"]) == (
        58,
        "commercial",
        "2026-08-01",
    )
    assert (metrics["trend_pct_per_month"], metrics["is_seasonal"]) == (0.0, False)


async def test_a_change_to_depth_or_target_url_makes_a_new_config_version(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    url = project_url(workspace, project, "tracked-keywords", created)

    priority = await api.patch(url, json={"priority": 1}, headers=owner.headers)
    deeper = await api.patch(
        url,
        json={"depth_profile": "deep", "change_reason": "Track page two"},
        headers=owner.headers,
    )
    same = await api.patch(url, json={"depth_profile": "deep"}, headers=owner.headers)
    pointed = await api.patch(
        url, json={"target_url": "https://acme.io/crm"}, headers=owner.headers
    )
    cleared = await api.patch(url, json={"target_url": None}, headers=owner.headers)
    history = await api.get(f"{url}/config-history", headers=owner.headers)

    assert priority.json()["data"]["config_version"] == 1
    assert deeper.json()["data"]["config_version"] == 2
    assert same.json()["data"]["config_version"] == 2
    assert pointed.json()["data"]["target_url"]["canonical_url"] == "https://acme.io/crm"
    assert cleared.json()["data"]["target_url"] is None
    versions = history.json()["data"]
    assert [(v["config_version"], v["depth_profile"]) for v in versions] == [
        (1, "standard"),
        (2, "deep"),
        (3, "deep"),
        (4, "deep"),
    ]
    assert versions[1]["change_reason"] == "Track page two"
    assert versions[1]["changed_by"]["user_id"] == str(owner.user_id)
    assert [v["valid_to"] is None for v in versions] == [False, False, False, True]
    assert versions[2]["target_url"]["canonical_url"] == "https://acme.io/crm"
    assert await _audit(migrated, workspace) == [
        "tracked_keyword.created",
        "tracked_keyword.updated",
        "tracked_keyword.updated",
        "tracked_keyword.updated",
        "tracked_keyword.updated",
    ]


@pytest.mark.parametrize("field", ["keyword", "location_id", "language_code", "device", "os"])
async def test_identity_fields_cannot_change(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, field: str
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")

    response = await api.patch(
        project_url(workspace, project, "tracked-keywords", created),
        json={field: "x", "priority": 2},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert errors(response) == [(field, "immutable_field")]


async def test_archiving_and_unarchiving_respect_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 1)",
        workspace.id,
    )
    first = await tracked_id(api, workspace, project, owner, "crm")
    archived = await api.patch(
        project_url(workspace, project, "tracked-keywords", first),
        json={"is_active": False},
        headers=owner.headers,
    )
    assert archived.json()["data"]["is_active"] is False
    await tracked_id(api, workspace, project, owner, "erp")

    back = await api.patch(
        project_url(workspace, project, "tracked-keywords", first),
        json={"is_active": True},
        headers=owner.headers,
    )

    assert problem(back) == (422, "quota_exceeded")


async def test_a_deleted_tracked_keyword_is_gone(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    url = project_url(workspace, project, "tracked-keywords", created)

    assert (await api.delete(url, headers=owner.headers)).status_code == 204
    for method, body in (("GET", None), ("PATCH", {"priority": 1}), ("DELETE", None)):
        response = await api.request(method, url, json=body, headers=owner.headers)
        assert problem(response) == (404, "not_found"), method
    assert await _audit(migrated, workspace) == [
        "tracked_keyword.created",
        "tracked_keyword.deleted",
    ]


async def test_competitor_overrides_change_the_effective_set(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    hubspot = await _entity(api, workspace, owner, "HubSpot")
    zoho = await _entity(api, workspace, owner, "Zoho")
    watched = await _entity(api, workspace, owner, "Watched")
    stranger = await _entity(api, workspace, owner, "Stranger")
    await _give(api, workspace, project, owner, hubspot)
    await _give(api, workspace, project, owner, zoho)
    await _give(api, workspace, project, owner, watched, role="watch")
    created = await tracked_id(api, workspace, project, owner, "crm")
    url = project_url(workspace, project, "tracked-keywords", created, "competitors")

    response = await api.put(
        url, json={"include": [watched], "exclude": [zoho]}, headers=owner.headers
    )
    refused = await api.put(url, json={"include": [stranger]}, headers=owner.headers)

    data = response.json()["data"]
    assert sorted(e["canonical_name"] for e in data["effective_competitors"]) == [
        "HubSpot",
        "Watched",
    ]
    assert sorted((o["entity"]["canonical_name"], o["mode"]) for o in data["overrides"]) == [
        ("Watched", "include"),
        ("Zoho", "exclude"),
    ]
    assert refused.status_code == 422
    assert errors(refused) == [("include", "entity_not_in_project")]
    assert (await _audit(migrated, workspace))[-1] == "tracked_keyword.competitors_changed"


# Access.


async def test_a_viewer_reads_and_a_member_of_another_project_sees_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    created = await tracked_id(api, workspace, project, owner, "crm")
    viewer = await member(resources, migrated, workspace, "viewer")
    elsewhere = await member(resources, migrated, workspace, "editor", project_ids=[other])
    url = project_url(workspace, project, "tracked-keywords", created)

    assert (await api.get(url, headers=viewer.headers)).status_code == 200
    assert problem(await track(api, workspace, project, viewer, "erp")) == (403, "forbidden")
    assert problem(await api.get(url, headers=elsewhere.headers)) == (404, "not_found")
    # A tracked keyword of another project of the workspace, through this project's path.
    foreign = await tracked_id(api, workspace, other, owner, "hr")
    assert problem(
        await api.get(
            project_url(workspace, project, "tracked-keywords", foreign), headers=owner.headers
        )
    ) == (404, "not_found")


async def test_a_deleted_projects_keywords_are_gone_with_it(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    await execute(migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", project)
    url = project_url(workspace, project, "tracked-keywords", created)

    for method, path, body in (
        ("GET", url, None),
        ("PATCH", url, {"is_active": False}),
        ("DELETE", url, None),
        ("GET", f"{url}/config-history", None),
        ("PUT", f"{url}/competitors", {"include": []}),
        ("POST", project_url(workspace, project, "tracked-keywords"), {"keyword": "erp"}),
    ):
        response = await api.request(method, path, json=body, headers=owner.headers)
        assert problem(response) == (404, "not_found"), (method, path)


# Restores, merges and large batches (review of step 5 task 3).


async def test_a_restored_keyword_keeps_its_links_and_takes_only_terms_that_fit(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    early, late = await _vocabulary(migrated, workspace, single=True, terms=("early", "late"))
    (topic,) = await _vocabulary(migrated, workspace, terms=("crm",))
    pricing = await _group(migrated, workspace, project, "Pricing")
    zoho = await _entity(api, workspace, owner, "Zoho")
    hubspot = await _entity(api, workspace, owner, "HubSpot")
    await _give(api, workspace, project, owner, zoho)
    await _give(api, workspace, project, owner, hubspot)
    created = await tracked_id(
        api,
        workspace,
        project,
        owner,
        "crm",
        term_ids=[early],
        competitor_overrides={"exclude": [zoho]},
    )
    url = project_url(workspace, project, "tracked-keywords", created)
    await api.delete(url, headers=owner.headers)

    back = await tracked_id(
        api,
        workspace,
        project,
        owner,
        "crm",
        term_ids=[late, topic],
        group_ids=[pricing],
        competitor_overrides={"exclude": [hubspot]},
    )
    detail = (await api.get(url, headers=owner.headers)).json()["data"]

    assert back == created
    assert sorted(t["term_id"] for t in detail["terms"]) == sorted([early, topic])
    assert [g["group_id"] for g in detail["groups"]] == [pricing]
    assert [(o["entity"]["entity_id"], o["mode"]) for o in detail["competitor_overrides"]] == [
        (zoho, "exclude")
    ]


async def test_a_bulk_create_says_which_keywords_came_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    deleted = await tracked_id(api, workspace, project, owner, "crm")
    await api.delete(
        project_url(workspace, project, "tracked-keywords", deleted), headers=owner.headers
    )

    response = await api.post(
        project_url(workspace, project, "tracked-keywords", "bulk-create"),
        json={"items": [{"keyword": "crm"}, {"keyword": "erp"}]},
        headers=owner.headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["created"]) == 2
    assert deleted in data["created"]
    # The deleted keyword came back with its settings; the other one is new.
    assert data["restored"] == [deleted]


async def test_merging_two_duplicates_keeps_one_term_per_single_valued_vocabulary(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    first, second = await _vocabulary(migrated, workspace, single=True, terms=("a", "b"))
    existing = await tracked_id(api, workspace, project, owner, "crm")

    response = await api.post(
        project_url(workspace, project, "tracked-keywords", "bulk-create"),
        json={
            "items": [
                {"keyword": "crm", "term_ids": [first]},
                {"keyword": "CRM", "term_ids": [second]},
            ],
            "on_duplicate": "merge_terms",
        },
        headers=owner.headers,
    )

    assert response.status_code == 200, response.text
    terms = await fetch(
        migrated,
        "SELECT term_id FROM seo.tracked_keyword_terms WHERE tracked_keyword_id = $1",
        uuid.UUID(existing),
    )
    assert [str(row["term_id"]) for row in terms] == [first]


async def test_a_bulk_create_of_more_than_a_write_batch_links_every_row(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    pricing = await _group(migrated, workspace, project, "Pricing")
    (topic,) = await _vocabulary(migrated, workspace)
    # Several insert statements for the links, as a batch near the parameter limit would need.
    monkeypatch.setattr(repository, "LINKS_PER_STATEMENT", 300)

    response = await api.post(
        project_url(workspace, project, "tracked-keywords", "bulk-create"),
        json={
            "items": [
                {
                    "keyword": f"keyword {n}",
                    "device": "both",
                    "group_ids": [pricing],
                    "term_ids": [topic],
                }
                for n in range(501)
            ]
        },
        headers=owner.headers,
    )

    assert response.status_code == 200, response.text
    assert len(response.json()["data"]["created"]) == 1002
    counts = await fetch(
        migrated,
        "SELECT (SELECT count(*) FROM seo.keyword_group_members WHERE group_id = $1) AS groups, "
        "(SELECT count(*) FROM seo.tracked_keyword_terms WHERE term_id = $2) AS terms",
        uuid.UUID(pricing),
        uuid.UUID(topic),
    )
    assert (counts[0]["groups"], counts[0]["terms"]) == (1002, 1002)


async def test_unarchiving_with_a_new_target_url(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    url = project_url(workspace, project, "tracked-keywords", created)
    await api.patch(url, json={"is_active": False}, headers=owner.headers)

    response = await api.patch(
        url, json={"is_active": True, "target_url": "https://acme.io/crm"}, headers=owner.headers
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["is_active"], data["config_version"]) == (True, 2)
    assert data["target_url"]["canonical_url"] == "https://acme.io/crm"
