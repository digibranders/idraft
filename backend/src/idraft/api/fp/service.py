"""The AI referral read (docs/18-first-party-integrations.md section 7.3; contract note
docs/ai-visibility/contracts/fp-ai-referrals.md): the sessions GA4 sends from AI assistants under
two classifiers side by side, over a window and, when asked, the window compared with.

Nothing is made up: a key with no row is absent, a window that was not collected is empty, and a
compared window that was not collected, or has no row for a key, gives no `previous`."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Final
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai.summary import compare_dates, summary_dates
from idraft.api.fp import repository
from idraft.api.fp.repository import ReferralGroup, Sums
from idraft.api.problems import NotFoundError, ProblemError
from idraft.api.ranks.repository import project_zone
from idraft.api.schemas.ai import SummaryCompare
from idraft.api.schemas.fp import (
    AiReferralCounts,
    AiReferralRow,
    AiReferralsMeta,
    AiReferralsResponse,
    AiReferralValue,
    ReferralClassifier,
    ReferralGroupBy,
)
from idraft.api.schemas.metrics import MetricWindow
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ga4_pull import Ga4PullState

GA4_CHANNEL: Final = "ga4_ai_assistant_channel"
OWN_RULES: Final = "own_rules"
# What the web shows beside every answer (docs/18 section 7.3: both series are lower bounds, and
# neither classifier is labelled correct).
NOTES: Final = (
    "Google AI Mode and Google AI Overview are not counted: Google Analytics files their "
    "sessions under organic search.",
    "The figures are a lower bound: visits without a referrer, such as clicks from native apps, "
    "are filed under direct.",
    "The two classifiers are shown side by side and neither is labelled correct.",
)


class NotAvailableError(ProblemError):
    """A parameter value the contract names and no build serves yet."""

    status, code, title = 422, "not_available", "Not available yet"


@dataclass(frozen=True, slots=True)
class AiReferralsQuery:
    """What one read is asked for: the route's query parameters."""

    start: date | None = None
    end: date | None = None
    compare: SummaryCompare = "none"
    # A window of the caller's own: both dates or neither, and they win over `compare`.
    compare_from: date | None = None
    compare_to: date | None = None
    group_by: ReferralGroupBy = "assistant"
    classifier: ReferralClassifier = "both"


