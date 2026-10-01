"""Workspace keywords: the list, one keyword, its metrics history (docs/19 section 3.6.1)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import httpx

from sightline.api.resources import Resources
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.keywords.support import (
    LOCATION,
    OTHER_LOCATION,
    keyword_project,
    keywords_url,
    tracked_id,
)
from tests.conftest import PostgresServer


async def _snapshot(
    pg: PostgresServer,
    workspace_id: uuid.UUID,
    keyword_id: uuid.UUID,
    fetched_at: str,
    volumes: list[int],
    *,
    current: bool = False,
    location_id: int = LOCATION,
) -> None:
    """A Labs snapshot whose monthly volumes end in August 2026."""
    fetched = datetime.fromisoformat(fetched_at)
    months = [(2025, m) for m in range(9, 13)] + [(2026, m) for m in range(1, 9)]
    monthly = [
        {"year": year, "month": month, "search_volume": volume}
        for (year, month), volume in zip(months[-len(volumes) :], volumes, strict=True)
    ]
    row = await fetchrow(
        pg,
        "INSERT INTO seo.keyword_metric_snapshots (workspace_id, keyword_id, location_id, "
        "language_code, source, fetched_at, data_month, search_volume, monthly_searches, "
        "keyword_difficulty, is_material_change) VALUES ($1, $2, $3, 'en', 'dataforseo_labs', "
        "$4, '2026-08-01', $5, $6, 40, true) RETURNING id",
        workspace_id,
        keyword_id,
        location_id,
        fetched,
        volumes[-1],
        json.dumps(monthly),
    )
    if current:
        await execute(
            pg,
            "INSERT INTO seo.keyword_metrics_current (keyword_id, location_id, language_code, "
            "source, workspace_id, snapshot_id, search_volume, keyword_difficulty, fetched_at) "
            "VALUES ($1, $2, 'en', 'dataforseo_labs', $3, $4, $5, 40, $6)",
            keyword_id,
            location_id,
            workspace_id,
            row["id"],
            volumes[-1],
            fetched,
        )


async def test_keywords_are_listed_by_text_with_a_search_and_a_cursor(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    for text in ("CRM software", "best crm", "erp", "crm for startups"):
        await tracked_id(api, workspace, project, owner, text)

    first = await api.get(
        keywords_url(workspace), params={"filter[q]": "CRM", "limit": 2}, headers=owner.headers
    )
    second = await api.get(
        keywords_url(workspace),
        params={"filter[q]": "CRM", "limit": 2, "cursor": first.json()["page"]["next_cursor"]},
        headers=owner.headers,
    )
    german = await api.get(
        keywords_url(workspace), params={"filter[language_code]": "de"}, headers=owner.headers
    )

    assert [k["text"] for k in first.json()["data"]] == ["best crm", "crm for startups"]
    assert first.json()["page"]["has_more"] is True
    assert [k["text"] for k in second.json()["data"]] == ["CRM software"]
    assert second.json()["page"]["has_more"] is False
    assert german.json()["data"] == []


async def test_a_member_limited_to_a_project_sees_its_keywords_only(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine = await keyword_project(migrated, workspace)
    theirs = await keyword_project(migrated, workspace)
    await tracked_id(api, workspace, mine, owner, "shared")
    await tracked_id(api, workspace, theirs, owner, "shared")
    hidden = await tracked_id(api, workspace, theirs, owner, "hidden")
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[mine])
    hidden_keyword = await fetchrow(
        migrated, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(hidden)
    )

    listed = await api.get(keywords_url(workspace), headers=scoped.headers)
    shared_id = listed.json()["data"][0]["keyword_id"]
    detail = await api.get(keywords_url(workspace, shared_id), headers=scoped.headers)
    refused = await api.get(
        keywords_url(workspace, hidden_keyword["keyword_id"]), headers=scoped.headers
    )

    assert [k["text"] for k in listed.json()["data"]] == ["shared"]
    # Only the variant of the member's project.
    assert [v["project_id"] for v in detail.json()["data"]["tracked"]] == [str(mine)]
    assert problem(refused) == (404, "not_found")


async def test_a_member_limited_to_a_project_sees_metrics_where_it_tracks_the_keyword(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine = await keyword_project(migrated, workspace)
    theirs = await keyword_project(migrated, workspace)
    created = await tracked_id(api, workspace, mine, owner, "crm")
    await tracked_id(api, workspace, theirs, owner, "crm", location_id=OTHER_LOCATION)
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[mine])
    keyword = await fetchrow(
        migrated, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(created)
    )
    keyword_id = keyword["keyword_id"]
    for location in (LOCATION, OTHER_LOCATION):
        await _snapshot(
            migrated,
            workspace.id,
            keyword_id,
            "2026-09-20T03:00:00Z",
            [100] * 12,
            current=True,
            location_id=location,
        )

    detail = await api.get(keywords_url(workspace, keyword_id), headers=scoped.headers)
    elsewhere = await api.get(
        keywords_url(workspace, keyword_id, "metrics-history"),
        params={"location_id": OTHER_LOCATION, "language_code": "en"},
        headers=scoped.headers,
    )
    everywhere = await api.get(keywords_url(workspace, keyword_id), headers=owner.headers)

    assert [m["location_id"] for m in detail.json()["data"]["metrics"]] == [LOCATION]
    assert elsewhere.json()["data"]["snapshots"] == []
    assert sorted(m["location_id"] for m in everywhere.json()["data"]["metrics"]) == sorted(
        [LOCATION, OTHER_LOCATION]
    )


async def test_a_keyword_shows_its_current_metrics_and_tracked_variants(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    created = await tracked_id(api, workspace, project, owner, "crm", device="both")
    keyword = await fetchrow(
        migrated, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(created)
    )
    await _snapshot(
        migrated,
        workspace.id,
        keyword["keyword_id"],
        "2026-09-20T03:00:00Z",
        [100] * 12,
        current=True,
    )

    response = await api.get(keywords_url(workspace, keyword["keyword_id"]), headers=owner.headers)

    data = response.json()["data"]
    assert [m["search_volume"]["value"] for m in data["metrics"]] == [100]
    assert sorted(v["device"] for v in data["tracked"]) == ["desktop", "mobile"]


async def test_metrics_history_has_the_snapshots_a_trend_and_seasonality(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    created = await tracked_id(api, workspace, project, owner, "crm")
    keyword = await fetchrow(
        migrated, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(created)
    )
    keyword_id = keyword["keyword_id"]
    await _snapshot(migrated, workspace.id, keyword_id, "2026-07-20T03:00:00Z", [100] * 12)
    await _snapshot(
        migrated, workspace.id, keyword_id, "2026-09-20T03:00:00Z", [50] * 11 + [600], current=True
    )
    url = keywords_url(workspace, keyword_id, "metrics-history")

    response = await api.get(
        url, params={"location_id": LOCATION, "language_code": "en"}, headers=owner.headers
    )
    since = await api.get(
        url,
        params={"location_id": LOCATION, "language_code": "en", "from": "2026-08-01"},
        headers=owner.headers,
    )

    data = response.json()["data"]
    assert [s["search_volume"] for s in data["snapshots"]] == [100, 600]
    assert len(data["snapshots"][1]["monthly_searches"]) == 12
    assert data["trend"]["metric"] == "seo.search_volume_trend"
    assert data["trend"]["value"] > 0
    assert data["seasonality"]["is_seasonal"] is True
    assert {m["month"] for m in data["seasonality"]["index_by_month"]} == set(range(1, 13))
    assert [s["search_volume"] for s in since.json()["data"]["snapshots"]] == [600]


async def test_another_workspaces_keyword_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    stranger = await member(resources, migrated, other, "owner")
    project = await keyword_project(migrated, other)
    created = await tracked_id(api, other, project, stranger, "crm")
    keyword = await fetchrow(
        migrated, "SELECT keyword_id FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(created)
    )

    for path in (
        keywords_url(workspace, keyword["keyword_id"]),
        keywords_url(workspace, keyword["keyword_id"], "metrics-history")
        + f"?location_id={LOCATION}&language_code=en",
    ):
        assert problem(await api.get(path, headers=owner.headers)) == (404, "not_found")
