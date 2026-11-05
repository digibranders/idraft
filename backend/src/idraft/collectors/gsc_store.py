"""The database side of the Search Console pull: what an integration is, the day of numbers it
replaces, and the status it reports (docs/18 sections 4.4, 4.6 and 4.7).

Every statement names the workspace: the worker's role bypasses row-level security. The worker
may insert and delete numbers and change only the status columns of the integration and the
connection (migration 0015).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db import dictionaries
from idraft.db.tables import connections, gsc_queries, gsc_search_analytics, integrations
from idraft.domain.gsc_pull import PullState
from idraft.extraction.urls import CanonicalUrl

SEARCH_TYPE = "web"
DEVICES = frozenset({"DESKTOP", "MOBILE", "TABLET"})
# Rows of a day are written in chunks; the day is still one transaction.
INSERT_CHUNK = 2_000


@dataclass(frozen=True, slots=True)
class IntegrationFacts:
    workspace_id: UUID
    integration_id: UUID
    project_id: UUID
    site_url: str
    status: str
    connection_id: UUID
    connection_status: str
    credential_ref: UUID | None
    # The Google account's `sub`, the key of the per-account call budget.
    account: str
    backfill_state: dict[str, Any]

    @property
    def state(self) -> PullState:
        return PullState.read(self.backfill_state)

    @property
    def runnable(self) -> bool:
        return self.status == "active" and self.connection_status == "active"


@dataclass(frozen=True, slots=True)
class DayRow:
    """One row of shape B, as Search Console returned it, before its page has a `core.urls` row."""

    query_hash: bytes
    query_text: str
    normalized_text: str
    url: CanonicalUrl
    country: str
    device: str
    clicks: int
    impressions: int
    position_sum: Decimal


@dataclass(frozen=True, slots=True)
class Replaced:
    removed: int
    written: int
    # Pages that collapsed into one canonical URL for the same key, and were summed.
    collapsed: int


async def load_integration(
    db: AsyncSession, workspace_id: UUID, integration_id: UUID
) -> IntegrationFacts | None:
    row = (
        await db.execute(
            select(
                integrations.c.id,
                integrations.c.project_id,
                integrations.c.external_property,
                integrations.c.status,
                integrations.c.backfill_state,
                connections.c.id.label("connection_id"),
                connections.c.status.label("connection_status"),
                connections.c.credential_ref,
                connections.c.subject_id,
            )
            .join(
                connections,
                (connections.c.id == integrations.c.connection_id)
                & (connections.c.workspace_id == integrations.c.workspace_id),
            )
            .where(
                integrations.c.workspace_id == workspace_id,
                integrations.c.id == integration_id,
                integrations.c.kind == "gsc",
                integrations.c.project_id.is_not(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return IntegrationFacts(
        workspace_id=workspace_id,
        integration_id=row.id,
        project_id=row.project_id,
        site_url=row.external_property,
        status=row.status,
        connection_id=row.connection_id,
        connection_status=row.connection_status,
        credential_ref=row.credential_ref,
        account=row.subject_id,
        backfill_state=dict(row.backfill_state or {}),
    )


async def stored_days(
    db: AsyncSession, facts: IntegrationFacts, start: date, end: date
) -> set[date]:
    """The days between `start` and `end` that have final rows."""
    rows = await db.execute(
        select(gsc_search_analytics.c.metric_date)
        .where(
            gsc_search_analytics.c.workspace_id == facts.workspace_id,
            gsc_search_analytics.c.integration_id == facts.integration_id,
            gsc_search_analytics.c.search_type == SEARCH_TYPE,
            gsc_search_analytics.c.data_state == "final",
            gsc_search_analytics.c.metric_date.between(start, end),
        )
        .distinct()
    )
    return {row.metric_date for row in rows}


async def replace_day(
    db: AsyncSession, facts: IntegrationFacts, day: date, rows: Sequence[DayRow]
) -> Replaced:
    """Make `rows` the day's final rows: delete what the day had, insert the new ones. Running it
    again with the same rows changes nothing (docs/18 section 4.4, the documented exception to
    append-only). The caller holds the transaction and saves the progress in it."""
    url_rows = await dictionaries.urls_for(db, [row.url for row in rows])
    merged: dict[tuple[bytes, int, str, str], tuple[int, int, Decimal]] = {}
    for row in rows:
        url_id = url_rows[row.url.url_hash].id
        key = (row.query_hash, url_id, row.country, row.device)
        clicks, impressions, position = merged.get(key, (0, 0, Decimal(0)))
        merged[key] = (
            clicks + row.clicks,
            impressions + row.impressions,
            position + row.position_sum,
        )
    deleted = await db.execute(
        delete(gsc_search_analytics).where(
            gsc_search_analytics.c.workspace_id == facts.workspace_id,
            gsc_search_analytics.c.integration_id == facts.integration_id,
            gsc_search_analytics.c.metric_date == day,
            gsc_search_analytics.c.search_type == SEARCH_TYPE,
        )
    )
    removed = cast("CursorResult[Any]", deleted).rowcount
    queries = {
        row.query_hash: {
            "workspace_id": facts.workspace_id,
            "query_hash": row.query_hash,
            "query_text": row.query_text,
            "normalized_text": row.normalized_text,
        }
        for row in rows
    }
    await _insert_chunks(
        db,
        lambda chunk: (
            upsert(gsc_queries)
            .values(chunk)
            .on_conflict_do_nothing(index_elements=["workspace_id", "query_hash"])
        ),
        list(queries.values()),
    )
    await _insert_chunks(
        db,
        lambda chunk: upsert(gsc_search_analytics).values(chunk),
        [
            {
                "integration_id": facts.integration_id,
                "metric_date": day,
                "search_type": SEARCH_TYPE,
                "query_hash": query_hash,
                "url_id": url_id,
                "country_iso3": country,
                "device": device,
                "workspace_id": facts.workspace_id,
                "project_id": facts.project_id,
                "clicks": clicks,
                "impressions": impressions,
                "position_sum": position.quantize(Decimal("0.01")),
                "data_state": "final",
            }
            for (query_hash, url_id, country, device), (
                clicks,
                impressions,
                position,
            ) in merged.items()
        ],
    )
    return Replaced(removed=removed, written=len(merged), collapsed=len(rows) - len(merged))


async def _insert_chunks(db: AsyncSession, statement: Any, values: list[dict[str, Any]]) -> None:
    for offset in range(0, len(values), INSERT_CHUNK):
        await db.execute(statement(values[offset : offset + INSERT_CHUNK]))


async def save_state(
    db: AsyncSession,
    facts: IntegrationFacts,
    state: PullState,
    *,
    last_error: str | None,
    succeeded_at: datetime | None = None,
) -> None:
    """Keep the pull's state and the integration's status columns. `last_success_at` moves only
    when `succeeded_at` is given."""
    values: dict[str, Any] = {
        "backfill_state": state.write(facts.backfill_state),
        "last_error": last_error,
    }
    if succeeded_at is not None:
        values["last_success_at"] = succeeded_at
    await db.execute(
        update(integrations)
        .where(
            integrations.c.workspace_id == facts.workspace_id,
            integrations.c.id == facts.integration_id,
        )
        .values(**values)
    )


async def note_refresh(db: AsyncSession, facts: IntegrationFacts, at: datetime) -> None:
    await db.execute(
        update(connections)
        .where(
            connections.c.workspace_id == facts.workspace_id,
            connections.c.id == facts.connection_id,
            connections.c.status == "active",
        )
        .values(last_refresh_at=at, last_error_code=None)
    )


async def mark_reauth_required(db: AsyncSession, facts: IntegrationFacts, code: str) -> None:
    """The connection and every integration on it wait for a new sign-in (docs/18 section 4.6).
    What was pulled stays."""
    await db.execute(
        update(connections)
        .where(
            connections.c.workspace_id == facts.workspace_id,
            connections.c.id == facts.connection_id,
            connections.c.status == "active",
        )
        .values(status="reauth_required", last_error_code=code)
    )
    await db.execute(
        update(integrations)
        .where(
            integrations.c.workspace_id == facts.workspace_id,
            integrations.c.connection_id == facts.connection_id,
            integrations.c.status == "active",
        )
        .values(status="reauth_required", last_error=code)
    )


async def mark_integration_error(db: AsyncSession, facts: IntegrationFacts, code: str) -> None:
    """One property is not readable by the account any more; the connection and the other
    properties on it go on."""
    await db.execute(
        update(integrations)
        .where(
            integrations.c.workspace_id == facts.workspace_id,
            integrations.c.id == facts.integration_id,
            integrations.c.status == "active",
        )
        .values(status="error", last_error=code)
    )
