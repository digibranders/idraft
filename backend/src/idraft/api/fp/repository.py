"""Reads of the AI referral route: the project's live GA4 integration, and the classified sessions
of one or two windows in one grouped statement. Row-level security keeps every read in the
caller's workspace; each statement names the workspace and the project as well."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import ai_referral_daily, integrations

_D, _I = ai_referral_daily.c, integrations.c


@dataclass(frozen=True, slots=True)
class Ga4Integration:
    id: UUID
    last_success_at: datetime | None
    backfill_state: dict[str, Any]


@dataclass(frozen=True, slots=True)
class Sums:
    """One classifier and key over one window: the rows read, and their sums over rows of unit
    `sessions`. A sum is None when the rows hold no count at all (a sum of nothing is not 0)."""

    rows: int
    sessions: int | None
    engaged_sessions: int | None
    key_events: Decimal | None


@dataclass(frozen=True, slots=True)
class ReferralGroup:
    classifier: str
    key: str
    rules_version: int
    current: Sums
    previous: Sums | None


async def live_ga4_integration(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> Ga4Integration | None:
    """The project's GA4 integration that is not disabled: an active one first, then the one
    that last succeeded."""
    row = (
        await db.execute(
            select(_I.id, _I.last_success_at, _I.backfill_state)
            .where(
                _I.workspace_id == workspace_id,
                _I.project_id == project_id,
                _I.kind == "ga4",
                _I.status != "disabled",
            )
            .order_by((_I.status == "active").desc(), _I.last_success_at.desc().nulls_last(), _I.id)
            .limit(1)
        )
    ).one_or_none()
    return None if row is None else Ga4Integration(row.id, row.last_success_at, row.backfill_state)


def _sums(rows: int, sessions: int | None, engaged: int | None, key_events: Decimal | None) -> Sums:
    return Sums(rows=rows, sessions=sessions, engaged_sessions=engaged, key_events=key_events)


async def referral_groups(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    integration_id: UUID,
    *,
    window: tuple[date, date],
    compared: tuple[date, date] | None,
    classifiers: tuple[str, ...],
    group_by: Literal["assistant", "origin"],
) -> list[ReferralGroup]:
    """The sums of each classifier and key over `window` and over `compared`, from the current
    rows of all pages, in one statement. A key with no row in `window` is left out."""
    key = _D.assistant_code if group_by == "assistant" else _D.origin
    in_window: ColumnElement[bool] = _D.metric_date.between(*window)
    in_compared: ColumnElement[bool] | None = (
        None if compared is None else _D.metric_date.between(*compared)
    )

    def columns(within: ColumnElement[bool], name: str) -> list[ColumnElement[Any]]:
        return [
            func.count().filter(within).label(f"{name}_rows"),
            func.sum(_D.sessions).filter(within).label(f"{name}_sessions"),
            func.sum(_D.engaged_sessions).filter(within).label(f"{name}_engaged"),
            func.sum(_D.key_events).filter(within).label(f"{name}_key_events"),
        ]

    wanted = [columns(in_window, "current")]
    if in_compared is not None:
        wanted.append(columns(in_compared, "previous"))
    rows = await db.execute(
        select(
            _D.classifier,
            key.label("key"),
            # Of the window alone: the compared one may hold rows of another rule set.
            func.max(_D.rules_version).filter(in_window).label("rules_version"),
            *(column for group in wanted for column in group),
        )
        .where(
            _D.workspace_id == workspace_id,
            _D.project_id == project_id,
            _D.integration_id == integration_id,
            _D.is_current,
            _D.landing_url_id == 0,
            _D.unit == "sessions",
            _D.classifier.in_(classifiers),
            in_window if in_compared is None else or_(in_window, in_compared),
        )
        .group_by(_D.classifier, key)
        .having(func.count().filter(in_window) > 0)
    )
    return [
        ReferralGroup(
            classifier=row.classifier,
            key=row.key,
            rules_version=row.rules_version,
            current=_sums(
                row.current_rows,
                row.current_sessions,
                row.current_engaged,
                row.current_key_events,
            ),
            previous=None
            if in_compared is None
            else _sums(
                row.previous_rows,
                row.previous_sessions,
                row.previous_engaged,
                row.previous_key_events,
            ),
        )
        for row in rows
    ]
