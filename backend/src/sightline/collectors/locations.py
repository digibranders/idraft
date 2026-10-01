"""The location sync (plan decision D8; docs/06 section 4): a provider's location list into
`core.locations` and `core.provider_location_map`, as the worker.

Locations are global dictionaries, so this runs outside any workspace. A location the list no
longer has is deactivated, not deleted: projects may name it. A list far shorter than what is
active (a broken answer) deactivates nothing.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import ARRAY, Integer, and_, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.db.tables import locations, provider_location_map
from sightline.providers.dataforseo.locations import LocationList, ProviderLocation

DATAFORSEO: Final = "dataforseo"
# Rows per statement: six values a row stays far below PostgreSQL's 32,767 parameters.
_BATCH: Final = 2_000
# A new list shorter than this share of the active locations is taken to be broken.
_DEACTIVATE_FROM_SHARE: Final = 0.5


@dataclass(frozen=True, slots=True)
class LocationSyncReport:
    listed: int
    skipped: int  # entries the provider's list had that could not be read
    deactivated: int
    deactivation_skipped: bool  # the list was too short to trust for deactivation


def parents_first(listed: Sequence[ProviderLocation]) -> list[tuple[ProviderLocation, int | None]]:
    """Each location with the parent it is stored under, parents before their children. A
    parent the list does not have, or one that would close a cycle, is left out."""
    by_code = {location.code: location for location in listed}
    depth: dict[int, int] = {}
    parent_of: dict[int, int | None] = {}
    for location in listed:
        chain: list[int] = []
        current: int | None = location.code
        while current is not None and current in by_code and current not in depth:
            if current in chain:  # a cycle: cut it where it closes
                parent_of[chain[-1]] = None
                break
            chain.append(current)
            current = by_code[current].parent_code
        base = depth.get(current, -1) if current is not None else -1
        for code in reversed(chain):
            parent = by_code[code].parent_code
            if code not in parent_of:
                parent_of[code] = parent if parent in by_code else None
            base = base + 1 if parent_of[code] is not None else 0
            depth[code] = base
    return sorted(
        ((location, parent_of[location.code]) for location in listed),
        key=lambda pair: depth[pair[0].code],
    )


async def sync_locations(
    sessions: async_sessionmaker[AsyncSession],
    listed: LocationList,
    *,
    provider_code: str = DATAFORSEO,
) -> LocationSyncReport:
    """Write the list in one transaction."""
    if not listed.locations:
        return LocationSyncReport(
            listed=0, skipped=listed.skipped, deactivated=0, deactivation_skipped=False
        )
    ordered = parents_first(listed.locations)
    codes = [location.code for location in listed.locations]
    async with sessions() as db, db.begin():
        for start in range(0, len(ordered), _BATCH):
            batch = ordered[start : start + _BATCH]
            await _write_locations(db, batch)
            await _write_map(db, [location for location, _ in batch], provider_code)
        deactivated, skipped = await _deactivate_unlisted(db, codes, provider_code)
    return LocationSyncReport(
        listed=len(codes),
        skipped=listed.skipped,
        deactivated=deactivated,
        deactivation_skipped=skipped,
    )


async def _write_locations(
    db: AsyncSession, batch: Sequence[tuple[ProviderLocation, int | None]]
) -> None:
    statement = upsert(locations).values(
        [
            {
                "id": location.code,
                "name": location.name,
                "country_iso": location.country_iso,
                "location_type": location.location_type,
                "parent_id": parent,
                "is_active": True,
            }
            for location, parent in batch
        ]
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[locations.c.id],
            set_={
                "name": statement.excluded.name,
                "country_iso": statement.excluded.country_iso,
                "location_type": statement.excluded.location_type,
                "parent_id": statement.excluded.parent_id,
                "is_active": True,
            },
        )
    )


async def _write_map(
    db: AsyncSession, batch: Sequence[ProviderLocation], provider_code: str
) -> None:
    statement = upsert(provider_location_map).values(
        [
            {
                "provider_code": provider_code,
                "location_id": location.code,
                "provider_value": str(location.code),
                "supports": ["serp"],
            }
            for location in batch
        ]
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[
                provider_location_map.c.provider_code,
                provider_location_map.c.location_id,
            ],
            set_={"provider_value": statement.excluded.provider_value},
        )
    )


async def _deactivate_unlisted(
    db: AsyncSession, codes: Sequence[int], provider_code: str
) -> tuple[int, bool]:
    """Deactivate the provider's locations the list no longer has. Returns how many, and
    whether the list was too short to trust for this."""
    mapped = (
        select(provider_location_map.c.location_id)
        .where(provider_location_map.c.provider_code == provider_code)
        .scalar_subquery()
    )
    active: int = (
        await db.execute(
            select(func.count())
            .select_from(locations)
            .where(locations.c.is_active, locations.c.id.in_(mapped))
        )
    ).scalar_one()
    if len(codes) < active * _DEACTIVATE_FROM_SHARE:
        return 0, True
    listed = literal(list(codes), ARRAY(Integer))
    result = await db.execute(
        update(locations)
        .where(
            and_(
                locations.c.is_active,
                locations.c.id.in_(mapped),
                locations.c.id != func.all(listed),
            )
        )
        .values(is_active=False)
        .returning(locations.c.id)
    )
    return len(result.all()), False
