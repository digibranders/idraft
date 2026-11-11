"""The properties a connection can see, and linking one to a project (docs/18 section 4.1)."""

from __future__ import annotations

import uuid

import httpx
import pytest

from idraft.api.integrations import properties as logic
from tests.api.auth.support import add_member, cookie, fetch, make_user, open_session
from tests.api.integrations.support import (
    Caller,
    Harness,
    World,
    connect,
    connected,
    make_caller,
    make_project,
    make_world,
    project_url,
    workspace_url,
)

SITES = [
    ("https://www.acme.example/", "siteFullUser"),
    ("sc-domain:acme.example", "siteOwner"),
    ("https://acme.example/blog/", "siteRestrictedUser"),
    ("sc-domain:other.example", "siteUnverifiedUser"),
    ("https://elsewhere.example/", "siteOwner"),
]


async def _properties(
    h: Harness, world: World, connection_id: str, caller: Caller | None = None
) -> httpx.Response:
    return await h.api.get(
        workspace_url(world.workspace, "connections", connection_id, "properties", "gsc"),
        headers=(caller or world.owner).headers,
    )


async def _choose(
    h: Harness,
    world: World,
    connection_id: str,
    external_property: str,
    caller: Caller | None = None,
) -> httpx.Response:
    return await h.api.post(
        project_url(world, "integrations"),
        json={
            "connection_id": connection_id,
            "kind": "gsc",
            "external_property": external_property,
        },
        headers=(caller or world.owner).headers,
    )


async def test_properties_carry_their_type_and_permission_and_unverified_ones_are_disabled(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    response = await _properties(google, world, connection)

    assert response.status_code == 200
    by_property = {row["external_property"]: row for row in response.json()["data"]}
    assert set(by_property) == {site for site, _ in SITES}
    domain = by_property["sc-domain:acme.example"]
    assert (domain["property_type"], domain["label"], domain["permission_level"]) == (
        "domain",
        "acme.example",
        "siteOwner",
    )
    prefix = by_property["https://www.acme.example/"]
    assert (prefix["property_type"], prefix["label"]) == ("url_prefix", "https://www.acme.example/")
    assert by_property["sc-domain:other.example"]["is_selectable"] is False
    assert all(
        row["is_selectable"] for key, row in by_property.items() if key != "sc-domain:other.example"
    )
    # Domain properties are listed before URL prefixes
    kinds = [row["property_type"] for row in response.json()["data"]]
    assert kinds == sorted(kinds, key=lambda kind: kind != "domain")


async def test_the_property_matching_the_projects_domain_is_suggested_and_a_domain_wins(
    google: Harness,
) -> None:
    world = await make_world(google, host="www.acme.example")
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    rows = (await _properties(google, world, connection)).json()["data"]

    suggested = {row["external_property"] for row in rows if row["suggested_project_id"]}
    assert suggested == {"sc-domain:acme.example"}
    (row,) = [r for r in rows if r["suggested_project_id"]]
    assert row["suggested_project_id"] == str(world.project_id)


async def test_a_url_prefix_is_suggested_when_there_is_no_domain_property(
    google: Harness,
) -> None:
    world = await make_world(google, host="acme.example")
    sites = [
        ("http://acme.example/", "siteOwner"),
        ("https://www.acme.example/", "siteOwner"),
        ("https://acme.example/blog/", "siteOwner"),
    ]
    connection = await connected(google, world, google.fake.account("a@example.com", sites))

    rows = (await _properties(google, world, connection)).json()["data"]

    suggested = [r["external_property"] for r in rows if r["suggested_project_id"]]
    # https before http, and the site root before a section
    assert suggested == ["https://www.acme.example/"]


async def test_an_unverified_property_is_never_suggested(google: Harness) -> None:
    world = await make_world(google, host="other.example")
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))

    rows = (await _properties(google, world, connection)).json()["data"]

    assert [r for r in rows if r["suggested_project_id"]] == []


