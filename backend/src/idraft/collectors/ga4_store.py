"""The database side of the GA4 pull: the referrer rules it classifies with, and the window of
AI referral rows it replaces (docs/18 sections 7.2 to 7.4).

The integration, its status and the pull's state are those of the Search Console pull
(`gsc_store`): `load_integration(..., "ga4")`, `save_state`, `note_refresh`,
`mark_reauth_required` and `mark_integration_error` do not depend on the kind.

Every statement names the workspace: the worker's role bypasses row-level security. The rules
table is global (it has no workspace) and the worker may only read it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal, cast

from sqlalchemy import CursorResult, delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.collectors.gsc_store import IntegrationFacts
from idraft.db.tables import ai_referral_daily, ai_referrer_rules
from idraft.domain.ai_referrals import ReferralRow, Rule

ORIGIN = "ga4"
UNIT = "sessions"
# "All pages": the landing page breakdown is a later report (plan WP-69, decision 1).
ALL_PAGES = 0
# A row has 14 columns and a statement takes at most 32,767 parameters.
INSERT_CHUNK = 1_000


@dataclass(frozen=True, slots=True)
class Replaced:
    removed: int
    written: int


async def load_rules(db: AsyncSession) -> list[Rule]:
    """The rules of the highest rule set version, ambiguous ones included (the classifier leaves
    them out of the numbers it returns)."""
    newest = select(func.max(ai_referrer_rules.c.rule_set_version)).scalar_subquery()
    rows = await db.execute(
        select(
            ai_referrer_rules.c.rule_set_version,
            ai_referrer_rules.c.rule_id,
            ai_referrer_rules.c.match_field,
            ai_referrer_rules.c.match_type,
            ai_referrer_rules.c.pattern,
            ai_referrer_rules.c.assistant_code,
            ai_referrer_rules.c.confidence,
        )
        .where(ai_referrer_rules.c.rule_set_version == newest)
        .order_by(ai_referrer_rules.c.rule_id)
    )
    return [
        Rule(
            rule_set_version=row.rule_set_version,
            rule_id=row.rule_id,
            match_field=cast("Literal['referrer_host', 'utm_source']", row.match_field),
            match_type=cast("Literal['exact', 'suffix']", row.match_type),
            pattern=row.pattern,
            assistant_code=row.assistant_code,
            confidence=cast("Literal['high', 'ambiguous']", row.confidence),
        )
        for row in rows
    ]


async def replace_window(
    db: AsyncSession,
    facts: IntegrationFacts,
    start: date,
    end: date,
    rows: Sequence[ReferralRow],
) -> Replaced:
    """Make `rows` the integration's rows for the days from `start` to `end`: delete what those
    days had, insert the new ones. Running it again with the same rows changes nothing. The
    caller holds the transaction and saves the pull's state in it."""
    if any(not start <= row.day <= end for row in rows):
        # Such a row would outlive the next replacement of its day and collide with it.
        raise ValueError("a row is of a day outside the window it replaces")
    deleted = await db.execute(
        delete(ai_referral_daily).where(
            ai_referral_daily.c.workspace_id == facts.workspace_id,
            ai_referral_daily.c.integration_id == facts.integration_id,
            ai_referral_daily.c.metric_date.between(start, end),
        )
    )
    values: list[dict[str, Any]] = [
        {
            "workspace_id": facts.workspace_id,
            "project_id": facts.project_id,
            "integration_id": facts.integration_id,
            "metric_date": row.day,
            "origin": ORIGIN,
            "classifier": row.classifier,
            "rules_version": row.rules_version,
            "assistant_code": row.assistant_code,
            "landing_url_id": ALL_PAGES,
            "unit": UNIT,
            "sessions": row.sessions,
            "engaged_sessions": row.engaged_sessions,
            "key_events": row.key_events,
            "total_revenue": row.total_revenue,
        }
        for row in rows
    ]
    for offset in range(0, len(values), INSERT_CHUNK):
        await db.execute(insert(ai_referral_daily).values(values[offset : offset + INSERT_CHUNK]))
    return Replaced(
        removed=cast("CursorResult[Any]", deleted).rowcount,
        written=len(values),
    )
