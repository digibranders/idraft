"""Clicks and impressions from Search Console on the tracked keyword list (docs/18 section 4.9):
the states, the join of normalized query, country and device over the 28 final days, and the
sorts."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from typing import Any

import asyncpg
import httpx
import pytest

from idraft.api.resources import Resources
from idraft.domain.gsc_pull import ALL_PAGES, PullState
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import (
    LOCATION,
    OTHER_LOCATION,
    keyword_project,
    project_url,
    track,
    tracked_id,
)
from tests.conftest import PostgresServer

END = date.today() - timedelta(days=3)
START = END - timedelta(days=27)
DESKTOP, MOBILE = "DESKTOP", "MOBILE"


async def _world(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _property(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    *,
    state: PullState | None = None,
    status: str = "active",
    connection_status: str = "active",
) -> uuid.UUID:
    """A linked property and the pull's state: by default the window is stored and ends at END."""
    state = PullState(recent_done=True, window_end=END) if state is None else state
    secret = await fetch(
        pg,
        "INSERT INTO ops.secrets (workspace_id, kind, ciphertext, dek_wrapped, kek_version, "
        "fingerprint) VALUES ($1, 'oauth_refresh_token', '\\x00', '\\x00', 1, 'abcd') "
        "RETURNING id",
        workspace.id,
    )
    connection = await fetch(
        pg,
        "INSERT INTO fp.connections (workspace_id, product, auth_method, subject_id, "
        "credential_ref, scopes, status) VALUES ($1, 'google', 'oauth', $2, $3, '{}', $4) "
        "RETURNING id",
        workspace.id,
        uuid.uuid4().hex,
        secret[0]["id"],
        connection_status,
    )
    row = await fetch(
        pg,
        "INSERT INTO fp.integrations (workspace_id, project_id, kind, external_property, "
        "connection_id, scopes, status, backfill_state) "
        "VALUES ($1, $2, 'gsc', $3, $4, '{}', $5, $6::jsonb) RETURNING id",
        workspace.id,
        project_id,
        f"sc-domain:{uuid.uuid4().hex[:8]}.example",
        connection[0]["id"],
        status,
        json.dumps(state.write({})),
    )
    integration_id: uuid.UUID = row[0]["id"]
    return integration_id


async def _rows(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    integration_id: uuid.UUID,
    day: date,
    query: str,
    country: str,
    device: str,
    clicks: int,
    impressions: int,
    *,
    normalized: str | None = None,
    data_state: str = "final",
    search_type: str = "web",
    url_id: int = ALL_PAGES,
) -> None:
    query_hash = hashlib.sha256(query.encode()).digest()
    await execute(
        pg,
        "INSERT INTO fp.gsc_queries (workspace_id, query_hash, query_text, normalized_text) "
        "VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        workspace.id,
        query_hash,
        query,
        normalized if normalized is not None else " ".join(query.lower().split()),
    )
    await execute(
        pg,
        "INSERT INTO fp.gsc_search_analytics (integration_id, metric_date, search_type, "
        "query_hash, url_id, country_iso3, device, workspace_id, project_id, clicks, "
        "impressions, position_sum, data_state) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 10, $12)",
        integration_id,
        day,
        search_type,
        query_hash,
        url_id,
        country,
        device,
        workspace.id,
        project_id,
        clicks,
        impressions,
        data_state,
    )


def _putter(
    pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID, integration_id: uuid.UUID
) -> Callable[..., Awaitable[None]]:
    async def put(*args: Any, **named: Any) -> None:
        await _rows(pg, workspace, project_id, integration_id, *args, **named)

    return put


async def _list(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    **params: Any,
) -> list[dict[str, Any]]:
    response = await api.get(
        project_url(workspace, project, "tracked-keywords"), params=params, headers=caller.headers
    )
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["data"]
    return rows


def _by_text(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["keyword"]["text"]: row for row in rows}


def _counts(row: dict[str, Any]) -> tuple[dict[str, int], dict[str, int]]:
    return row["gsc"]["clicks"], row["gsc"]["impressions"]


