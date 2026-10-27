"""Registries every signed-in user may read (docs/19-api-specification.md section 3.2.5): the
locations collection can target, and the domain categories of doc 14.

Both are global dictionaries, read outside any workspace. Only active locations are listed: one
the provider no longer has is kept for the projects that name it, and offered to no one.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import literal, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.auth.dependencies import CurrentSession
from idraft.api.pagination import (
    Cursor,
    CursorPageInfo,
    decode_cursor,
    encode_cursor,
    invalid_cursor,
)
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.common import QueryText
from idraft.api.schemas.registries import (
    DomainCategory,
    DomainCategoryList,
    Location,
    LocationPage,
)
from idraft.db.tables import domain_categories, locations, provider_location_map

router = APIRouter(prefix="/api/v1", tags=["registries"])

Surface = Literal["serp", "ai_mode", "llm_scraper"]
# Location ids are an `integer` column.
LOCATION_ID_MAX = 2_147_483_647


async def _supports(db: AsyncSession, location_ids: Sequence[int]) -> dict[int, set[str]]:
    """Every surface any provider can collect at each location."""
    found: dict[int, set[str]] = {location_id: set() for location_id in location_ids}
    rows = await db.execute(
        select(provider_location_map.c.location_id, provider_location_map.c.supports).where(
            provider_location_map.c.location_id.in_(location_ids)
        )
    )
    for row in rows:
        found[row.location_id].update(row.supports)
    return found


def _contains(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/locations", summary="Locations collection can target, by name")
async def list_locations(
    session: CurrentSession,
    page: Cursor,
    resources: Annotated[Resources, Depends(get_resources)],
    q: Annotated[QueryText | None, Query(alias="filter[q]")] = None,
    country_iso: Annotated[
        str | None, Query(alias="filter[country_iso]", pattern=r"^[A-Za-z]{2}$")
    ] = None,
    location_type: Annotated[QueryText | None, Query(alias="filter[location_type]")] = None,
    supports: Annotated[Surface | None, Query(alias="filter[supports]")] = None,
) -> LocationPage:
    country = None if country_iso is None else country_iso.upper()
    scope = {
        "sort": "name",
        "q": q,
        "country_iso": country,
        "location_type": location_type,
        "supports": supports,
    }
    statement = select(
        locations.c.id,
        locations.c.name,
        locations.c.country_iso,
        locations.c.location_type,
        locations.c.parent_id,
    ).where(locations.c.is_active)
    if q is not None:
        statement = statement.where(locations.c.name.ilike(_contains(q), escape="\\"))
    if country is not None:
        statement = statement.where(locations.c.country_iso == country)
    if location_type is not None:
        statement = statement.where(locations.c.location_type == location_type)
    if supports is not None:
        statement = statement.where(
            select(provider_location_map.c.location_id)
            .where(
                provider_location_map.c.location_id == locations.c.id,
                provider_location_map.c.supports.contains([supports]),
            )
            .exists()
        )
    if page.cursor is not None:
        key = decode_cursor(page.cursor, scope=scope)
        if (
            len(key) != 2
            or not isinstance(key[0], str)
            or not isinstance(key[1], int)
            or not 0 < key[1] <= LOCATION_ID_MAX
        ):
            raise invalid_cursor()
        statement = statement.where(
            tuple_(locations.c.name, locations.c.id) > tuple_(literal(key[0]), literal(key[1]))
        )
    statement = statement.order_by(locations.c.name, locations.c.id).limit(page.limit + 1)
    async with resources.sessions() as db, db.begin():
        rows = (await db.execute(statement)).all()
        shown = rows[: page.limit]
        surfaces = await _supports(db, [row.id for row in shown])
    next_cursor = None
    if len(rows) > page.limit:
        last = shown[-1]
        next_cursor = encode_cursor([last.name, last.id], scope=scope)
    return LocationPage(
        data=[
            Location(
                location_id=row.id,
                name=row.name,
                country_iso=row.country_iso,
                location_type=row.location_type,
                parent_id=row.parent_id,
                supports=sorted(surfaces[row.id]),
            )
            for row in shown
        ],
        page=CursorPageInfo(
            limit=page.limit, next_cursor=next_cursor, has_more=next_cursor is not None
        ),
    )


@router.get("/domain-categories", summary="Domain categories")
async def list_domain_categories(
    session: CurrentSession, resources: Annotated[Resources, Depends(get_resources)]
) -> DomainCategoryList:
    async with resources.sessions() as db, db.begin():
        rows = (
            await db.execute(
                select(
                    domain_categories.c.code,
                    domain_categories.c.label,
                    domain_categories.c.description,
                ).order_by(domain_categories.c.code)
            )
        ).all()
    return DomainCategoryList(
        data=[
            DomainCategory(code=row.code, label=row.label, description=row.description)
            for row in rows
        ]
    )
