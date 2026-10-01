"""The location sync (plan decision D8): DataForSEO's list into `core.locations` and the
provider map, as the worker."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.locations import sync_locations
from sightline.providers.dataforseo.locations import LocationList, ProviderLocation, read_locations
from tests.api.auth.support import execute, fetch
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import fixture_bytes


@pytest.fixture
async def no_locations(migrated: PostgresServer) -> None:
    """Locations are global, so each test starts without any."""
    await execute(migrated, "UPDATE core.projects SET default_location_id = NULL")
    await execute(migrated, "DELETE FROM core.provider_location_map")
    await execute(migrated, "DELETE FROM core.locations")


def _location(code: int, parent: int | None = None, name: str | None = None) -> ProviderLocation:
    return ProviderLocation(
        code=code,
        name=name or f"Place {code}",
        parent_code=parent,
        country_iso="US",
        location_type="City" if parent else "Country",
    )


async def _rows(pg: PostgresServer) -> list[tuple[int, str, int | None, bool]]:
    rows = await fetch(pg, "SELECT id, name, parent_id, is_active FROM core.locations ORDER BY id")
    return [(row["id"], row["name"], row["parent_id"], row["is_active"]) for row in rows]


@pytest.mark.usefixtures("no_locations")
async def test_the_fixture_fills_locations_and_the_provider_map(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    report = await sync_locations(worker_db, read_locations(fixture_bytes("locations")))

    assert (report.listed, report.deactivated, report.deactivation_skipped) == (9, 0, False)
    rows = await _rows(migrated)
    assert (1014221, "San Francisco,California,United States", 21137, True) in rows
    mapped = await fetch(
        migrated,
        "SELECT provider_code, provider_value, supports FROM core.provider_location_map "
        "WHERE location_id = 2840",
    )
    assert [(m["provider_code"], m["provider_value"], m["supports"]) for m in mapped] == [
        ("dataforseo", "2840", ["serp"])
    ]


@pytest.mark.usefixtures("no_locations")
async def test_children_listed_before_parents_and_unknown_parents_are_handled(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    listed = LocationList(
        locations=(
            _location(3, parent=2),
            _location(2, parent=1),
            _location(1),
            # A parent the list does not have is left out rather than refused.
            _location(4, parent=999),
            # A cycle cannot be stored as one.
            _location(5, parent=6),
            _location(6, parent=5),
        ),
        skipped=0,
    )

    await sync_locations(worker_db, listed)

    parents = {row[0]: row[2] for row in await _rows(migrated)}
    assert (parents[3], parents[2], parents[1]) == (2, 1, None)
    assert parents[4] is None
    assert sorted([parents[5], parents[6]], key=lambda value: value is None) in (
        [6, None],
        [5, None],
    )


@pytest.mark.usefixtures("no_locations")
async def test_a_second_sync_updates_and_deactivates_what_is_no_longer_listed(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    await sync_locations(
        worker_db,
        LocationList(locations=tuple(_location(code) for code in range(1, 11)), skipped=0),
    )
    renamed = _location(1, name="Renamed")
    report = await sync_locations(
        worker_db,
        LocationList(locations=(renamed, *(_location(code) for code in range(2, 10))), skipped=0),
    )

    assert report.deactivated == 1
    rows = {row[0]: row for row in await _rows(migrated)}
    assert rows[1][1] == "Renamed"
    assert rows[10][3] is False
    # Listed again, it comes back.
    await sync_locations(
        worker_db, LocationList(locations=tuple(_location(c) for c in range(1, 11)), skipped=0)
    )
    assert {row[0]: row[3] for row in await _rows(migrated)}[10] is True


@pytest.mark.usefixtures("no_locations")
async def test_a_list_far_shorter_than_before_deactivates_nothing(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    """A broken answer must not switch off most locations."""
    await sync_locations(
        worker_db,
        LocationList(locations=tuple(_location(code) for code in range(1, 101)), skipped=0),
    )
    report = await sync_locations(
        worker_db, LocationList(locations=tuple(_location(c) for c in range(1, 40)), skipped=0)
    )

    assert (report.deactivated, report.deactivation_skipped) == (0, True)
    assert all(row[3] for row in await _rows(migrated))


@pytest.mark.usefixtures("no_locations")
async def test_an_empty_list_changes_nothing(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    await sync_locations(worker_db, LocationList(locations=(_location(1),), skipped=0))
    report = await sync_locations(worker_db, LocationList(locations=(), skipped=3))
    assert (report.listed, report.skipped, report.deactivated) == (0, 3, 0)
    assert [row[3] for row in await _rows(migrated)] == [True]


@pytest.mark.usefixtures("no_locations")
async def test_many_locations_are_written_in_batches(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    listed = LocationList(
        locations=(_location(1), *(_location(code, parent=1) for code in range(2, 5002))),
        skipped=0,
    )
    report = await sync_locations(worker_db, listed)
    assert report.listed == 5001
    count = await fetch(migrated, "SELECT count(*) AS n FROM core.locations WHERE is_active")
    assert count[0]["n"] == 5001
