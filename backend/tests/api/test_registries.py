"""Registries every signed-in user may read (docs/19 section 3.2.5): locations and domain
categories."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from sightline.api.pagination import encode_cursor
from sightline.api.resources import Resources
from tests.api.auth.support import cookie, execute, make_user, open_session
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

LOCATIONS = "/api/v1/locations"


@pytest.fixture
async def headers(resources: Resources, migrated: PostgresServer) -> dict[str, str]:
    token, _ = await open_session(resources, await make_user(migrated))
    return cookie(token)


@pytest.fixture
async def located(migrated: PostgresServer) -> None:
    """The nine locations of the fixture, one more that is no longer listed, and one a
    second provider can collect AI answers in."""
    await execute(migrated, "UPDATE core.projects SET default_location_id = NULL")
    await execute(migrated, "DELETE FROM core.provider_location_map")
    await execute(migrated, "DELETE FROM core.locations")
    body = (FIXTURES / "locations.json").read_text()
    await execute(
        migrated,
        """
        WITH listed AS (
            SELECT * FROM jsonb_to_recordset(($1::jsonb)->'tasks'->0->'result') AS t(
                location_code int, location_name text, location_code_parent int,
                country_iso_code text, location_type text)
        )
        INSERT INTO core.locations (id, name, country_iso, location_type, parent_id)
        SELECT location_code, location_name, country_iso_code, location_type,
               location_code_parent FROM listed ORDER BY location_code_parent NULLS FIRST
        """,
        body,
    )
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type, is_active) "
        "VALUES (9999, 'Gone', 'US', 'City', false)",
    )
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) SELECT 'dataforseo', id, id::text, '{serp}' FROM core.locations",
    )
    # Another provider's surfaces add to a location's.
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) VALUES ('internal', 2840, 'us', '{llm_scraper}')",
    )


async def _names(
    api: httpx.AsyncClient, headers: dict[str, str], params: dict[str, Any]
) -> list[str]:
    response = await api.get(LOCATIONS, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [row["name"] for row in response.json()["data"]]


@pytest.mark.usefixtures("located")
async def test_locations_are_listed_by_name_and_paged(
    api: httpx.AsyncClient, headers: dict[str, str]
) -> None:
    seen: list[dict[str, Any]] = []
    params: dict[str, Any] = {"limit": 4}
    while True:
        body = (await api.get(LOCATIONS, params=params, headers=headers)).json()
        seen += body["data"]
        if not body["page"]["has_more"]:
            break
        params = {"limit": 4, "cursor": body["page"]["next_cursor"]}

    assert [row["name"] for row in seen] == sorted(row["name"] for row in seen)
    assert len(seen) == 9  # the inactive one is not listed
    united_states = next(row for row in seen if row["location_id"] == 2840)
    assert united_states == {
        "location_id": 2840,
        "name": "United States",
        "country_iso": "US",
        "location_type": "Country",
        "parent_id": None,
        "supports": ["llm_scraper", "serp"],
    }


@pytest.mark.usefixtures("located")
async def test_locations_filter_by_text_country_type_and_surface(
    api: httpx.AsyncClient, headers: dict[str, str]
) -> None:
    assert await _names(api, headers, {"filter[location_type]": "Country"}) == [
        "India",
        "United Kingdom",
        "United States",
    ]
    assert await _names(api, headers, {"filter[q]": "francisco"}) == [
        "San Francisco,California,United States"
    ]
    assert await _names(api, headers, {"filter[country_iso]": "gb"}) == [
        "England,United Kingdom",
        "London,England,United Kingdom",
        "United Kingdom",
    ]
    assert await _names(api, headers, {"filter[supports]": "llm_scraper"}) == ["United States"]
    assert await _names(api, headers, {"filter[q]": "%"}) == []


@pytest.mark.usefixtures("located")
async def test_a_location_cursor_only_works_with_its_own_filters(
    api: httpx.AsyncClient, headers: dict[str, str]
) -> None:
    first = await api.get(LOCATIONS, params={"limit": 1}, headers=headers)
    cursor = first.json()["page"]["next_cursor"]
    scope = {
        "sort": "name",
        "q": None,
        "country_iso": None,
        "location_type": None,
        "supports": None,
    }
    for params in (
        {"cursor": cursor, "filter[q]": "a"},
        # The right filters, and a key this list never writes.
        {"cursor": encode_cursor(["India", "2356"], scope=scope)},
    ):
        response = await api.get(LOCATIONS, params=params, headers=headers)
        assert (response.status_code, response.json()["code"]) == (400, "invalid_cursor")


async def test_the_domain_categories_of_doc_14_are_listed(
    api: httpx.AsyncClient, headers: dict[str, str]
) -> None:
    response = await api.get("/api/v1/domain-categories", headers=headers)
    assert response.status_code == 200
    rows = response.json()["data"]
    assert len(rows) == 15
    assert rows[0] == {
        "code": "affiliate",
        "label": "Affiliate",
        "description": "Sites that earn from referral links",
    }


async def test_registries_need_a_session(api: httpx.AsyncClient) -> None:
    for path in (LOCATIONS, "/api/v1/domain-categories"):
        response = await api.get(path)
        assert (response.status_code, response.json()["code"]) == (401, "unauthenticated")