async def test_a_property_whose_first_days_are_not_all_stored_is_pending(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm software")
    integration = await _property(
        migrated, workspace, project, state=PullState(recent_done=False, window_end=END)
    )
    await _rows(
        migrated, workspace, project, integration, END, "crm software", "USA", DESKTOP, 5, 9
    )

    (row,) = await _list(api, workspace, project, owner, include="gsc")

    assert row["gsc"] == {
        "state": "pending",
        "clicks": None,
        "impressions": None,
        "window": None,
        "trend": None,
    }


async def test_a_window_that_is_stored_gives_the_counts_of_both_devices_and_its_dates(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    desktop = await tracked_id(api, workspace, project, owner, "crm software")
    mobile = await tracked_id(api, workspace, project, owner, "crm software", device="mobile")
    integration = await _property(migrated, workspace, project)
    put = _putter(migrated, workspace, project, integration)
    await put(END, "crm software", "USA", DESKTOP, 4, 40)
    await put(START, "crm software", "USA", DESKTOP, 1, 10)
    await put(END, "crm software", "USA", MOBILE, 2, 30)

    rows = await _list(api, workspace, project, owner, include="gsc")

    assert len(rows) == 2
    for row in rows:
        assert row["gsc"]["state"] == "ok"
        assert row["gsc"]["window"] == {"start": START.isoformat(), "end": END.isoformat()}
        # the row carries both devices; the table picks the one it shows
        assert _counts(row) == (
            {"desktop": 5, "mobile": 2},
            {"desktop": 50, "mobile": 30},
        )
    assert {row["tracked_keyword_id"] for row in rows} == {desktop, mobile}


async def test_rows_stored_per_page_by_the_first_version_of_the_pull_are_not_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm software")
    integration = await _property(migrated, workspace, project)
    put = _putter(migrated, workspace, project, integration)
    await put(END, "crm software", "USA", DESKTOP, 4, 40)
    # two pages of one search, each counted an impression: summed they would read 40 + 25 + 25
    await put(END, "crm software", "USA", DESKTOP, 4, 25, url_id=11)
    await put(END, "crm software", "USA", DESKTOP, 0, 25, url_id=12)

    (row,) = await _list(api, workspace, project, owner, include="gsc", sort="-gsc_impressions")

    assert _counts(row) == ({"desktop": 4, "mobile": 0}, {"desktop": 40, "mobile": 0})


async def test_two_spellings_of_one_query_are_one_keyword_and_other_text_is_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "CRM  Software")
    await tracked_id(api, workspace, project, owner, "crm")
    integration = await _property(migrated, workspace, project)
    put = _putter(migrated, workspace, project, integration)
    await put(END, "crm software", "USA", DESKTOP, 3, 30)
    await put(END, "CRM Software ", "USA", DESKTOP, 2, 20, normalized="crm software")
    await put(END, "crm software tools", "USA", DESKTOP, 9, 90)

    rows = _by_text(await _list(api, workspace, project, owner, include="gsc"))

    assert _counts(rows["CRM Software"]) == (
        {"desktop": 5, "mobile": 0},
        {"desktop": 50, "mobile": 0},
    )
    assert _counts(rows["crm"])[0] == {"desktop": 0, "mobile": 0}


async def test_only_final_web_days_of_the_window_in_the_keywords_country_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm software")
    await tracked_id(api, workspace, project, owner, "crm software", location_id=OTHER_LOCATION)
    integration = await _property(migrated, workspace, project)
    put = _putter(migrated, workspace, project, integration)
    await put(END, "crm software", "USA", DESKTOP, 1, 10)
    await put(END, "crm software", "GBR", DESKTOP, 6, 60)
    await put(END, "crm software", "DEU", DESKTOP, 99, 990)
    await put(END, "crm software", "USA", "TABLET", 99, 990)
    await put(START - timedelta(days=1), "crm software", "USA", DESKTOP, 99, 990)
    await put(END + timedelta(days=1), "crm software", "USA", DESKTOP, 99, 990)
    await put(END - timedelta(days=1), "crm software", "USA", DESKTOP, 99, 990, data_state="all")
    await put(END, "crm software", "USA", DESKTOP, 99, 990, search_type="image")

    rows = await _list(api, workspace, project, owner, include="gsc")

    by_location = {row["location_id"]: row for row in rows}
    assert _counts(by_location[LOCATION])[0] == {"desktop": 1, "mobile": 0}
    assert _counts(by_location[OTHER_LOCATION])[0] == {"desktop": 6, "mobile": 0}


async def test_a_keyword_with_data_around_it_but_none_of_its_own_has_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "quiet keyword")
    integration = await _property(migrated, workspace, project)
    await _rows(
        migrated, workspace, project, integration, END, "loud keyword", "USA", DESKTOP, 4, 9
    )

    (row,) = await _list(api, workspace, project, owner, include="gsc")

    assert row["gsc"]["state"] == "ok"
    assert _counts(row) == ({"desktop": 0, "mobile": 0}, {"desktop": 0, "mobile": 0})


