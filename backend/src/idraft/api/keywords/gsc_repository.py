"""Clicks and impressions from Search Console for the rows of the keyword list (docs/18 4.9).

A project is `not_connected` unless it has an active Search Console property on a healthy
connection (`fp.integrations`, linked by `POST .../integrations`). It is `pending` until the
pull has stored the 28 final days that end on the latest final day (`PullState.recent_done`), and
`ok` from then on. A property that waits for a new sign-in (`reauth_required`) or is in error
counts as not connected, so a number is never shown as current when the sync behind it has
stopped; the stored rows stay for when it is connected again.

`ok` sums the property's final `web` rows over the window, for each tracked keyword: the rows whose
query, after the keyword normalizer, is the keyword's normalized text, in the country of the
keyword's location (a city counts as its country), on each device. The sum of a keyword with
no rows in the window is 0, which is a count. Tablets are not added to either device, and the
numbers are never estimated from volume and rank.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import ARRAY, BigInteger, ColumnElement, Text, and_, any_, func, literal, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    connections,
    gsc_queries,
    gsc_search_analytics,
    integrations,
    keywords,
    locations,
    tracked_keywords,
)
from idraft.domain.countries import ISO3_OF, iso2_of
from idraft.domain.gsc_pull import PullState

SEARCH_TYPE = "web"
Metric = Literal["clicks", "impressions"]


@dataclass(frozen=True, slots=True)
class GscRecord:
    state: Literal["ok", "pending", "not_connected"]
    clicks: dict[str, int] | None = None
    impressions: dict[str, int] | None = None
    window: tuple[date, date] | None = None


@dataclass(frozen=True, slots=True)
class GscScope:
    """What a project's numbers are read from: its state, and for `ok` the property and the days."""

    state: Literal["ok", "pending", "not_connected"]
    integration_id: UUID | None = None
    window: tuple[date, date] | None = None


