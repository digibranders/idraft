"""The tracked pages routes (plan 01 task 8, spec sections 7.1 and 7.2): the list with numbers,
health, trend and query counts, adding and removing pages, the ids, and the suggestions. Nothing
here reaches Google: every number is a stored row."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.main import create_app
from idraft.api.openapi import placeholder_settings
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.fp.pages_support import (
    FINAL,
    bulk_pages,
    connect,
    days,
    marker,
    seed_pages,
    track,
    uncrawled_url,
)
from tests.api.internal_links.support import audit_rows, seed_tiers
from tests.api.keywords.support import project_url
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer

OCT, SEP = date(2026, 10, 1), date(2026, 9, 1)
OCT_END, SEP_END = date(2026, 10, 31), date(2026, 9, 30)
# The oldest day Search Console history reaches in these tests, before every period.
HISTORY_START = date(2025, 7, 28)


async def _world(
    resources: Resources, migrated: PostgresServer, role: str = "owner"
) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    return workspace, await make_project(migrated, workspace.id), caller


async def _get(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    *parts: str,
    **params: str,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project_id, "fp", "tracked-pages", *parts),
        params=params,
        headers=caller.headers,
    )


async def _list(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    **params: str,
) -> dict[str, Any]:
    response = await _get(api, workspace, project_id, caller, **params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _post(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
    *parts: str,
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project_id, "fp", "tracked-pages", *parts),
        json=body,
        headers=caller.headers,
    )


async def _tracked_count(pg: PostgresServer, project_id: uuid.UUID) -> int:
    row = await fetchrow(
        pg, "SELECT count(*) AS n FROM core.tracked_pages WHERE project_id = $1", project_id
    )
    count: int = row["n"]
    return count


async def _pricing(
    pg: PostgresServer,
    workspace: Workspace,
    project_id: uuid.UUID,
    *,
    ready: bool = True,
    history_from: date = HISTORY_START,
    titles: dict[str, str | None] | None = None,
) -> tuple[uuid.UUID, int]:
    """A tracked `/pricing` with the October and September numbers of spec section 7.2: 317 and
    412 clicks, 41,200 and 39,600 impressions, positions 5.9 and 3.8."""
    integration = await connect(pg, workspace, project_id)
    ids = await seed_pages(pg, workspace, project_id, titles or {"/pricing": "Pricing"})
    page = ids["/pricing"]
    await track(pg, workspace, project_id, [page])
    await days(
        pg, workspace, project_id, integration, page, OCT,
        [10] * 30 + [17], [1329] * 30 + [1330], "5.9",
    )  # fmt: skip
    await days(
        pg, workspace, project_id, integration, page, SEP,
        [13] * 29 + [35], [1320] * 30, "3.8",
    )  # fmt: skip
    if ready:
        await marker(pg, workspace, project_id, integration, page, "history", history_from, FINAL)
    return integration, page


async def test_the_list_gives_each_tracked_page_its_numbers_health_and_trend(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    tier = (await seed_tiers(migrated, workspace))[0]
    integration = await connect(migrated, workspace, project)
    ids = await seed_pages(
        migrated, workspace, project, {"/pricing": "Pricing"}, tiers={"/pricing": tier}
    )
    page = ids["/pricing"]
    await track(migrated, workspace, project, [page])
    await days(
        migrated, workspace, project, integration, page, OCT,
        [10] * 30 + [17], [1329] * 30 + [1330], "5.9",
    )  # fmt: skip
    await days(
        migrated, workspace, project, integration, page, SEP,
        [13] * 29 + [35], [1320] * 30, "3.8",
    )  # fmt: skip
    await marker(migrated, workspace, project, integration, page, "history", HISTORY_START, FINAL)

    body = await _list(api, workspace, project, owner)

    assert body["meta"] == {
        "state": "ok",
        "property": "sc-domain:acme.example",
        "final_through": "2026-11-22",
        "window": {"from": "2026-10-01", "to": "2026-10-31", "days": 31},
        "compare_window": {"from": "2026-09-01", "to": "2026-09-30", "days": 30},
        "limit": 200,
        "tracked": 1,
    }
    [row] = body["data"]
    assert row["url_id"] == str(page)
    assert row["url"] == "https://example.com/pricing"
    assert (row["path"], row["title"], row["tier_id"]) == ("/pricing", "Pricing", str(tier))
    assert row["added_at"]
    assert row["history"] == "ready"
    assert (row["current"]["clicks"], row["current"]["impressions"]) == (317, 41200)
    assert row["current"]["ctr"] == pytest.approx(317 / 41200)
    assert row["current"]["position"] == pytest.approx(5.9)
    assert (row["previous"]["clicks"], row["previous"]["impressions"]) == (412, 39600)
    assert row["previous"]["position"] == pytest.approx(3.8)
    assert row["health"]["verdict"] == "declining"
    assert row["health"]["basis"] == "clicks"
    assert row["health"]["flags"] == ["position_slipped"]
    assert row["health"]["change"] == pytest.approx(317 / (412 * 31 / 30) - 1)
    assert len(row["trend"]) == 31
    assert row["trend"][0] == 10
    assert row["trend"][-1] == 17


async def test_a_page_without_its_history_has_no_numbers_though_its_rows_exist(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _pricing(migrated, workspace, project, ready=False)

    [row] = (await _list(api, workspace, project, owner))["data"]

    assert row["history"] == "loading"
    assert (row["current"], row["previous"], row["health"], row["trend"]) == (None,) * 4


async def test_queries_are_the_stored_counts_of_the_period_and_the_one_before(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration, page = await _pricing(migrated, workspace, project)
    await marker(
        migrated, workspace, project, integration, page, "query", OCT, OCT_END, query_count=1240
    )
    await marker(
        migrated, workspace, project, integration, page, "query", SEP, SEP_END, query_count=1105
    )

    [row] = (await _list(api, workspace, project, owner))["data"]

    assert row["queries"] == {"value": 1240, "previous": 1105, "capped": False}


async def test_queries_are_null_where_nothing_is_stored_never_zero(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration, page = await _pricing(migrated, workspace, project)

    async def queries(**params: str) -> Any:
        return (await _list(api, workspace, project, owner, **params))["data"][0]["queries"]

    assert await queries() is None
    # A marker of another kind for the window is not read.
    await marker(migrated, workspace, project, integration, page, "country", OCT, OCT_END)
    assert await queries() is None
    # Only the compared window's marker: nothing for the window.
    await marker(
        migrated, workspace, project, integration, page, "query", SEP, SEP_END, query_count=7
    )
    assert await queries() is None
    # Only the window's: the compared count is unknown.
    await marker(
        migrated, workspace, project, integration, page, "query", OCT, OCT_END, query_count=0
    )
    assert await queries(compare="none") == {"value": 0, "previous": None, "capped": False}
    assert await queries() == {"value": 0, "previous": 7, "capped": False}
    # A window that is not a stored one.
    assert await queries(**{"from": "2026-10-05", "to": "2026-10-11"}) is None


async def test_a_capped_count_is_flagged_and_a_capped_previous_is_dropped(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration, page = await _pricing(migrated, workspace, project)
    await marker(
        migrated, workspace, project, integration, page, "query", OCT, OCT_END,
        query_count=25000, capped=True,
    )  # fmt: skip
    await marker(
        migrated, workspace, project, integration, page, "query", SEP, SEP_END, query_count=900
    )
    [row] = (await _list(api, workspace, project, owner))["data"]
    assert row["queries"] == {"value": 25000, "previous": 900, "capped": True}


async def test_a_capped_previous_is_dropped_and_does_not_flag_the_value(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration, page = await _pricing(migrated, workspace, project)
    await marker(
        migrated, workspace, project, integration, page, "query", OCT, OCT_END, query_count=1300
    )
    await marker(
        migrated, workspace, project, integration, page, "query", SEP, SEP_END,
        query_count=25000, capped=True,
    )  # fmt: skip

    [row] = (await _list(api, workspace, project, owner))["data"]

    assert row["queries"] == {"value": 1300, "previous": None, "capped": False}


async def test_cannibalization_is_reserved_and_null(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _pricing(migrated, workspace, project)
    await _pricing_second(migrated, workspace, project)

    rows = (await _list(api, workspace, project, owner))["data"]

    assert len(rows) == 2
    assert all(row["cannibalization"] is None for row in rows)
    schema = create_app(placeholder_settings()).openapi()["components"]["schemas"]
    field = schema["TrackedPageRow"]["properties"]["cannibalization"]
    assert {"$ref": "#/components/schemas/PageCannibalization"} in field["anyOf"]
    assert {"type": "null"} in field["anyOf"]
    assert "reserved" in field["description"].lower()


async def _pricing_second(pg: PostgresServer, workspace: Workspace, project_id: uuid.UUID) -> None:
    ids = await seed_pages(pg, workspace, project_id, {"/blog": None})
    await track(pg, workspace, project_id, [ids["/blog"]])


async def test_compare_none_gives_no_previous(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _pricing(migrated, workspace, project)

    body = await _list(api, workspace, project, owner, compare="none")

    [row] = body["data"]
    assert row["previous"] is None
    assert body["meta"]["compare_window"] is None
    assert row["health"]["verdict"] == "stable"


async def test_a_period_before_the_first_stored_day_has_no_previous(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await connect(migrated, workspace, project)
    ids = await seed_pages(migrated, workspace, project, {"/pricing": "Pricing"})
    page = ids["/pricing"]
    await track(migrated, workspace, project, [page])
    await days(
        migrated, workspace, project, integration, page, OCT,
        [10] * 31, [1000] * 31, "5.0",
    )  # fmt: skip
    # The history starts on 2026-09-15, after the start of the compared month.
    await marker(
        migrated, workspace, project, integration, page, "history", date(2026, 9, 15), FINAL
    )

    [row] = (await _list(api, workspace, project, owner))["data"]

    assert row["previous"] is None
    assert row["current"]["clicks"] == 310


async def test_states(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    # No integration: the pages are listed, with no numbers.
    workspace, project, owner = await _world(resources, migrated)
    ids = await seed_pages(migrated, workspace, project, {"/pricing": "Pricing"})
    await track(migrated, workspace, project, [ids["/pricing"]])
    body = await _list(api, workspace, project, owner)
    assert body["meta"]["state"] == "not_connected"
    assert body["meta"]["property"] is None
    assert (body["meta"]["window"], body["meta"]["final_through"]) == (None, None)
    [row] = body["data"]
    assert row["path"] == "/pricing"
    assert (row["current"], row["previous"], row["health"], row["trend"]) == (None,) * 4
    assert row["queries"] is None

    # Connected, the first 28 days not stored yet: no window, no final day.
    workspace, project, owner = await _world(resources, migrated)
    await connect(migrated, workspace, project, recent_done=False)
    ids = await seed_pages(migrated, workspace, project, {"/pricing": "Pricing"})
    await track(migrated, workspace, project, [ids["/pricing"]])
    body = await _list(api, workspace, project, owner)
    assert body["meta"]["state"] == "pending"
    assert body["meta"]["property"] == "sc-domain:acme.example"
    assert (body["meta"]["window"], body["meta"]["final_through"]) == (None, None)
    assert body["data"][0]["current"] is None

    # A property that needs a new sign-in, or that Google refused: the stored numbers stay.
    for status, state in (("reauth_required", "reauth_required"), ("error", "no_access")):
        workspace, project, owner = await _world(resources, migrated)
        await _pricing(migrated, workspace, project)
        await _set_integration_status(migrated, project, status)
        body = await _list(api, workspace, project, owner)
        assert body["meta"]["state"] == state
        assert body["meta"]["final_through"] == "2026-11-22"
        assert body["data"][0]["current"]["clicks"] == 317


async def _set_integration_status(pg: PostgresServer, project_id: uuid.UUID, status: str) -> None:
    await execute(
        pg, "UPDATE fp.integrations SET status = $2 WHERE project_id = $1", project_id, status
    )


async def test_a_window_over_92_days_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _pricing(migrated, workspace, project)

    response = await _get(
        api, workspace, project, owner, **{"from": "2026-08-01", "to": "2026-11-22"}
    )

    assert problem(response) == (422, "window_too_large")


async def test_a_window_that_starts_after_it_ends_is_a_validation_error(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await _pricing(migrated, workspace, project)

    response = await _get(
        api, workspace, project, owner, **{"from": "2026-11-10", "to": "2026-11-01"}
    )

    assert problem(response) == (422, "validation_failed")


async def test_a_project_outside_the_workspace_is_not_found(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, _, owner = await _world(resources, migrated)

    response = await _get(api, workspace, uuid.uuid4(), owner)

    assert problem(response) == (404, "not_found")


async def test_adding_by_address_and_by_id(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await connect(migrated, workspace, project)
    ids = await seed_pages(
        migrated,
        workspace,
        project,
        {"/pricing": "Pricing", "/blog/soc-guide": None, "/by-id": None},
    )
    await uncrawled_url(migrated, "/not-a-page")
    await track(migrated, workspace, project, [ids["/blog/soc-guide"]])
    # 28 days ending on the last final day, and one day before them that does not count.
    await days(
        migrated, workspace, project, integration, ids["/pricing"],
        FINAL - timedelta(days=28), [100] + [2] * 28, [10] * 29, None,
    )  # fmt: skip

    response = await _post(
        api,
        workspace,
        project,
        owner,
        {
            "urls": [
                "/pricing",
                "https://example.com/blog/soc-guide",
                "https://other.example/x",
                "not a url",
                "https://example.com/not-a-page",
                "/pricing",
            ],
            "url_ids": [str(ids["/by-id"]), "999999999999"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(row["input"], row["outcome"]) for row in body["data"]] == [
        ("/pricing", "added"),
        ("https://example.com/blog/soc-guide", "already_tracked"),
        ("https://other.example/x", "wrong_host"),
        ("not a url", "invalid_url"),
        ("https://example.com/not-a-page", "not_crawled"),
        ("/pricing", "already_tracked"),
        (str(ids["/by-id"]), "added"),
        ("999999999999", "not_crawled"),
    ]
    added = body["data"][0]
    assert (added["url_id"], added["path"], added["clicks_28d"]) == (
        str(ids["/pricing"]),
        "/pricing",
        56,
    )
    assert body["data"][1]["url_id"] == str(ids["/blog/soc-guide"])
    assert body["data"][1]["clicks_28d"] is None
    assert (body["data"][2]["url_id"], body["data"][2]["path"]) == (None, None)
    assert body["meta"] == {"limit": 200, "tracked": 3, "added": 2}
    assert await _tracked_count(migrated, project) == 3
    [entry] = await audit_rows(migrated, workspace, "tracked_page.add")
    assert entry["after"] == {"url_ids": [str(ids["/pricing"]), str(ids["/by-id"])], "added": 2}


async def test_dry_run_writes_nothing_and_says_ok(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await connect(migrated, workspace, project)
    await seed_pages(migrated, workspace, project, {"/pricing": None})

    response = await _post(api, workspace, project, owner, {"urls": ["/pricing"], "dry_run": True})

    body = response.json()
    assert [row["outcome"] for row in body["data"]] == ["ok"]
    assert body["meta"] == {"limit": 200, "tracked": 0, "added": 0}
    assert await _tracked_count(migrated, project) == 0
    assert await audit_rows(migrated, workspace, "tracked_page.add") == []


async def test_a_body_with_neither_addresses_nor_ids_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)

    response = await _post(api, workspace, project, owner, {"urls": [], "url_ids": []})

    assert problem(response) == (422, "validation_failed")


async def test_the_limit_of_200(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await bulk_pages(migrated, workspace, project, 199, tracked=True)
    ids = await seed_pages(
        migrated, workspace, project, {"/one": None, "/two": None, "/three": None}
    )

    response = await _post(api, workspace, project, owner, {"urls": ["/one", "/two", "/three"]})

    body = response.json()
    assert [row["outcome"] for row in body["data"]] == ["added", "over_limit", "over_limit"]
    assert body["data"][2]["url_id"] == str(ids["/three"])
    assert body["meta"] == {"limit": 200, "tracked": 200, "added": 1}
    assert await _tracked_count(migrated, project) == 200


async def test_remove_and_ids(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await connect(migrated, workspace, project)
    ids = await seed_pages(migrated, workspace, project, {"/a": None, "/b": None, "/c": None})
    await track(migrated, workspace, project, list(ids.values()))
    await days(migrated, workspace, project, integration, ids["/a"], OCT, [1], [10], "2.0")

    response = await _post(
        api,
        workspace,
        project,
        owner,
        {"url_ids": [str(ids["/a"]), str(ids["/b"]), "424242"]},
        "remove",
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"data": {"removed": 2}}
    rows = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM fp.gsc_page_daily WHERE url_id = $1",
        ids["/a"],
    )
    assert rows["n"] == 1
    listed = await _get(api, workspace, project, owner, "ids")
    assert listed.json() == {"data": [str(ids["/c"])], "meta": {"limit": 200}}
    [entry] = await audit_rows(migrated, workspace, "tracked_page.remove")
    assert entry["after"] == {"url_ids": [str(ids["/a"]), str(ids["/b"])], "removed": 2}


async def test_suggestions_are_the_untracked_pages_with_the_most_clicks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await connect(migrated, workspace, project)
    ids = await seed_pages(
        migrated, workspace, project, {"/low": "Low", "/top": "Top", "/mid": None, "/old": None}
    )
    since = FINAL - timedelta(days=27)
    for path, clicks in (("/low", 50), ("/top", 400), ("/mid", 90)):
        await days(
            migrated,
            workspace,
            project,
            integration,
            ids[path],
            since,
            [clicks],
            [clicks * 10],
            None,
        )
    # Clicks before the last 28 final days do not count.
    await days(
        migrated, workspace, project, integration, ids["/old"], since - timedelta(days=1),
        [900], [9000], None,
    )  # fmt: skip
    await track(migrated, workspace, project, [ids["/top"]])

    response = await _get(api, workspace, project, owner, "suggestions")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["meta"] == {"state": "ok"}
    assert body["data"] == [
        {
            "url_id": str(ids["/mid"]),
            "url": "https://example.com/mid",
            "path": "/mid",
            "title": None,
            "clicks_28d": 90,
            "impressions_28d": 900,
        },
        {
            "url_id": str(ids["/low"]),
            "url": "https://example.com/low",
            "path": "/low",
            "title": "Low",
            "clicks_28d": 50,
            "impressions_28d": 500,
        },
    ]


async def test_suggestions_are_at_most_25(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    integration = await connect(migrated, workspace, project)
    await bulk_pages(
        migrated, workspace, project, 30, tracked=False, integration_id=integration, clicks=5
    )

    body = (await _get(api, workspace, project, owner, "suggestions")).json()

    assert len(body["data"]) == 25


async def test_suggestions_without_a_connection_are_empty(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _world(resources, migrated)
    await seed_pages(migrated, workspace, project, {"/pricing": None})

    body = (await _get(api, workspace, project, owner, "suggestions")).json()

    assert body == {"data": [], "meta": {"state": "not_connected"}}


async def test_a_viewer_cannot_add_or_remove(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, viewer = await _world(resources, migrated, "viewer")
    ids = await seed_pages(migrated, workspace, project, {"/pricing": None})
    await track(migrated, workspace, project, [ids["/pricing"]])

    added = await _post(api, workspace, project, viewer, {"urls": ["/pricing"]})
    removed = await _post(
        api, workspace, project, viewer, {"url_ids": [str(ids["/pricing"])]}, "remove"
    )

    assert problem(added) == (403, "forbidden")
    assert problem(removed) == (403, "forbidden")
    assert await _tracked_count(migrated, project) == 1
    assert (await _get(api, workspace, project, viewer, "ids")).status_code == 200
