"""One Google connection for Search Console and GA4: granular consent, the GA4 property list,
linking a GA4 property, and the connection-wide effects of re-auth, reconnect and disconnect."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.providers.google.client import (
    ACCOUNT_SUMMARIES_URL,
    ANALYTICS_SCOPE,
    SEARCH_CONSOLE_SCOPE,
    SITES_URL,
    TOKEN_URL,
)
from tests.api.auth.support import fetch
from tests.api.integrations.support import (
    Harness,
    World,
    connect,
    connected,
    integrations_page,
    location,
    make_project,
    make_world,
    project_url,
    workspace_url,
)
from tests.providers.google.fake_google import (
    ANALYTICS_ONLY,
    NO_PRODUCT,
    SEARCH_CONSOLE_ONLY,
    Account,
    AnalyticsAccount,
)

SITES = [("sc-domain:acme.example", "siteOwner"), ("sc-domain:other.example", "siteOwner")]
ANALYTICS: list[AnalyticsAccount] = [
    (
        "200",
        "Zeta Ltd",
        [("22", "Zeta shop", "PROPERTY_TYPE_ORDINARY")],
    ),
    (
        "100",
        "acme inc",
        [
            ("12", "Acme blog", "PROPERTY_TYPE_ORDINARY"),
            ("11", "Acme site", "PROPERTY_TYPE_ORDINARY"),
            ("13", "Acme roll-up", "PROPERTY_TYPE_ROLLUP"),
            ("14", "Acme odd", "PROPERTY_TYPE_SOMETHING_NEW"),
        ],
    ),
    ("300", "No properties yet", []),
]


async def _connections(h: Harness, world: World) -> list[dict[str, object]]:
    response = await h.api.get(
        workspace_url(world.workspace, "connections"), headers=world.owner.headers
    )
    assert response.status_code == 200, response.text
    rows: list[dict[str, object]] = response.json()["data"]
    return rows


def _properties_url(world: World, connection: str, kind: str) -> str:
    return workspace_url(world.workspace, "connections", connection, "properties", kind)


async def _choose(
    h: Harness,
    world: World,
    connection: str,
    kind: str,
    external_property: str,
    *,
    project_id: uuid.UUID | None = None,
) -> httpx.Response:
    return await h.api.post(
        f"/api/v1/workspaces/{world.workspace.id}/projects/{project_id or world.project_id}"
        "/integrations",
        json={"connection_id": connection, "kind": kind, "external_property": external_property},
        headers=world.owner.headers,
    )


async def _account(h: Harness) -> Account:
    return h.fake.account("a@example.com", SITES, ANALYTICS)


async def _connected_with(h: Harness, world: World, email: str, scopes: tuple[str, ...]) -> str:
    response = await connect(
        h, world, world.owner, h.fake.account(email, SITES, ANALYTICS), scopes=scopes
    )
    return location(response)[1]["connection_id"]


async def _statuses(h: Harness, world: World) -> dict[str, tuple[str, str | None]]:
    rows = await fetch(
        h.pg,
        "SELECT kind, status, last_error FROM fp.integrations WHERE workspace_id = $1",
        world.workspace.id,
    )
    return {row["kind"]: (row["status"], row["last_error"]) for row in rows}


# -- consent --------------------------------------------------------------------------------


async def test_a_full_grant_reaches_both_products(google: Harness) -> None:
    world = await make_world(google)
    await connected(google, world, await _account(google))

    (row,) = await _connections(google, world)

    assert row["product"] == "google"
    assert row["access"] == {"gsc": True, "ga4": True}


@pytest.mark.parametrize(
    ("scopes", "access"),
    [
        (SEARCH_CONSOLE_ONLY, {"gsc": True, "ga4": False}),
        (ANALYTICS_ONLY, {"gsc": False, "ga4": True}),
    ],
)
async def test_a_grant_of_one_product_is_accepted_and_says_which(
    google: Harness, scopes: tuple[str, ...], access: dict[str, bool]
) -> None:
    world = await make_world(google)

    response = await connect(google, world, world.owner, await _account(google), scopes=scopes)

    base, query = location(response)
    assert (base, set(query)) == (integrations_page(world), {"connection_id"})
    (row,) = await _connections(google, world)
    assert row["access"] == access
    assert set(row["scopes"]) == set(scopes)  # type: ignore[call-overload]


async def test_a_grant_of_neither_product_is_refused_even_with_a_refresh_token(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = await _account(google)

    response = await connect(google, world, world.owner, account, scopes=NO_PRODUCT)

    assert location(response) == (integrations_page(world), {"error": "scope_denied"})
    assert not google.fake.alive(account)
    assert await _connections(google, world) == []


# -- property lists ---------------------------------------------------------------------------


async def test_ga4_properties_are_listed_by_account_then_name_and_linked_ones_are_marked(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))
    assert (await _choose(google, world, connection, "ga4", "properties/11")).status_code == 201

    response = await google.api.get(
        _properties_url(world, connection, "ga4"), headers=world.owner.headers
    )

    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [(r["account_label"], r["label"]) for r in rows] == [
        ("acme inc", "Acme blog"),
        ("acme inc", "Acme odd"),
        ("acme inc", "Acme roll-up"),
        ("acme inc", "Acme site"),
        ("Zeta Ltd", "Zeta shop"),
    ]
    by_label = {r["label"]: r for r in rows}
    assert by_label["Acme site"]["external_property"] == "properties/11"
    assert by_label["Acme site"]["account_id"] == "accounts/100"
    assert by_label["Acme site"]["linked_project_id"] == str(world.project_id)
    assert by_label["Acme blog"]["linked_project_id"] is None
    assert by_label["Acme roll-up"]["property_type"] == "rollup"
    assert by_label["Acme odd"]["property_type"] == "unspecified"
    assert by_label["Acme blog"]["property_type"] == "ordinary"
    # No domain is matched and nothing is suggested for GA4
    assert all("suggested_project_id" not in r for r in rows)


async def test_a_kind_whose_permission_was_not_granted_is_refused_without_asking_google(
    google: Harness,
) -> None:
    world = await make_world(google)
    only_ga4 = await _connected_with(google, world, "one@example.com", ANALYTICS_ONLY)
    only_gsc = await _connected_with(google, world, "two@example.com", SEARCH_CONSOLE_ONLY)
    google.fake.calls.clear()

    sites = await google.api.get(
        _properties_url(world, only_ga4, "gsc"), headers=world.owner.headers
    )
    analytics = await google.api.get(
        _properties_url(world, only_gsc, "ga4"), headers=world.owner.headers
    )

    for response in (sites, analytics):
        assert (response.status_code, response.json()["code"]) == (409, "integration_scope_missing")
    assert "Search Console" in sites.json()["detail"]
    assert "GA4" in analytics.json()["detail"]
    assert google.fake.calls == []


async def test_the_search_console_list_still_works_on_a_combined_connection(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))

    response = await google.api.get(
        _properties_url(world, connection, "gsc"), headers=world.owner.headers
    )

    assert response.status_code == 200
    assert {r["external_property"] for r in response.json()["data"]} == {s for s, _ in SITES}
    assert google.fake.called(ACCOUNT_SUMMARIES_URL) == []


@pytest.mark.parametrize("status", [429, 503])
async def test_google_not_answering_the_account_list_is_a_503(google: Harness, status: int) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))
    google.fake.summaries_status = status

    response = await google.api.get(
        _properties_url(world, connection, "ga4"), headers=world.owner.headers
    )

    expected = "google_rate_limited" if status == 429 else "google_unavailable"
    assert (response.status_code, response.json()["code"]) == (503, expected)


async def test_a_disabled_analytics_api_is_reported_as_unavailable_not_as_a_crash(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))
    google.fake.summaries_status = 403

    response = await google.api.get(
        _properties_url(world, connection, "ga4"), headers=world.owner.headers
    )

    assert (response.status_code, response.json()["code"]) == (503, "google_unavailable")


async def test_only_a_manager_of_every_project_can_list_ga4_properties(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))

    editor = await google.api.get(
        _properties_url(world, connection, "ga4"), headers=world.editor.headers
    )

    assert editor.status_code == 403


# -- linking ----------------------------------------------------------------------------------


async def test_a_project_links_one_property_of_each_kind_to_the_same_connection(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))

    gsc = await _choose(google, world, connection, "gsc", "sc-domain:acme.example")
    ga4 = await _choose(google, world, connection, "ga4", "properties/11")

    assert (gsc.status_code, ga4.status_code) == (201, 201), ga4.text
    data = ga4.json()["data"]
    assert (data["kind"], data["external_property"], data["connection_id"]) == (
        "ga4",
        "properties/11",
        connection,
    )
    assert data["external_account"] == "a@example.com"
    assert data["sync"] is None
    assert data["connection_status"] == "active"
    listing = await google.api.get(project_url(world, "integrations"), headers=world.owner.headers)
    assert {row["kind"] for row in listing.json()["data"]} == {"gsc", "ga4"}
    (row,) = await _connections(google, world)
    assert row["integration_count"] == 2


async def test_a_project_has_one_live_property_per_kind(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))
    await _choose(google, world, connection, "ga4", "properties/11")

    second_ga4 = await _choose(google, world, connection, "ga4", "properties/12")
    first_gsc = await _choose(google, world, connection, "gsc", "sc-domain:acme.example")
    second_gsc = await _choose(google, world, connection, "gsc", "sc-domain:other.example")

    assert (second_ga4.status_code, first_gsc.status_code, second_gsc.status_code) == (
        409,
        201,
        409,
    )
    assert "GA4" in second_ga4.json()["detail"]
    assert "Search Console" in second_gsc.json()["detail"]


async def test_a_ga4_property_belongs_to_one_project_of_the_workspace(google: Harness) -> None:
    world = await make_world(google)
    other_project, _ = await make_project(google, world.workspace, host="other.example")
    connection = await connected(google, world, await _account(google))
    await _choose(google, world, connection, "ga4", "properties/11")

    taken = await _choose(
        google, world, connection, "ga4", "properties/11", project_id=other_project
    )
    free = await _choose(
        google, world, connection, "ga4", "properties/12", project_id=other_project
    )

    assert (taken.status_code, taken.json()["code"]) == (409, "duplicate")
    assert free.status_code == 201


@pytest.mark.parametrize(
    "external_property",
    ["properties/", "properties/abc", "accounts/100", "11", "properties/1/2", ""],
)
async def test_a_ga4_property_must_be_written_properties_and_a_number(
    google: Harness, external_property: str
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))

    response = await _choose(google, world, connection, "ga4", external_property)

    assert response.status_code == 422
    assert await _statuses(google, world) == {}


async def test_a_ga4_property_the_account_cannot_see_is_refused(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, await _account(google))

    response = await _choose(google, world, connection, "ga4", "properties/999")

    assert (response.status_code, response.json()["code"]) == (422, "property_not_accessible")


async def test_a_property_of_a_product_that_was_not_granted_is_refused(google: Harness) -> None:
    world = await make_world(google)
    only_gsc = await _connected_with(google, world, "two@example.com", SEARCH_CONSOLE_ONLY)
    only_ga4 = await _connected_with(google, world, "one@example.com", ANALYTICS_ONLY)
    google.fake.calls.clear()

    ga4 = await _choose(google, world, only_gsc, "ga4", "properties/11")
    gsc = await _choose(google, world, only_ga4, "gsc", "sc-domain:acme.example")

    assert [r.json()["code"] for r in (ga4, gsc)] == ["integration_scope_missing"] * 2
    assert [r.status_code for r in (ga4, gsc)] == [409, 409]
    assert google.fake.called(SITES_URL) == []
    assert google.fake.called(ACCOUNT_SUMMARIES_URL) == []
    assert google.fake.called(TOKEN_URL) == []


# -- the connection acts for both -------------------------------------------------------------


async def _both_linked(h: Harness, world: World) -> tuple[str, Account]:
    account = await _account(h)
    connection = await connected(h, world, account)
    assert (await _choose(h, world, connection, "gsc", "sc-domain:acme.example")).status_code == 201
    assert (await _choose(h, world, connection, "ga4", "properties/11")).status_code == 201
    return connection, account


async def test_a_dead_refresh_token_marks_every_integration_of_the_connection(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection, account = await _both_linked(google, world)
    google.fake.kill_refresh_token(account)

    response = await google.api.get(
        _properties_url(world, connection, "ga4"), headers=world.owner.headers
    )

    assert (response.status_code, response.json()["code"]) == (409, "integration_reauth_required")
    assert await _statuses(google, world) == {
        "gsc": ("reauth_required", "invalid_grant"),
        "ga4": ("reauth_required", "invalid_grant"),
    }
    (row,) = await _connections(google, world)
    assert row["status"] == "reauth_required"


async def test_a_disconnect_switches_off_both_properties_and_keeps_nothing_usable(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection, account = await _both_linked(google, world)

    response = await google.api.delete(
        workspace_url(world.workspace, "connections", connection), headers=world.owner.headers
    )

    assert response.status_code == 200
    assert response.json()["data"]["integration_count"] == 0
    assert await _statuses(google, world) == {"gsc": ("disabled", None), "ga4": ("disabled", None)}
    assert not google.fake.alive(account)


async def test_connecting_again_with_one_product_unticked_stops_that_products_property(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection, account = await _both_linked(google, world)

    response = await connect(google, world, world.owner, account, scopes=ANALYTICS_ONLY)

    assert location(response)[1] == {"connection_id": connection}
    assert await _statuses(google, world) == {
        "gsc": ("error", "scope_missing"),
        "ga4": ("active", None),
    }
    (row,) = await _connections(google, world)
    assert row["access"] == {"gsc": False, "ga4": True}
    # ... and connecting again with both brings it back
    google.fake.renew_refresh_token(account)
    await connect(google, world, world.owner, account)
    assert await _statuses(google, world) == {"gsc": ("active", None), "ga4": ("active", None)}


async def test_connecting_again_after_a_dead_token_revives_both_properties(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection, account = await _both_linked(google, world)
    google.fake.kill_refresh_token(account)
    await google.api.get(_properties_url(world, connection, "gsc"), headers=world.owner.headers)
    google.fake.renew_refresh_token(account)

    await connect(google, world, world.owner, account)

    assert await _statuses(google, world) == {"gsc": ("active", None), "ga4": ("active", None)}


def test_the_scopes_are_the_documented_read_only_ones() -> None:
    assert SEARCH_CONSOLE_SCOPE.endswith("/webmasters.readonly")
    assert ANALYTICS_SCOPE.endswith("/analytics.readonly")