def _decimal(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def _counts(sums: Sums) -> AiReferralCounts:
    return AiReferralCounts(
        sessions=sums.sessions,
        engaged_sessions=sums.engaged_sessions,
        key_events=_decimal(sums.key_events),
    )


def _value(group: ReferralGroup, *, previous_collected: bool) -> AiReferralValue:
    # A key with no row in a collected compared window had no AI session there, but the route
    # states only what it read: its `previous` is null and the web does not read it as 0.
    previous = group.previous
    return AiReferralValue(
        **_counts(group.current).model_dump(),
        previous=_counts(previous)
        if previous_collected and previous is not None and previous.rows > 0
        else None,
    )


def _rows(groups: list[ReferralGroup], *, previous_collected: bool) -> list[AiReferralRow]:
    by_key: dict[str, dict[str, AiReferralValue]] = {}
    for group in groups:
        by_key.setdefault(group.key, {})[group.classifier] = _value(
            group, previous_collected=previous_collected
        )
    rows = []
    for key, values in by_key.items():
        channel, own = values.get(GA4_CHANNEL), values.get(OWN_RULES)
        rows.append(
            AiReferralRow(
                key=key,
                ga4_ai_assistant_channel=channel,
                own_rules=own,
                difference=None
                if channel is None
                or own is None
                or channel.sessions is None
                or own.sessions is None
                else own.sessions - channel.sessions,
            )
        )
    return sorted(
        rows,
        key=lambda row: (
            -max(
                value.sessions or 0
                for value in (row.ga4_ai_assistant_channel, row.own_rules)
                if value is not None
            ),
            row.key,
        ),
    )


def _last_needed(last: date, today: date) -> date:
    """The last day that must be stored for a window ending `last`. A pull ends yesterday, so a
    window that ends today or later needs yesterday and not its own last day. Any other window
    needs its last day: GA4's date is Pacific and a project's day can be a day ahead of it, so a
    day short of the end is never taken as the end."""
    return last - timedelta(days=1) if last >= today else last


def _collected(first: date, last: date, since: date | None, through: date, today: date) -> bool:
    """The days `first` to `last` are all stored: pulled from `since` (not recorded: unknown, so
    no) up to `through`."""
    return since is not None and since <= first and through >= _last_needed(last, today)


class FpService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    async def ai_referrals(
        self, access: WorkspaceAccess, project_id: UUID, query: AiReferralsQuery
    ) -> AiReferralsResponse:
        ws = access.workspace_id
        async with self._transaction(access) as db:
            zone_row = await project_zone(db, ws, project_id)
            if zone_row is None:
                raise NotFoundError
            if query.group_by == "landing_page":
                raise NotAvailableError("The landing page report is not built yet.")
            zone = ZoneInfo(zone_row.timezone)
            today = datetime.now(zone).date()
            first, last = summary_dates(query.start, query.end, today)
            compared = compare_dates(
                first, last, query.compare, query.compare_from, query.compare_to, today
            )
            integration = await repository.live_ga4_integration(db, ws, project_id)
            pulled = (
                Ga4PullState()
                if integration is None
                else Ga4PullState.read(integration.backfill_state)
            )
            through, since = pulled.through, pulled.since
            notes = list(NOTES)
            groups: list[ReferralGroup] = []
            previous_collected = False
            window_collected = False
            if integration is not None:
                if through is None:
                    notes.append("Google Analytics has not been collected yet for this project.")
                elif through < first:
                    notes.append(
                        f"Collected up to {through.isoformat()}, before the start of this "
                        "window, so nothing is shown for it."
                    )
                else:
                    window_collected = _collected(first, last, since, through, today)
                    previous_collected = compared is not None and _collected(
                        *compared, since, through, today
                    )
                    if through < _last_needed(last, today):
                        notes.append(
                            f"Collected up to {through.isoformat()}: the days after it are not "
                            "in these figures."
                        )
                    if since is None:
                        notes.append(
                            "The first collected day is not recorded for this project, so the "
                            "window cannot be called fully collected."
                        )
                    elif since > first:
                        notes.append(
                            f"The figures start on {since.isoformat()}: the days of this "
                            "window before it were not collected."
                        )
                    if compared is not None and not previous_collected:
                        notes.append(
                            "The compared window is not fully collected, so no comparison is shown."
                        )
                    groups = await repository.referral_groups(
                        db,
                        ws,
                        project_id,
                        integration.id,
                        window=(first, last),
                        compared=compared if previous_collected else None,
                        classifiers=(GA4_CHANNEL, OWN_RULES)
                        if query.classifier == "both"
                        else (query.classifier,),
                        group_by=query.group_by,
                    )
        own_versions = [group.rules_version for group in groups if group.classifier == OWN_RULES]
        return AiReferralsResponse(
            data=_rows(groups, previous_collected=previous_collected),
            meta=AiReferralsMeta(
                connected=integration is not None,
                collected_through=through,
                collected_since=since,
                window_collected=window_collected,
                last_success_at=None if integration is None else integration.last_success_at,
                window=MetricWindow(
                    from_=first.isoformat(), to=last.isoformat(), timezone=zone_row.timezone
                ),
                compare_window=None
                if compared is None
                else MetricWindow(
                    from_=compared[0].isoformat(),
                    to=compared[1].isoformat(),
                    timezone=zone_row.timezone,
                ),
                rules_version=max(own_versions, default=None),
                lower_bound=True,
                notes=notes,
            ),
        )