async def test_a_property_linked_to_a_project_is_marked_and_a_second_one_of_the_site_warns(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    assert (
        await _choose(google, world, connection, "https://www.acme.example/")
    ).status_code == 201

    rows = {
        r["external_property"]: r
        for r in (await _properties(google, world, connection)).json()["data"]
    }

    assert rows["https://www.acme.example/"]["linked_project_id"] == str(world.project_id)
    assert rows["https://www.acme.example/"]["overlap_warning"] is None
    warning = rows["sc-domain:acme.example"]["overlap_warning"]
    assert warning == {
        "external_property": "https://www.acme.example/",
        "project_id": str(world.project_id),
    }
    assert rows["https://elsewhere.example/"]["overlap_warning"] is None


async def test_an_account_with_no_property_lists_none(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", []))

    response = await _properties(google, world, connection)

    assert response.json() == {"data": []}


async def test_a_dead_refresh_token_marks_the_connection_and_its_properties_for_reauth(
    google: Harness,
) -> None:
    world = await make_world(google)
    account = google.fake.account("a@example.com", SITES)
    connection = await connected(google, world, account)
    assert (await _choose(google, world, connection, "sc-domain:acme.example")).status_code == 201
    google.fake.kill_refresh_token(account)

    response = await _properties(google, world, connection)

    assert (response.status_code, response.json()["code"]) == (409, "integration_reauth_required")
    (row,) = await fetch(
        google.pg,
        "SELECT c.status, c.last_error_code, i.status AS integration, i.last_error "
        "FROM fp.connections c JOIN fp.integrations i ON i.connection_id = c.id "
        "WHERE c.id = $1",
        uuid.UUID(connection),
    )
    assert tuple(row) == ("reauth_required", "invalid_grant", "reauth_required", "invalid_grant")
    again = await _properties(google, world, connection)
    assert again.json()["code"] == "integration_reauth_required"
    # The same account connecting again repairs both
    google.fake.renew_refresh_token(account)
    await connect(google, world, world.owner, account)
    (healed,) = await fetch(
        google.pg,
        "SELECT c.status, i.status AS integration FROM fp.connections c "
        "JOIN fp.integrations i ON i.connection_id = c.id WHERE c.id = $1",
        uuid.UUID(connection),
    )
    assert tuple(healed) == ("active", "active")


@pytest.mark.parametrize(
    ("setting", "value", "code"),
    [("sites_status", 503, "google_unavailable"), ("sites_status", 429, "google_rate_limited")],
)
async def test_google_trouble_is_a_503_with_its_own_code(
    google: Harness, setting: str, value: int, code: str
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    setattr(google.fake, setting, value)

    response = await _properties(google, world, connection)

    assert (response.status_code, response.json()["code"]) == (503, code)
    # Nothing is wrong with the connection itself
    (row,) = await fetch(
        google.pg, "SELECT status FROM fp.connections WHERE id = $1", uuid.UUID(connection)
    )
    assert row["status"] == "active"


async def test_access_tokens_are_never_stored(google: Harness) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    await _properties(google, world, connection)

    redis = google.resources.redis
    dump = " ".join([str(await redis.get(key)) for key in await redis.keys("*")])
    tables = ""
    for table in ("ops.secrets", "fp.connections", "fp.integrations", "ops.audit_logs"):
        tables += " ".join(
            row[0] for row in await fetch(google.pg, f"SELECT t::text FROM {table} t")
        )
    assert "ya29" not in dump + tables


@pytest.mark.parametrize("role", ["editor", "analyst", "viewer", "billing"])
async def test_only_managers_list_properties_and_connections(google: Harness, role: str) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    caller = await make_caller(google, world.workspace, role)

    properties = await _properties(google, world, connection, caller)
    listing = await google.api.get(
        workspace_url(world.workspace, "connections"), headers=caller.headers
    )

    assert (properties.status_code, listing.status_code) == (403, 403)


async def test_connections_are_listed_with_who_connected_and_how_many_properties(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(
        google, world, google.fake.account("a@example.com", SITES), world.admin
    )
    await _choose(google, world, connection, "sc-domain:acme.example")

    response = await google.api.get(
        workspace_url(world.workspace, "connections"),
        params={"filter[product]": "google", "filter[status]": "active"},
        headers=world.owner.headers,
    )

    (row,) = response.json()["data"]
    assert row["connection_id"] == connection
    assert (row["product"], row["auth_method"], row["status"]) == ("google", "oauth", "active")
    assert row["subject_label"] == "a@example.com"
    assert row["connected_by"]["user_id"] == str(world.admin.user_id)
    assert row["integration_count"] == 1
    assert response.json()["page"] == {"offset": 0, "limit": 50, "total": 1}
    none = await google.api.get(
        workspace_url(world.workspace, "connections"),
        params={"filter[status]": "revoked"},
        headers=world.owner.headers,
    )
    assert none.json()["data"] == []


async def test_a_manager_limited_to_some_projects_does_not_manage_workspace_credentials(
    google: Harness,
) -> None:
    world = await make_world(google)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    user = await make_user(google.pg)
    await add_member(google.pg, world.workspace, user, "admin", [world.project_id])
    token, _ = await open_session(google.resources, user, fresh=True)

    response = await google.api.get(
        workspace_url(world.workspace, "connections", connection, "properties", "gsc"),
        headers=cookie(token),
    )

    start_here = await google.api.post(
        project_url(world, "integrations", "google", "authorize"), headers=cookie(token)
    )
    link = await google.api.post(
        project_url(world, "integrations"),
        json={
            "connection_id": connection,
            "kind": "gsc",
            "external_property": "sc-domain:acme.example",
        },
        headers=cookie(token),
    )
    assert (response.status_code, start_here.status_code, link.status_code) == (403, 403, 403)


def test_a_domain_property_covers_its_subdomains_but_not_a_lookalike() -> None:
    domain = logic.parse_property("sc-domain:acme.example", "siteOwner")
    blog = logic.parse_property("https://blog.acme.example/", "siteOwner")
    lookalike = logic.parse_property("https://notacme.example/", "siteOwner")
    linked = {blog.external_property: uuid.uuid4()}

    assert logic.overlapping(domain, linked) is not None
    assert logic.overlapping(lookalike, {domain.external_property: uuid.uuid4()}) is None


def test_the_same_property_does_not_overlap_itself() -> None:
    prop = logic.parse_property("sc-domain:acme.example", "siteOwner")
    assert logic.overlapping(prop, {prop.external_property: uuid.uuid4()}) is None


def test_two_projects_sharing_a_domain_do_not_get_the_same_suggestion() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()
    domain = logic.ProjectDomain(first, "acme.example", "acme.example")
    twin = logic.ProjectDomain(second, "www.acme.example", "acme.example")
    props = [
        logic.parse_property("sc-domain:acme.example", "siteOwner"),
        logic.parse_property("https://www.acme.example/", "siteOwner"),
    ]

    assert logic.suggestions([domain, twin], props) == {
        "sc-domain:acme.example": first,
        "https://www.acme.example/": second,
    }


async def test_a_project_without_a_primary_domain_gets_no_suggestion(google: Harness) -> None:
    world = await make_world(google, host=None)
    connection = await connected(google, world, google.fake.account("a@example.com", SITES))
    other, _ = await make_project(google, world.workspace, host="elsewhere.example")

    rows = (await _properties(google, world, connection)).json()["data"]

    assert {
        r["external_property"]: r["suggested_project_id"] for r in rows if r["suggested_project_id"]
    } == {"https://elsewhere.example/": str(other)}