async def scope_of(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> GscScope:
    """One property serves the whole project, so every keyword has the same state."""
    row = (
        await db.execute(
            select(
                integrations.c.id,
                integrations.c.status,
                integrations.c.backfill_state,
                connections.c.status.label("connection_status"),
            )
            .join(
                connections,
                and_(
                    connections.c.id == integrations.c.connection_id,
                    connections.c.workspace_id == integrations.c.workspace_id,
                ),
            )
            .where(
                integrations.c.workspace_id == workspace_id,
                integrations.c.project_id == project_id,
                integrations.c.kind == "gsc",
                integrations.c.status != "disabled",
            )
        )
    ).one_or_none()
    if row is None or row.status != "active" or row.connection_status != "active":
        return GscScope("not_connected")
    window = PullState.read(row.backfill_state).window
    if window is None:
        return GscScope("pending", integration_id=row.id)
    return GscScope("ok", integration_id=row.id, window=window)


async def gsc_of(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    tracked_ids: Collection[UUID],
) -> dict[UUID, GscRecord]:
    """The Search Console block of each keyword asked for."""
    scope = await scope_of(db, workspace_id, project_id)
    if scope.state != "ok" or scope.window is None or scope.integration_id is None:
        return dict.fromkeys(tracked_ids, GscRecord(state=scope.state))
    if not tracked_ids:
        return {}
    wanted = {
        row.id: (row.normalized_text, row.country_iso)
        for row in await db.execute(
            select(
                tracked_keywords.c.id,
                keywords.c.normalized_text,
                locations.c.country_iso,
            )
            .join(keywords, keywords.c.id == tracked_keywords.c.keyword_id)
            .join(locations, locations.c.id == tracked_keywords.c.location_id)
            .where(
                tracked_keywords.c.workspace_id == workspace_id,
                tracked_keywords.c.project_id == project_id,
                tracked_keywords.c.id.in_(list(tracked_ids)),
            )
        )
    }
    sums = await _sums(
        db,
        workspace_id,
        scope.integration_id,
        scope.window,
        texts={text for text, _ in wanted.values()},
        countries={country for _, country in wanted.values()},
    )
    zero = {"desktop": 0, "mobile": 0}
    found: dict[UUID, GscRecord] = {}
    for tracked_id in tracked_ids:
        key = wanted.get(tracked_id)
        counts = sums.get(key, {}) if key else {}
        found[tracked_id] = GscRecord(
            state="ok",
            clicks={**zero, **{device: n[0] for device, n in counts.items()}},
            impressions={**zero, **{device: n[1] for device, n in counts.items()}},
            window=scope.window,
        )
    return found


async def _sums(
    db: AsyncSession,
    workspace_id: UUID,
    integration_id: UUID,
    window: tuple[date, date],
    *,
    texts: set[str],
    countries: set[str],
) -> dict[tuple[str, str], dict[str, tuple[int, int]]]:
    """Clicks and impressions by (normalized query, country, device name), desktop and mobile."""
    a, q = gsc_search_analytics.c, gsc_queries.c
    iso3 = sorted(ISO3_OF[country] for country in countries if country in ISO3_OF)
    if not texts or not iso3:
        return {}
    rows = await db.execute(
        select(
            q.normalized_text,
            a.country_iso3,
            a.device,
            func.sum(a.clicks).label("clicks"),
            func.sum(a.impressions).label("impressions"),
        )
        .select_from(
            gsc_search_analytics.join(
                gsc_queries,
                and_(q.workspace_id == a.workspace_id, q.query_hash == a.query_hash),
            )
        )
        .where(
            a.workspace_id == workspace_id,
            a.integration_id == integration_id,
            a.search_type == SEARCH_TYPE,
            a.data_state == "final",
            a.metric_date.between(*window),
            a.device.in_(("DESKTOP", "MOBILE")),
            q.normalized_text == any_(literal(sorted(texts), type_=ARRAY(Text))),
            a.country_iso3 == any_(literal(iso3, type_=ARRAY(Text))),
        )
        .group_by(q.normalized_text, a.country_iso3, a.device)
    )
    found: dict[tuple[str, str], dict[str, tuple[int, int]]] = {}
    for row in rows:
        country = iso2_of(row.country_iso3)
        if country is not None:
            found.setdefault((row.normalized_text, country), {})[row.device.lower()] = (
                int(row.clicks),
                int(row.impressions),
            )
    return found


def sorted_total(metric: Metric, scope: GscScope) -> ColumnElement[Any]:
    """A tracked keyword's clicks or impressions over the window, on its own device, as a
    correlated sum for the list's sorts. A project with no numbers yet gives 0 to every row, so
    the sort falls back to the id (and a keyword with no rows sums to 0, as in `gsc_of`)."""
    if scope.state != "ok" or scope.window is None or scope.integration_id is None:
        return literal(0, type_=BigInteger)
    a = gsc_search_analytics.alias("gsc_sort_a")
    q = gsc_queries.alias("gsc_sort_q")
    value = a.c.clicks if metric == "clicks" else a.c.impressions
    iso3 = literal(dict(ISO3_OF), type_=JSONB)[locations.c.country_iso].astext
    return (
        select(func.coalesce(func.sum(value), 0))
        .select_from(
            a.join(q, and_(q.c.workspace_id == a.c.workspace_id, q.c.query_hash == a.c.query_hash))
        )
        .where(
            a.c.workspace_id == tracked_keywords.c.workspace_id,
            a.c.integration_id == scope.integration_id,
            a.c.search_type == SEARCH_TYPE,
            a.c.data_state == "final",
            a.c.metric_date.between(*scope.window),
            q.c.normalized_text == keywords.c.normalized_text,
            a.c.country_iso3 == iso3,
            a.c.device == func.upper(tracked_keywords.c.device),
        )
        .correlate(tracked_keywords, keywords, locations)
        .scalar_subquery()
    )
