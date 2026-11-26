"""Helpers for the GA4 pull tests: report rows the way `runReport` writes them, a context that
reads them from `FakeGoogle`, and the stored AI referral rows."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.ga4_sync import Ga4Context
from idraft.providers.google.client import GoogleClient
from tests.api.auth.support import fetch
from tests.collectors.gsc_support import CIPHER, today
from tests.conftest import PostgresServer
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET, FakeGoogle

type ReportRow = tuple[tuple[str, ...], tuple[str, ...]]


def yesterday() -> date:
    """The last day a run asks for: the property's yesterday (Pacific Time here)."""
    return today() - timedelta(days=1)


def ga4_row(
    day: date,
    source: str,
    medium: str,
    manual: str,
    channel: str,
    sessions: int,
    engaged: int,
    key_events: str = "0",
    revenue: str = "0",
) -> ReportRow:
    """One row in the order of the pull's dimensions and metrics, every value a string."""
    return (
        (day.strftime("%Y%m%d"), source, medium, manual, channel),
        (str(sessions), str(engaged), key_events, revenue),
    )


def ai_day(day: date, extra: int = 0) -> list[ReportRow]:
    """A day of a property: both classifiers see ChatGPT, only the rules see Perplexity and the
    UTM source, only the GA4 channel sees Claude, and search and direct are no AI at all.

    Stored: the channel's `chatgpt.com` (10 + extra sessions) and `claude` (3), the rules'
    `chatgpt` (12 + extra) and `perplexity` (4)."""
    return [
        ga4_row(
            day, "chatgpt.com", "referral", "(not set)", "AI Assistant", 10 + extra, 7, "2", "19.99"
        ),
        ga4_row(day, "(direct)", "(none)", "chatgpt.com", "Direct", 2, 1),
        ga4_row(day, "perplexity.ai", "referral", "(not set)", "Referral", 4, 3, "1"),
        ga4_row(day, "claude", "ai-assistant", "(not set)", "AI Assistant", 3, 2),
        ga4_row(day, "google", "organic", "(not set)", "Organic Search", 500, 400, "9", "90"),
        ga4_row(day, "(direct)", "(none)", "(not set)", "Direct", 300, 200),
    ]


def serve(
    fake: FakeGoogle,
    property_name: str,
    days: int,
    *,
    through: date | None = None,
    rows: Callable[[date, int], list[ReportRow]] = lambda day, back: ai_day(day),
) -> list[date]:
    """Report rows for `days` days that end on `through` (yesterday). `rows` gets the day and its
    number back from `through`. Returns the days, oldest first."""
    last = through or yesterday()
    served = [last - timedelta(days=back) for back in range(days)][::-1]
    fake.ga4_rows[property_name] = [row for day in served for row in rows(day, (last - day).days)]
    return served


def ga4_context(
    sessions: async_sessionmaker[AsyncSession], fake: FakeGoogle, **changes: Any
) -> Ga4Context:
    async def no_wait(seconds: float) -> None:
        return None

    google = GoogleClient(
        httpx.AsyncClient(transport=fake.transport),
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        attempts=2,
        sleep=no_wait,
        jitter=lambda: 0.0,
    )
    fields: dict[str, Any] = {"sessions": sessions, "google": google, "cipher": CIPHER}
    return Ga4Context(**{**fields, **changes})


def reports(fake: FakeGoogle) -> list[dict[str, Any]]:
    """The bodies of the `runReport` calls made so far."""
    return [dict(call.json_body) for call in fake.calls if call.json_body is not None]


async def stored(pg: PostgresServer, integration_id: uuid.UUID) -> list[tuple[Any, ...]]:
    """Every stored AI referral row of the integration: day, classifier, rules version, assistant,
    sessions, engaged sessions, key events, revenue."""
    rows = await fetch(
        pg,
        "SELECT metric_date, classifier, rules_version, assistant_code, sessions, "
        "engaged_sessions, key_events, total_revenue FROM fp.ai_referral_daily "
        "WHERE integration_id = $1 ORDER BY 1, 2, 4",
        integration_id,
    )
    return [tuple(row) for row in rows]
