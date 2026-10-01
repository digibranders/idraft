"""The location sync (plan decision D8): DataForSEO's list into `core.locations` and the
provider map, as the worker."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.locations import sync_locations
from sightline.providers.dataforseo.locations import LocationList, ProviderLocation, read_locations
from tests.api.auth.support import clear_locations, execute, fetch
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import fixture_bytes


@pytest.fixture
async def no_locations(migrated: PostgresServer) -> None:
    """Locations are global, so each test starts without any."""
    await clear_locations(migrated)


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
async def test_many_locations_are_written_in_batches_parents_first(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    """Children listed before their parent, more of them than one statement holds: the
    parent must be written in an earlier batch."""
    listed = LocationList(
        locations=(*(_location(code, parent=1) for code in range(2, 5002)), _location(1)),
        skipped=0,
    )
    report = await sync_locations(worker_db, listed)
    assert report.listed == 5001
    count = await fetch(migrated, "SELECT count(*) AS n FROM core.locations WHERE is_active")
    assert count[0]["n"] == 5001


@pytest.mark.usefixtures("no_locations")
async def test_a_second_sync_rewrites_every_field(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    await sync_locations(
        worker_db, LocationList(locations=(_location(1), _location(2), _location(3, 1)), skipped=0)
    )
    moved = ProviderLocation(
        code=3, name="Moved", parent_code=2, country_iso="GB", location_type="Region"
    )
    await sync_locations(
        worker_db, LocationList(locations=(_location(1), _location(2), moved), skipped=0)
    )
    rows = await fetch(
        migrated,
        "SELECT name, parent_id, country_iso, location_type FROM core.locations WHERE id = 3",
    )
    assert [tuple(row) for row in rows] == [("Moved", 2, "GB", "Region")]


@pytest.mark.usefixtures("no_locations")
async def test_only_the_providers_own_locations_are_deactivated(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    await sync_locations(
        worker_db, LocationList(locations=tuple(_location(c) for c in range(1, 5)), skipped=0)
    )
    await execute(
        migrated,
        "INSERT INTO core.locations (id, name, country_iso, location_type) "
        "VALUES (100, 'Elsewhere', 'US', 'City')",
    )
    await execute(
        migrated,
        "INSERT INTO core.provider_location_map (provider_code, location_id, provider_value, "
        "supports) VALUES ('internal', 100, '100', '{llm_scraper}')",
    )
    report = await sync_locations(
        worker_db, LocationList(locations=tuple(_location(c) for c in range(1, 4)), skipped=0)
    )
    active = {row[0]: row[3] for row in await _rows(migrated)}
    assert report.deactivated == 1
    assert (active[4], active[100]) == (False, True)


@pytest.mark.usefixtures("no_locations")
async def test_half_the_active_list_is_trusted_and_inactive_ones_do_not_count(
    worker_db: async_sessionmaker[AsyncSession],
) -> None:
    def first(count: int) -> LocationList:
        return LocationList(locations=tuple(_location(c) for c in range(1, count + 1)), skipped=0)

    await sync_locations(worker_db, first(100))
    assert (await sync_locations(worker_db, first(50))).deactivated == 50
    # 50 are active now, so 25 is half of them, not a quarter of every row.
    assert (await sync_locations(worker_db, first(25))).deactivated == 25


@pytest.mark.usefixtures("no_locations")
async def test_unreadable_entries_stop_deactivation(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    """An entry not read may be a location still listed."""
    await sync_locations(
        worker_db, LocationList(locations=tuple(_location(c) for c in range(1, 11)), skipped=0)
    )
    report = await sync_locations(
        worker_db, LocationList(locations=tuple(_location(c) for c in range(1, 10)), skipped=1)
    )
    assert (report.deactivated, report.deactivation_skipped) == (0, True)
    assert all(row[3] for row in await _rows(migrated))


@pytest.mark.usefixtures("no_locations")
async def test_surfaces_added_to_a_location_are_kept_and_serp_comes_back(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    await sync_locations(worker_db, LocationList(locations=(_location(1),), skipped=0))
    await execute(migrated, "UPDATE core.provider_location_map SET supports = '{llm_scraper}'")
    await sync_locations(worker_db, LocationList(locations=(_location(1),), skipped=0))
    rows = await fetch(migrated, "SELECT supports FROM core.provider_location_map")
    assert [row["supports"] for row in rows] == [["llm_scraper", "serp"]]


@pytest.mark.usefixtures("no_locations")
async def test_a_code_given_twice_keeps_its_first_entry(
    worker_db: async_sessionmaker[AsyncSession], migrated: PostgresServer
) -> None:
    listed = LocationList(
        locations=(_location(1, name="First"), _location(1, name="Second")), skipped=0
    )
    assert (await sync_locations(worker_db, listed)).listed == 1
    assert [row[1] for row in await _rows(migrated)] == ["First"]