async def test_a_property_that_has_no_data_at_all_has_zeros_once_its_window_is_set(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm")
    await _property(migrated, workspace, project)

    (row,) = await _list(api, workspace, project, owner, include="gsc")

    assert row["gsc"]["state"] == "ok"
    assert row["gsc"]["clicks"] == {"desktop": 0, "mobile": 0}


@pytest.mark.parametrize(
    ("status", "connection_status"),
    [("reauth_required", "reauth_required"), ("error", "active"), ("active", "reauth_required")],
)
async def test_a_property_that_stopped_syncing_is_not_shown_as_current(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    status: str,
    connection_status: str,
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm")
    integration = await _property(
        migrated, workspace, project, status=status, connection_status=connection_status
    )
    await _rows(migrated, workspace, project, integration, END, "crm", "USA", DESKTOP, 4, 9)

    (row,) = await _list(api, workspace, project, owner, include="gsc")

    assert row["gsc"]["state"] == "not_connected"
    assert row["gsc"]["trend"] is None


async def test_another_workspaces_rows_are_never_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    other, other_project, _ = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm software")
    mine = await _property(migrated, workspace, project)
    theirs = await _property(migrated, other, other_project)
    await _rows(migrated, workspace, project, mine, END, "crm software", "USA", DESKTOP, 2, 20)
    await _rows(
        migrated, other, other_project, theirs, END, "crm software", "USA", DESKTOP, 77, 770
    )

    (row,) = await _list(api, workspace, project, owner, include="gsc")

    assert _counts(row) == ({"desktop": 2, "mobile": 0}, {"desktop": 20, "mobile": 0})


async def test_the_api_role_sees_only_its_workspaces_numbers(
    migrated: PostgresServer, resources: Resources
) -> None:
    one = await make_workspace(migrated)
    two = await make_workspace(migrated)
    project_one = await keyword_project(migrated, one)
    project_two = await keyword_project(migrated, two)
    first = await _property(migrated, one, project_one)
    second = await _property(migrated, two, project_two)
    await _rows(migrated, one, project_one, first, END, "crm", "USA", DESKTOP, 1, 1)
    await _rows(migrated, two, project_two, second, END, "crm", "USA", DESKTOP, 2, 2)

    connection = await asyncpg.connect(migrated.url("app_api"))
    try:
        async with connection.transaction():
            await connection.execute("SELECT set_config('app.workspace_id', $1, true)", str(one.id))
            seen = await connection.fetch("SELECT clicks FROM fp.gsc_search_analytics")
            queries = await connection.fetch("SELECT workspace_id FROM fp.gsc_queries")
    finally:
        await connection.close()
    assert [row["clicks"] for row in seen] == [1]
    assert {row["workspace_id"] for row in queries} == {one.id}


async def test_the_trend_is_the_keywords_own_device_in_seven_4_day_buckets_oldest_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await tracked_id(api, workspace, project, owner, "crm software")
    await tracked_id(api, workspace, project, owner, "crm software", device="mobile")
    await tracked_id(api, workspace, project, owner, "quiet keyword")
    integration = await _property(migrated, workspace, project)
    put = _putter(migrated, workspace, project, integration)
    await put(START, "crm software", "USA", DESKTOP, 1, 10)
    await put(START + timedelta(days=3), "crm software", "USA", DESKTOP, 2, 20)
    await put(START + timedelta(days=4), "crm software", "USA", DESKTOP, 4, 40)
    await put(END - timedelta(days=3), "crm software", "USA", DESKTOP, 8, 80)
    await put(END, "crm software", "USA", DESKTOP, 16, 160)
    await put(START + timedelta(days=13), "crm software", "USA", MOBILE, 5, 50)
    # outside the window, not final, or a tablet: in no bucket
    await put(START - timedelta(days=1), "crm software", "USA", DESKTOP, 99, 990)
    await put(END + timedelta(days=1), "crm software", "USA", DESKTOP, 99, 990)
    await put(END - timedelta(days=1), "crm software", "USA", DESKTOP, 99, 990, data_state="all")
    await put(END, "crm software", "USA", "TABLET", 99, 990)

    rows = await _list(api, workspace, project, owner, include="gsc")

    by_key = {(row["keyword"]["text"], row["device"]): row["gsc"] for row in rows}
    desktop = by_key[("crm software", "desktop")]
    mobile = by_key[("crm software", "mobile")]
    quiet = by_key[("quiet keyword", "desktop")]
    assert desktop["trend"] == {
        "bucket_days": 4,
        "clicks": [3, 4, 0, 0, 0, 0, 24],
        "impressions": [30, 40, 0, 0, 0, 0, 240],
    }
    assert mobile["trend"] == {
        "bucket_days": 4,
        "clicks": [0, 0, 0, 5, 0, 0, 0],
        "impressions": [0, 0, 0, 50, 0, 0, 0],
    }
    assert quiet["trend"] == {"bucket_days": 4, "clicks": [0] * 7, "impressions": [0] * 7}
    for gsc, device in ((desktop, "desktop"), (mobile, "mobile"), (quiet, "desktop")):
        assert sum(gsc["trend"]["clicks"]) == gsc["clicks"][device]
        assert sum(gsc["trend"]["impressions"]) == gsc["impressions"][device]


async def _three(
    api: httpx.AsyncClient, resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller, dict[str, str]]:
    """Four keywords: `top` 9 clicks and 50 impressions, `mid` and `twin` 5 and 20 (a tie on
    both), `none` no rows; one of them tracked on mobile."""
    workspace, project, owner = await _world(resources, pg)
    ids = {
        "top": await tracked_id(api, workspace, project, owner, "top"),
        "mid": await tracked_id(api, workspace, project, owner, "mid"),
        "twin": await tracked_id(api, workspace, project, owner, "twin"),
        "none": await tracked_id(api, workspace, project, owner, "none"),
    }
    integration = await _property(pg, workspace, project)
    for text, clicks, impressions in (("top", 9, 50), ("mid", 5, 20), ("twin", 5, 20)):
        await _rows(
            pg, workspace, project, integration, END, text, "USA", DESKTOP, clicks, impressions
        )
    return workspace, project, owner, ids


async def test_the_list_sorts_by_clicks_and_by_impressions_with_the_id_breaking_ties(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, ids = await _three(api, resources, migrated)
    tied = sorted([ids["mid"], ids["twin"]])

    clicks = await _list(api, workspace, project, owner, sort="-gsc_clicks")
    impressions = await _list(api, workspace, project, owner, sort="gsc_impressions")

    assert [row["tracked_keyword_id"] for row in clicks] == [ids["top"], *tied, ids["none"]]
    assert [row["tracked_keyword_id"] for row in impressions] == [ids["none"], *tied, ids["top"]]


async def test_a_sort_by_clicks_pages_without_losing_or_repeating_a_row(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, ids = await _three(api, resources, migrated)
    url = project_url(workspace, project, "tracked-keywords")
    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"sort": "-gsc_clicks,keyword", "limit": 1}
        if cursor:
            params["cursor"] = cursor
        response = await api.get(url, params=params, headers=owner.headers)
        assert response.status_code == 200, response.text
        body = response.json()
        seen += [row["tracked_keyword_id"] for row in body["data"]]
        cursor = body["page"].get("next_cursor")
        if not cursor:
            break

    assert sorted(seen) == sorted(ids.values())
    assert (seen[0], seen[-1]) == (ids["top"], ids["none"])


async def test_the_sorts_leave_every_row_equal_until_there_are_numbers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    ids = [await tracked_id(api, workspace, project, owner, text) for text in ("b", "a", "c")]

    unconnected = await _list(api, workspace, project, owner, sort="-gsc_clicks")
    await _property(migrated, workspace, project, state=PullState())
    pending = await _list(api, workspace, project, owner, sort="-gsc_impressions", include="gsc")

    assert [row["tracked_keyword_id"] for row in unconnected] == sorted(ids)
    assert [row["tracked_keyword_id"] for row in pending] == sorted(ids)
    assert {row["gsc"]["state"] for row in pending} == {"pending"}


async def test_a_sort_on_clicks_counts_the_keywords_own_device(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    desktop = await tracked_id(api, workspace, project, owner, "crm")
    mobile = await tracked_id(api, workspace, project, owner, "crm", device="mobile")
    integration = await _property(migrated, workspace, project)
    await _rows(migrated, workspace, project, integration, END, "crm", "USA", DESKTOP, 1, 10)
    await _rows(migrated, workspace, project, integration, END, "crm", "USA", MOBILE, 8, 10)

    rows = await _list(api, workspace, project, owner, sort="-gsc_clicks")

    assert [row["tracked_keyword_id"] for row in rows] == [mobile, desktop]


async def test_a_keyword_added_with_two_devices_is_the_same_text_on_both(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    response = await track(api, workspace, project, owner, "crm", device="both")
    assert response.status_code == 201, response.text
    integration = await _property(migrated, workspace, project)
    await _rows(migrated, workspace, project, integration, END, "crm", "USA", DESKTOP, 3, 30)
    await _rows(migrated, workspace, project, integration, END, "crm", "USA", MOBILE, 4, 40)

    rows = await _list(api, workspace, project, owner, include="gsc")

    assert {row["device"] for row in rows} == {"desktop", "mobile"}
    for row in rows:
        assert _counts(row)[0] == {"desktop": 3, "mobile": 4}
